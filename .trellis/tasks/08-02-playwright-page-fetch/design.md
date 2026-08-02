# Tech Design — Playwright-based page fetch

## Problem

`fetchPage` in `packages/prices/src/pipeline/fetch-page.ts` must deliver HTML
for retailers behind Cloudflare's Managed Security Challenge. The first attempt
(Node undici) is TLS-fingerprinted as a bot. The current fallback
(`wreq-js` with `chrome_130`) is *partially* effective — it passes pbtech
because that site accepts Chrome-family fingerprints, but thewarehouse rejects
*all* `chrome_*` profiles. Single-profile TLS impersonation is not a
generalizable solution; Cloudflare treats one browser family as a single
homogeneous class for scoring purposes.

Verified empirically on 2026-08-02 with the offline profile probe: only Firefox
and Safari profiles pass thewarehouse. Profile rotation across
`chrome_130 → firefox_149 → safari_18.5` would unlock thewarehouse but adds
significant complexity (3× the challenge-path requests, a fragile ordering
heuristic, and the same blind spot the next time Cloudflare adjusts its
scoring).

## Decision: Playwright headless Chromium as the sole transport

Per user decision, replace the entire undici + `wreq-js` chain with a single
real headless browser that executes Cloudflare's JavaScript challenge.

### Library choice

- **`playwright`** (or `playwright-core` + `@playwright/browser-chromium`):
  first-party Microsoft library, MIT license, well-maintained, supports Node
  22 on alpine, the `chromium` browser is downloaded by
  `pnpm exec playwright install chromium --with-deps` and ~150–200 MB.
- The alternative — a real Chrome via Puppeteer — was not selected because
  Playwright's `chromium` channel is the most predictable across alpine / musl
  glibc hybrid deployments and has the cleanest API for the small surface
  (one `newContext()` + `newPage()` + `goto` + `content()` + `close()`).

### Architecture

`fetchPage` keeps its `FetchPageResult | null` contract and its shared
`p-limit` concurrency. Transport is now a single Playwright path:

```
fetchPage(url, opts)
  └─ pageFetchLimiter(() => doFetchWithPlaywright(url, opts))
        └─ lazy-launch shared browser on first call
        └─ browser.newContext()  ← fresh per call (no cookie / storage leak)
        └─ context.newPage()
        └─ page.goto(url, { waitUntil: "domcontentloaded", timeout })
        └─ page.content()  ← full HTML, post-challenge-solve
        └─ page.close(); context.close()
        └─ return { html, url: page.url() } | null on failure
```

The retry / backoff / structured logging envelope (`MAX_RETRIES`,
`calculateBackoffDelay`, `sleep`) is reused so the operational behaviour is
unchanged. On a Playwright failure the loop backs off and retries (within
`MAX_RETRIES`); on total failure it returns `null` exactly like before.

### Browser lifetime

A module-level `Browser` instance is created lazily on the first call and
reused for the process lifetime. Closing the browser happens only on process
exit. Reasoning:

- Launching Chromium is ~500 ms and ~80 MB; doing it per call would dominate
  every `checkPrice`.
- A single `Browser` can hold many `context`s; the limiter caps how many
  pages are live at once.
- Disposing the `context` per call still gives us a clean cookie / storage
  state per retailer — the only thing the `Browser` is shared for is the
  process and the disk-cached browser binary.

### Memory / concurrency

- Default `p-limit` is 5. With Chromium each page holds ~30–80 MB; the
  container's RSS grows by ~150–400 MB at peak scheduler tick. This is
  acceptable on a private NAS target (the design.md notes the deployment is
  a single self-hosted container).
- A `context` + `page` are disposed in a `try/finally` to avoid leak across
  failures.

### Docker / alpine

`node:22-alpine` is musl. Playwright's chromium build is compiled for both
glibc and musl targets, but the runtime libraries must be present. The
Dockerfile adds:

1. `pnpm install` installs `playwright`.
2. A build-time step downloads the chromium binary into the image:
   `pnpm --filter @iris/prices exec playwright install chromium`.
3. System libraries: `apk add --no-cache` of the standard Playwright runtime
   set (libnss3, libatk-1.0, libatk-bridge-2.0, libcups, libdrm, libxkbcommon,
   libxcomposite, libxdamage, libxfixes, libxrandr, libgbm, libasound2, etc. —
   the `playwright install --with-deps` list). Because `playwright install
   --with-deps` itself shells out to `apt-get`, we have to do this manually
   with `apk` for alpine. The known-good package set is documented in the
   Playwright README and stays stable across releases; we pin the
   `playwright` version in `packages/prices/package.json`.

### Data flow & contract

`fetchPage(url, options)` signature is unchanged: returns
`{ html, url } | null`. `checkPrice`, the AI `fetchPage` tool, and the
scheduler all keep working without changes.

### Compatibility & migration

- `wreq-js` is removed from `packages/prices/package.json` and from
  `apps/web/next.config.ts` `serverExternalPackages`.
- `pnpm-lock.yaml` is regenerated by `pnpm install`.
- The dev experience: contributors no longer have a native NAPI binding; the
  only added requirement is `pnpm exec playwright install chromium` after
  `pnpm install` (added to a postinstall script for `@iris/prices`).

### Trade-offs

- **Pros:** single universally-compatible transport, no per-retailer logic,
  no per-fingerprint-class rotation, future Cloudflare tuning is invisible to
  us.
- **Cons:** ~3–10× slower per fetch (Chromium startup amortized over
  shared `Browser`; per-page setup adds ~200–500 ms). ~150–200 MB extra
  image size. Memory cost at peak ~300 MB extra RSS. Acceptable for a
  self-hosted, low-frequency price-tracker (default check interval is
  60 minutes per product).
- **Rejected alternatives:** pure TLS rotation (insufficient — Cloudflare
  treats a browser family as a single class), CAPTCHA-solving service
  (cost, third-party dependency, ToS risk for some sites).

## Rollout / rollback

- Single behavioural unit: the entire `fetchPage` body is the change.
- Roll back by reverting `fetch-page.ts`, the dependency changes, and the
  Dockerfile.
- Forward-only: the previous `wreq-js` is no longer needed in `package.json`.

### Build-time webpack externalisation

`serverExternalPackages` is necessary but **not sufficient** for Playwright:

- `fetch-page.ts` loads Playwright via `await import("playwright")` (dynamic
  import with a string literal). Webpack 5 statically walks dynamic imports
  during module-graph analysis — it therefore enters
  `playwright-core/lib/server/recorder/recorderApp.js`, which does
  `require.resolve('../../vite/recorder/' + uri)` against a directory with no
  `package.json`. Webpack then fails on the unsupported `sync` export
  condition during the server bundle.
- The fix is webpack's `IgnorePlugin` for `playwright`/`playwright-core` on
  the server bundle. Next 15 does not expose `webpack` (or its `IgnorePlugin`
  class) to apps, so `apps/web/next.config.ts` ships a tiny inline plugin
  that taps `normalModuleFactory.hooks.beforeResolve` and bails on any
  `playwright(-core)?` request. Node resolves the modules at runtime from
  `node_modules`.
- `apps/web/tsconfig.json` excludes `next.config.ts` from the app's
  `tsc --noEmit`; Next compiles the file itself with webpack in scope.

## Verification

- Direct `fetchPage` call on thewarehouse → `200` + parseable HTML with a
  price.
- Direct `fetchPage` call on pbtech → still `200` (regression).
- Direct `fetchPage` call on Apple / Wikipedia / Amazon → still `200`
  (regression — sites that never needed a browser).
- `pnpm typecheck` and `pnpm lint` pass.
- `docker compose build app` succeeds; `docker compose up app` reaches
  "Scheduler started" without Playwright launch errors.

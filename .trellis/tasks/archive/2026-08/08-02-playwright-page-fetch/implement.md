# Implementation Plan — Playwright-based page fetch

## Goal recap

Make `fetchPage` deliver HTML for any retailer URL the user adds, including
Cloudflare Managed Security Challenge sites (thewarehouse, pbtech, etc.).
Replace the undici + `wreq-js` chain with a single Playwright headless
Chromium transport under the existing shared `p-limit` and backoff/retry
envelope. Same `FetchPageResult | null` contract; no changes to callers.

## Checklist (order matters)

1. **Remove `wreq-js`** from `packages/prices`:
   - `packages/prices/package.json`: delete the `wreq-js` dependency line.
   - `apps/web/next.config.ts`: delete `wreq-js` from `serverExternalPackages`.
   - `pnpm install` to refresh `pnpm-lock.yaml`.

2. **Add Playwright**:
   - `packages/prices/package.json`: add `playwright` (latest 1.x).
   - `pnpm install`.
   - Confirm `playwright` resolves and `import { chromium } from "playwright"`
     typechecks.

3. **Rewrite `packages/prices/src/pipeline/fetch-page.ts`**:
   - Keep the file's exports: `fetchPage`, `FetchPageResult`, `FetchPageOptions`.
   - Remove the `wreq-js` fallback, `CHALLENGE_STATUS_CODES` /
     `BROWSER_TLS_PROFILE` constants, and the `attemptUndiciFetch` helper.
   - Add a module-level `Browser` lazy-launch helper: a single
     `chromium.launch({ headless: true })` shared across calls.
   - `fetchPage` body: under the existing `pageFetchLimiter`, retry loop using
     `browser.newContext()` + `newPage()` + `goto({ waitUntil: "domcontentloaded", timeout })`
     + `content()` + `close()`, with `try/finally` cleanup.
   - Keep `MAX_RETRIES`, `calculateBackoffDelay`, `sleep`, structured
     `logger.warn/info/error` calls.
   - On the final failure, return `null` exactly as before.

4. **Local network proof**:
   - Direct Node script calling `fetchPage("https://www.thewarehouse.co.nz/p/...")`
     → assert `200` + HTML contains a price element.
   - Direct Node script calling `fetchPage(pbtech URL)` → still `200` with the
     existing JSON-LD.
   - Direct Node script calling `fetchPage(https://www.apple.com/)` →
     regression: still `200` (sites that don't need a browser still work).

5. **Playwright browser install**:
   - Run `pnpm --filter @iris/prices exec playwright install chromium`.
   - Confirm the browser binary is in `~/.cache/ms-playwright/chromium-*/`.

6. **Docker image**:
   - Update `Dockerfile` to install the chromium runtime libraries with
     `apk add --no-cache` (see design.md for the list).
   - Add the `playwright install chromium` build step (only the browser
     binary, not the system deps, since we did those above).
   - `docker compose build app` succeeds.

7. **Validation commands**:
   - `pnpm typecheck` (whole monorepo).
   - `pnpm lint` (whole monorepo).
   - `docker compose build app` to validate the alpine + chromium image.

8. **Cleanup**: remove the temporary proof scripts created during step 4
   before finishing.

## Risky files / rollback points

- `packages/prices/src/pipeline/fetch-page.ts` — the only behavioral change.
- `packages/prices/package.json` + `pnpm-lock.yaml` — dep swap
  (`wreq-js` out, `playwright` in).
- `apps/web/next.config.ts` — `serverExternalPackages` cleanup.
- `Dockerfile` — adds chromium libs + browser install.

Roll back by reverting these four files; the runtime is otherwise identical.

## Follow-up gates before `task.py finish`

- [ ] Playwright installs cleanly and `chromium` launches headless on macOS
      (dev) and alpine (container).
- [ ] Thewarehouse, pbtech, and a non-protected site all return `200` +
      parseable HTML through `fetchPage`.
- [ ] No `wreq-js` reference remains in source or config.
- [ ] `pnpm typecheck` and `pnpm lint` are clean.
- [ ] `docker compose build app` is clean.

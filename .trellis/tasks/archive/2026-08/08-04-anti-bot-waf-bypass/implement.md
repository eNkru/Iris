# Implement — Anti-bot WAF (Akamai) bypass

Ordered execution. The empirical Farmers spike is step 1 and gates everything.

## Validation commands (repo root)

- `pnpm typecheck` · `pnpm lint`
- Spike: `node <spike-script>` against `https://www.farmers.co.nz/...` (see step 1)
- `pnpm --filter @iris/prices exec playwright install --with-deps chromium` (if a new binary is needed)

## Step 0 — Pre-flight: confirm current Farmers behavior (evidence baseline)

Quick standalone Playwright script: fetch Farmers with the current (non-stealth)
config, assert HTML contains `/WAF_Deny_Page/` and no price tokens. This
confirms the baseline before changing anything. (Already done during research —
re-confirm if deps change.)

## Step 1 — EMPIRICAL SPIKE (gates the stealth approach) [highest risk]

Goal: prove `playwright-extra` + `puppeteer-extra-plugin-stealth` defeats
Farmers' Akamai before wiring it into the app.

1. `pnpm --filter @iris/prices add playwright-extra puppeteer-extra-plugin-stealth`
   (pins latest compatible; verify `playwright-extra` peer is `playwright: '*'`).
2. Verify only ONE chromium binary exists after install (no second download).
3. Standalone spike script (run from `packages/prices/` so deps resolve):
   ```js
   const { chromium } = require('playwright-extra');
   const StealthPlugin = require('puppeteer-extra-plugin-stealth');
   chromium.use(StealthPlugin);
   (async () => {
     const b = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
     const ctx = await b.newContext();
     const p = await ctx.newPage();
     await p.goto('https://www.farmers.co.nz/women/accessories/hats-beanings/boston-bailey-suede-cap-espresso-7016377', { waitUntil: 'domcontentloaded', timeout: 45_000 });
     const html = await p.content();
     console.log('len', html.length, 'deny?', html.includes('/WAF_Deny_Page/'), '$-prices?', (html.match(/\$\s?\d+/g) || []).slice(0,5));
     await b.close();
   })();
   ```
4. **Gate**:
   - If `deny?` is false AND `$-prices?` is non-empty → stealth works → proceed to step 2.
   - If `deny?` still true → stealth insufficient against Akamai → try the
     **manual-`addInitScript` fallback** (port core evasions: webdriver, plugins,
     languages, WebGL vendor/renderer, permissions) and re-run the spike. If
     still fails → stop, ship **detection-only** (step 3 + 4), defer evasion.
   - If `playwright-extra` throws on import/launch (version drift with 1.49.1) →
     drop it, use the manual `addInitScript` fallback, re-spike.

**Do not proceed past step 1 until the spike gives a clear verdict.** Record the
verdict in the task notes.

## Step 2 — Wire stealth into the transport

Files:
- `packages/prices/src/pipeline/fetch-page.ts`:
  - Change the dynamic `import("playwright")` → `import("playwright-extra")`.
  - In `getBrowser()`, register `StealthPlugin` once before
    `chromium.launch` (guard with a module-level boolean so it's only registered
    once — `playwright-extra`'s `use()` is idempotent but be explicit).
  - Add `args: ["--disable-blink-features=AutomationControlled"]` to
    `chromium.launch(...)`.
  - Keep everything else (shared browser, fresh context per call,
    `waitUntil: "domcontentloaded"`, retry/backoff, `pLimit`, logging) unchanged.
- `packages/prices/package.json` — `playwright-extra` + `puppeteer-extra-plugin-stealth` already added in step 1; pin the resolved versions.
- `apps/web/package.json` — add the same two packages at the same versions (so
  pnpm symlinks them into `apps/web/node_modules/` — same rule as `playwright`,
  `performance.md:541-548`).
- `apps/web/next.config.ts` — add `playwright-extra` + `puppeteer-extra-plugin-stealth`
  to `serverExternalPackages`.
- `pnpm install` to refresh the lockfile + symlinks.

Validate: `pnpm typecheck` + `pnpm lint`. Manual: run the app, create a Farmers
product, confirm the price is extracted (the spike proves the transport; this
confirms end-to-end).

## Step 3 — WAF-deny detection (always shipped, zero-risk)

Files:
- `packages/prices/src/pipeline/blocked-signatures.ts` (new):
  - `BLOCKED_SIGNATURES` array: `{ id: string; test: (html: string) => boolean }`.
    First entry: `{ id: "akamai-waf", test: (h) => h.includes("/WAF_Deny_Page/") }`.
    (Cloudflare challenge signature left as a commented-out future entry — its
    sites currently pass via the JS challenge, so a deny signature isn't needed
    yet; keep the structure extensible.)
  - `detectBlockedPage(html: string): string | null` — returns the matched
    signature's `id`, or `null`. Run on the fetched HTML before any AI call.
- `packages/prices/src/pipeline/check-price.ts`:
  - After `const page = await fetchPage(...)` and the `!page` guard, call
    `const blocked = detectBlockedPage(page.html)`.
  - If `blocked` → `await touchLastCheckedAt(productId, now);` then
    `return { status: "failed", reason: \`Anti-bot WAF deny page (${blocked}) — retailer blocks automated access.\` }`
    and `logger.warn("Page blocked by anti-bot WAF", { productId, url, signature: blocked })`.
  - This short-circuits before `resolveAiConfig`/`aiExtractPrice`, saving an AI
    call and surfacing the cause. `create.ts:62-65` already includes `check.reason`
    in the rolled-back error message.

Validate: unit-style check — `detectBlockedPage` on the spike's deny HTML returns
`"akamai-waf"`; on a normal product page returns `null`. `pnpm typecheck` + `lint`.

## Step 4 — Spec update

File: `.trellis/spec/backend/performance.md` ("Page Fetch Transport" section,
~line 455-572):
- Note that headless Chromium is NOT universally compatible — Akamai Bot Manager
  serves a WAF deny page; document the Farmers evidence.
- Document the stealth layer: `playwright-extra` + `puppeteer-extra-plugin-stealth`
  applied globally + `--disable-blink-features=AutomationControlled`; note the
  empirical nature (cat-and-mouse) and the manual-`addInitScript` fallback.
- Document the `blocked-signatures.ts` detection pattern + the
  `detectBlockedPage` short-circuit in `checkPrice`.
- Keep the anti-pattern note (no per-retailer branch) — stealth + detection
  are both global.

## Step 5 — Full validation & quality gate

- `pnpm typecheck` + `pnpm lint` green.
- Spike re-run after wiring: Farmers returns real HTML (no `/WAF_Deny_Page/`).
- End-to-end: create a Farmers product in the app → price extracted (AC2).
- For a site that still can't be defeated (if stealth fails): confirm the create
  failure message says "Anti-bot WAF deny page …" (AC1).
- `trellis-check` pass before commit.

## Risky files / rollback points

- **`fetch-page.ts`** — the stealth wiring is the riskiest edit (version drift,
  double binary). Rollback = revert the import to `playwright`, drop the launch
  arg. The detection layer (step 3) is independent and can stay.
- **`apps/web/next.config.ts`** + two `package.json` — if webpack can't
  externalize `playwright-extra` at runtime, the server bundle throws
  "Cannot find module". Same `serverExternalPackages` mechanism that already
  works for `playwright` — low risk, but verify the server boots.
- **`pnpm-lock.yaml`** — two new deps; commit together with the package.json
  changes.
- **The spike verdict** — if step 1 fails and the manual fallback also fails,
  ship detection-only and defer evasion (don't force a broken stealth layer).

## Follow-up checks before `task.py start`

- [ ] Spike verdict recorded (stealth works / manual fallback works / detection-only).
- [ ] Single chromium binary confirmed (no `playwright-extra`-bundled duplicate).
- [ ] `pnpm typecheck` + `pnpm lint` green.
- [ ] Farmers end-to-end test plan ready (AC2), OR detection-only AC1 plan if
      evasion deferred.
- [ ] `performance.md` spec updated.

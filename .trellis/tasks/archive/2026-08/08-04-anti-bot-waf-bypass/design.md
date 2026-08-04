# Design — Anti-bot WAF (Akamai) bypass for blocked retailers

## 1. Problem & approach

Farmers (and any retailer behind Akamai Bot Manager) serves a ~5 KB **WAF deny
page** (`<link href="/WAF_Deny_Page/...">`, title just "Farmers") to headless
Chromium — the real product page never reaches the model, so the AI correctly
reports "unavailable" and the product creation rolls back. The repo's existing
"single Playwright headless Chromium transport" (per `performance.md:455-572`)
defeats Cloudflare but not Akamai.

**Approach (per user decision: lightweight stealth, global, no proxy):**
- Apply **stealth evasion globally** to every fetch — no per-retailer branch
  (preserves the spec's universal-transport principle, `performance.md:567-572`).
- Add **WAF-deny detection** so blocked sites surface a clear reason instead of
  masking as "unavailable" — zero-ToS-risk, useful regardless of evasion.

This is gray-area ToS territory (the user owns that risk; they previously
rejected only CAPTCHA-solving, `performance.md:537`). No residential proxy,
no infra, no new secrets.

## 2. Stealth mechanism

**Primary**: `playwright-extra` (drop-in for `playwright`, peer-deps
`playwright: '*'` so it reuses the pinned 1.49.1 browser binary — no second
binary, avoiding the warning at `performance.md:541-545`) +
`puppeteer-extra-plugin-stealth@2.11.2` (the canonical, maintained stealth
plugin: masks `navigator.webdriver`, `chrome.runtime`, permissions, plugins,
languages, WebGL, media codecs, sourceURL, etc.). Applied once at browser
launch; every fresh `context`/`page` inherits it.

**Free hardening** (regardless of plugin): launch args
`['--disable-blink-features=AutomationControlled']` (drops the `webdriver`
flag) on the shared `chromium.launch`.

**Fallback** (if `playwright-extra@4.3.6` proves runtime-incompatible with
Playwright 1.49.1 during the empirical spike): hand-maintained evasion via
`context.addInitScript` covering the core Akamai signals (webdriver, plugins,
languages, WebGL vendor/renderer, permissions). Zero new deps, but less
comprehensive and self-maintained.

Effectiveness against Akamai's current release is **empirical, not guaranteed**
— the implementation gates on a live Farmers probe.

## 3. WAF-deny detection

A small signature check on the fetched HTML, run in `checkPrice` right after
`fetchPage` (before the AI is called — a deny page wastes an AI call). A
generic anti-bot signature registry (not per-retailer code):

```ts
// packages/prices/src/pipeline/blocked-signatures.ts (new)
const BLOCKED_SIGNATURES = [
  { id: "akamai-waf", test: (html) => html.includes("/WAF_Deny_Page/") },
  // future: { id: "cloudflare-challenge", test: (html) => html.includes("cf-chl-bypass") },
];
```

When matched: `checkPrice` returns
`{ status: "failed", reason: "Anti-bot WAF deny page (akamai-waf) — retailer blocks automated access" }`
and logs it. `create.ts:62-65` already surfaces `check.reason` in its error
message, so the operator sees "Could not read a price from the page:
Anti-bot WAF deny page…" instead of the generic "unavailable" text. No new
`CheckPriceResult` status (MVP) — the clear `reason` string is enough; a
distinct `blocked` status with different retry behavior is a noted follow-up.

Detection runs even when stealth is active, because stealth may not defeat every
anti-bot system — a clear failure beats a silent "unavailable".

## 4. Architecture & boundaries

| Layer | File | Change |
|---|---|---|
| Transport | `packages/prices/src/pipeline/fetch-page.ts` | Import from `playwright-extra`; register `StealthPlugin` once before `chromium.launch`; add `--disable-blink-features=AutomationControlled` to launch args. `getBrowser()` lazy-imports `playwright-extra` + the plugin. |
| Detection | `packages/prices/src/pipeline/blocked-signatures.ts` (new) | Generic anti-bot signature registry + `detectBlockedPage(html)` helper. |
| Pipeline | `packages/prices/src/pipeline/check-price.ts` | After `fetchPage`, call `detectBlockedPage(page.html)`; if matched, short-circuit to `{ status: "failed", reason: "Anti-bot WAF deny page …" }` without calling the AI. |
| Deps | `packages/prices/package.json` | Add `playwright-extra` + `puppeteer-extra-plugin-stealth`. Keep `playwright`. Pin versions. |
| Deps | `apps/web/package.json` | Add the same two packages (so pnpm symlinks them into `apps/web/node_modules/` for the Next.js server bundle — same wiring rule as `playwright` itself, `performance.md:541-548`). |
| Config | `apps/web/next.config.ts` | Add `playwright-extra` + `puppeteer-extra-plugin-stealth` to `serverExternalPackages`. |
| Spec | `.trellis/spec/backend/performance.md` | Update the "Page Fetch Transport" section: stealth evasion is now part of the universal transport; document the WAF-deny detection pattern; note Akamai as a known anti-bot system that plain headless Chromium fails on. |

## 5. Data flow

```
checkPrice(productId)
  → fetchPage(url)                         [Playwright + stealth, global]
  → detectBlockedPage(page.html)           [signature registry]
       └─ match → { status: "failed", reason: "Anti-bot WAF deny page …" }  (no AI call)
  → resolveAiConfig + aiExtractPrice       [if not blocked]
  → create.ts surfaces check.reason         ["Could not read a price: Anti-bot WAF …"]
```

## 6. Compatibility, risk & rollback

- **Empirical gate**: step 1 of implementation is a standalone spike — install
  the two deps, wire stealth, fetch Farmers, assert the HTML no longer contains
  `/WAF_Deny_Page/` and a price token appears. If the spike fails, either try
  the manual-`addInitScript` fallback or defer evasion and ship detection-only.
- **Version risk**: `playwright-extra@4.3.6` peer-deps `playwright: '*'`; if its
  API has drifted from 1.49.1 at runtime, fall back to manual `addInitScript`.
- **Double-binary guard**: `playwright-extra` must reuse the consumer's
  `playwright` (not bundle its own). Verify after install that only one chromium
  binary is downloaded (`~/Library/Caches/ms-playwright` / `/ms-playwright`).
- **Rollback**: revert `fetch-page.ts` imports to `playwright`, remove the two
  deps + next.config entries. `blocked-signatures.ts` and the `check-price.ts`
  detection call can stay (they're zero-risk and useful on their own).
- **Ongoing maintenance**: stealth is a cat-and-mouse game; Akamai updates may
  re-break evasion. The WAF-deny detection makes breakages diagnosable
  (failures surface as "blocked" rather than silently degrading to
  "unavailable").

## 7. Trade-offs

- **Stealth vs. residential proxy**: stealth only defeats browser-fingerprint
  detection; if Akamai also flags the datacenter IP, stealth alone won't help.
  The user declined residential proxy for now; if stealth proves insufficient,
  proxy becomes the documented next escalation.
- **Detection-only fallback**: if stealth can't defeat Akamai, shipping
  detection still improves the operator experience (clear failure reasons) and
  is zero-ToS-risk.
- **Global application**: stealth applies to every fetch (not just Farmers),
  which may slightly change behavior for currently-working sites — but stealth
  plugins are designed to be transparent to sites that don't anti-bot, so the
  risk is low.

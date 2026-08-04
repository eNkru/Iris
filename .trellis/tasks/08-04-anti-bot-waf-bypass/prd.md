# Bypass anti-bot WAF (Akamai) for blocked retailers

## Goal

Let the price pipeline fetch the real product page for retailers behind Akamai
Bot Manager (e.g. `farmers.co.nz`), so the AI can extract a price instead of
seeing a 5 KB WAF "deny" page. At minimum, surface a clear "blocked" signal
instead of masking it as "unavailable".

## Background — confirmed from code + a live probe

- **Live probe** (Playwright headless Chromium, 2026-08-04): Farmers returns
  HTTP 200 with **5,419 chars of HTML** whose `<head>` includes
  `<link href="/WAF_Deny_Page/failover_files/style.css">` and a title of just
  "Farmers". No price tokens, no price script blobs, at both `domcontentloaded`
  and `networkidle`. This is an **Akamai Bot Manager WAF deny page** — the real
  product page is never delivered.
- **Current transport** — `packages/prices/src/pipeline/fetch-page.ts`: a single
  Playwright headless Chromium browser (`chromium.launch({ headless: true })`),
  launched once per process, shared across all `fetchPage` calls; fresh
  `context` per call; `waitUntil: "domcontentloaded"`, `FETCH_TIMEOUT_MS = 30_000`,
  3 retries with backoff, shared `pLimit(5)`.
- **Documented contract** — `.trellis/spec/backend/performance.md:455-572`:
  single Playwright transport for every retailer; **no per-retailer branch**
  (anti-pattern, line 567-572); rejects CAPTCHA-solving (ToS risk, line 537),
  TLS-profile rotation, and Puppeteer. Calls headless Chromium "the only
  universally-compatible transport" — Akamai disproves this.
- **Prior task** `08-02-playwright-page-fetch` (archived): replaced
  `undici` + `wreq-js` with Playwright to defeat Cloudflare for
  `thewarehouse.co.nz` / `pbtech.co.nz`. Same `reducePageHtml` + `fetchPage`
  tool path feeds the AI.
- **Pipeline behavior on block today**: `aiExtractPrice` sees the deny page,
  the model returns `available: false`, `checkPrice` returns
  `{ status: "unavailable" }`, and `create.ts:53-65` rolls back the product with
  the generic "unavailable or no visible price" text — the operator cannot tell
  anti-bot from a genuinely out-of-stock page.
- **Research**: `playwright-stealth` (npm) is a dead placeholder.
  `playwright-extra@4.3.6` peer-deps `playwright: '*'` → reuses the pinned
  1.49.1 binary (no second binary). `puppeteer-extra-plugin-stealth@2.11.2` is
  the canonical maintained stealth plugin.

## Key decisions

- **D1. Lightweight stealth, applied globally** (user decision). Add stealth
  evasion to the shared Playwright transport — no per-retailer branch, no
  residential proxy, no infra/secrets. Gray-area ToS risk owned by the user
  (consistent with their prior stance: they rejected CAPTCHA-solving but not
  stealth).
- **D2. Primary mechanism** (technical, decided in `design.md`):
  `playwright-extra` + `puppeteer-extra-plugin-stealth`, registered once before
  `chromium.launch`, plus the free launch arg
  `--disable-blink-features=AutomationControlled`. Manual `addInitScript`
  evasion is the fallback if `playwright-extra` proves incompatible with
  Playwright 1.49.1.
- **D3. WAF-deny detection, always shipped** (zero-ToS-risk). A generic
  anti-bot signature registry (`blocked-signatures.ts`) checks the fetched HTML;
  `checkPrice` short-circuits to a clear `{ status: "failed", reason: "Anti-bot
  WAF deny page …" }` before calling the AI, so `create.ts` surfaces the cause.
- **D4. No new `CheckPriceResult` status for MVP** — the clear `reason` string
  is enough; a distinct `blocked` status with different retry behavior is a
  noted follow-up.
- **D5. Empirical gate** — step 1 of implementation is a standalone Farmers
  spike that must prove stealth defeats Akamai before wiring it in. If it
  fails (and the manual fallback fails too), ship **detection-only** and defer
  evasion.

## Requirements

- **R1.** Stealth evasion is applied to every `fetchPage` call globally, with no
  per-hostname branch (preserves `performance.md:567-572`).
- **R2.** `fetchPage` reuses the existing pinned Playwright 1.49.1 browser
  binary (no second binary download).
- **R3.** A generic anti-bot signature check runs on fetched HTML in
  `checkPrice`; when matched, the AI is not called and a clear WAF reason is
  returned + logged.
- **R4.** `create.ts`'s rolled-back error message includes the WAF reason so
  the operator can distinguish anti-bot from genuine "unavailable".
- **R5.** The `performance.md` spec is updated: stealth is part of the universal
  transport; the Akamai evidence + detection pattern are documented.

## Acceptance criteria

- **AC1.** When `fetchPage` returns a WAF deny page (Akamai signature matched),
  `checkPrice` returns `{ status: "failed", reason: "Anti-bot WAF deny page
  (akamai-waf) — retailer blocks automated access." }` and the create flow's
  error message names the anti-bot block (not "unavailable").
- **AC2.** *(gated on the spike)* If stealth defeats Akamai: creating the
  Farmers product succeeds — `fetchPage` returns the real product HTML (no
  `/WAF_Deny_Page/`, a price token present) and a price reading is stored.
  If stealth fails: AC1 holds and the failure is clearly labeled "blocked";
  evasion is deferred (documented in the task notes).
- **AC3.** Only one chromium binary is present after install (no duplicate from
  `playwright-extra`).
- **AC4.** `pnpm typecheck` + `pnpm lint` pass across all workspaces; the Next.js
  server bundle resolves `playwright-extra` at runtime (no "Cannot find module").

## Out of scope

- Per-retailer URL allowlists / hostname-specific fetch code (spec anti-pattern).
- CAPTCHA-solving services (previously rejected for ToS risk).
- Residential/mobile proxies (user declined for now; documented next escalation
  if stealth proves insufficient).
- A distinct `blocked` `CheckPriceResult` status with different retry behavior
  (follow-up; MVP uses a clear `reason` string).
- The generic-AI-config task (in progress, separate).

## Risks / deferred

- Stealth effectiveness against Akamai is empirical; the spike gates the
  approach. Cat-and-mouse maintenance is expected.
- Stealth defeats browser-fingerprinting only; if Akamai also flags the
  datacenter IP, residential proxy is the documented next escalation (deferred).
- `playwright-extra@4.3.6` may have API drift from Playwright 1.49.1 → manual
  `addInitScript` fallback.

## Artifact status

`prd.md` ✓ · `design.md` ✓ · `implement.md` ✓ (complex task — all three before
`task.py start`). Planning; awaiting final-review approval.

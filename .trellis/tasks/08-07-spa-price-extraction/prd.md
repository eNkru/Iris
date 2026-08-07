# Fix SPA price extraction: wait for JS-rendered price in sidecar

## Goal

Client-rendered SPA product pages (Angular/React/Next.js) inject their price via
JavaScript *after* `domcontentloaded` fires. The sidecar currently snapshots
`page.content()` at `domcontentloaded`, so for these pages it captures an empty
shell with zero price data — `reducePageHtml` produces empty content, the AI
faithfully reports `{available:false}`, and `checkPrice` returns
`{status:"unavailable"}` → product create rolls back.

Confirmed case: `woolworths.co.nz/shop/productdetails` (Angular SPA). Sidecar
fetch succeeds (28 KB HTML, HTTP 200, no anti-bot block); body stripped-text
length is **0**; no `price`/`formattedValue`/`currency`/`NZD`/product name
anywhere in the raw HTML; the only `ld+json` is a generic `WebSite`
`SearchAction`, not a `Product`/`Offer`. The price is rendered at runtime by the
JS app after hydration.

Goal: the sidecar waits for the JS app to render the price (or a meaningful
page) before snapshotting HTML, so SPA PDPs extract like static ones — without
unacceptably slowing down static pages or breaking the anti-bot pass rate.

## Background

- Sidecar fetch: `camoufox/server.py` `POST /v1/fetch`, `page.goto(url,
  wait_until="domcontentloaded", timeout=45s)` then `page.content()`
  (server.py:232-236). `domcontentloaded` fires when the static shell parses,
  before hydration/JS data fetch.
- App pipeline: `fetchPage` (TS HTTP client) → `checkPrice` → `reducePageHtml`
  (`packages/prices/src/pipeline/ai-extract.ts`) → `generateText` extraction.
  For an SPA shell, `reducePageHtml` yields empty visible text + zero
  price-bearing script blobs → AI sees nothing → `available:false`.
- The `08-06-camoufox-sidecar-diagnose` task added failure accounting; this is a
  *different* failure mode — the sidecar fetch is healthy, the page just has no
  price in the snapshot. The diagnostic counter does NOT fire here (the fetch
  returns `{ok:true}`).
- Spec: `backend/performance.md:618` documents the current `domcontentloaded`
  contract; the SPA-rendered-price case is not covered anywhere.
- Anti-pattern guardrail (`backend/performance.md:632`): no per-retailer code or
  hostname branching. The fix must be generic, not "if woolworths then X".

## Requirements

- R1. After navigation, wait for the page's JS to render meaningful content
  before calling `page.content()` — so the price (or visible product text) is
  present in the snapshot for SPA PDPs.
- R2. The wait must be **generic** (no retailer/host branching, no per-site
  selectors). It may use a content-based heuristic or a Playwright wait state,
  not a hardcoded selector list.
- R3. Must not regress static pages: pages whose price is already in the
  `domcontentloaded` HTML (e.g. server-rendered retailers) must still extract
  correctly and must not pay an unbounded extra wait.
- R4. Must be bounded: the extra wait has a cap (short, e.g. a few seconds) so a
  page that never renders content still fails within the existing 45 s timeout
  envelope and does not hang the semaphore slot.
- R5. Must not regress the anti-bot pass rate: Camoufox's stealth advantage
  depends on natural navigation timing. The change must not introduce a wait
  pattern that trips the WAF/challenge classes Camoufox currently passes
  (DataDome / Cloudflare managed / Akamai).
- R6. No API contract change: `/v1/fetch` still returns
  `FetchResponseOk | FetchResponseFail` with identical bodies; `/health`
  unchanged. `FETCH_TIMEOUT_SECONDS` and `SIDECAR_CONCURRENCY` unchanged.
- R7. The diagnostic logging added in `08-06-camoufox-sidecar-diagnose`
  (failure accounting, `error_type`) must remain intact; if the wait itself
  raises/times out, it flows through the existing failure paths.
- R8. Contained: primary change in `camoufox/server.py`. Spec update in
  `backend/performance.md` (the `domcontentloaded` contract line + a new SPA
  section). No app-side change required (`reducePageHtml` already handles
  whatever HTML it receives).

## Acceptance Criteria

- [ ] Fetching a woolworths PDP via the sidecar returns HTML that contains the
      rendered price (visible text length > 0 AND a price-bearing token
      present) — extractable by the existing AI pipeline to
      `{available:true, price, currency, name}`.
- [ ] A static (server-rendered) PDP still extracts correctly and its fetch
      latency does not increase by more than the wait cap (no unbounded hang).
- [ ] A page that never renders meaningful content fails within the 45 s
      timeout (no new hang); the failure flows through the existing
      `_record_failure` path (counter/diagnostics unchanged).
- [ ] No per-retailer/host branching or selector list in the sidecar (grep for
      `woolworths`/hostname `if` returns nothing).
- [ ] `/v1/fetch` and `/health` responses are identical in shape to pre-change
      (ok/non-2xx/timeout/error paths unchanged).
- [ ] `git diff` touches `camoufox/server.py` and the spec only; no dependency
      changes, no app-side changes.

## Out of Scope

- Per-retailer price selectors / hostname branching (explicit anti-pattern).
- AI prompt changes — extraction works once the HTML contains the price.
- The browser-degradation self-heal (separate task).
- Changing `FETCH_TIMEOUT_SECONDS` (45 s) or `SIDECAR_CONCURRENCY` (5).

## Open Questions

- Wait-strategy choice (generic content heuristic vs `networkidle` vs a
  combination) — this is the core design decision, resolved in `design.md`
  after a quick experiment against the live sidecar.

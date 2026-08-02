# Support bot-protected retailer URL parsing (Cloudflare Managed Challenge)

## Goal

Allow product URLs from Cloudflare-proxied retailers (pbtech.co.nz,
thewarehouse.co.nz, and any future site using a similar Managed Security
Challenge) to be added and successfully tracked. The fetcher must return the
product HTML — and therefore the price — without being tripped by the
challenge, so the create flow's first sync `checkPrice` records a successful
reading instead of rolling the product row back.

Root cause is a transport-layer failure, not a missing retailer mapping: Node's
native `fetch` (undici) is flagged by Cloudflare's HTTP/2 + TLS fingerprinting,
and a single browser-TLS impersonator profile (`chrome_130` via `wreq-js`) is
insufficient — Cloudflare's scoring also rejects all `chrome_*` profiles on
some sites (e.g. thewarehouse.co.nz).

## Background / confirmed facts

- URLs under test:
  - `https://www.pbtech.co.nz/product/NBKHNB161049/HP-HyperX-OMEN-16-ap1049AX-NVIDIA-GeForce-RTX-5060` (JSON-LD `price: 4999`, `priceCurrency: NZD`).
  - `https://www.thewarehouse.co.nz/p/kpop-demon-hunters-comforter-set-2-piece-double/R3064250.html`.
- The create flow (`packages/api/src/modules/products/procedures/create.ts:51`)
  runs the first synchronous `checkPrice`; on failure it **rolls back the
  product row** and surfaces `"Could not read a price from the page: <reason>.
  The product was not added."`
- Both sites sit behind **Cloudflare Managed Security Challenge**:
  - Response header `Server: cloudflare`, `Cf-Mitigated: challenge`, `cf-ray`.
  - HTML contains `<title>Just a moment...</title>` and a `_cf_chl_opt` script
    block (`cType: 'managed'`) that requires JavaScript execution to solve.
- `wreq-js` profile probe (offline testing, 2026-08-02):
  - `chrome_130` / `chrome_142` / `chrome_147` → `403` on thewarehouse.
  - `firefox_149` / `safari_18.5` → `200` on thewarehouse.
  - All profiles pass on pbtech.
- This shows a **single browser profile is not robust**: Cloudflare's
  fingerprint scoring treats one browser family (all `chrome_*` versions) as a
  single class, so profile rotation alone cannot cover sites that explicitly
  reject Chrome-style fingerprints.
- The only universally-compatible solution is a real headless browser that
  executes the challenge JavaScript. **Playwright (chromium)** is the chosen
  transport for every fetch in the pipeline.
- There is no URL allowlist; `createProductInputSchema`
  (`packages/api/src/modules/products/types.ts:30`) only validates http(s).

## Goal

Any retailer product URL — including those behind Cloudflare Managed Security
Challenge — can be added, fetched, and price-extracted reliably, using a single
real-browser transport. The previous `wreq-js`-based TLS-impersonation fallback
is removed; the fetch layer is replaced with Playwright.

## Requirements

- R1: The page fetcher must obtain the product HTML for any retailer the user
  adds, including sites behind Cloudflare Managed Security Challenge. The
  previous "Page fetch failed" rollback on thewarehouse-style sites is no
  longer acceptable.
- R2: A single transport — Playwright headless Chromium — replaces both the
  undici fetch and the `wreq-js` browser-TLS fallback. The solution is
  generic; no per-retailer code paths.
- R3: Preserve the existing `FetchPageResult | null` contract and the shared
  `pLimit` concurrency limiter in `fetch-page.ts`. Caller code (`checkPrice`,
  `ai-extract`, the `fetchPage` tool) is unchanged.
- R4: Preserve structured logging (Sentry-friendly context: `url`, `status`,
  `productId`, attempt). The browser launch / first-page error is also logged.
- R5: The Playwright browser is launched **once per process** and shared
  across all `fetchPage` calls. Each call creates a fresh `context` + `page`
  (so cookies / storage don't leak between retailers) and disposes them after
  the response is read.
- R6: The Docker image must include a working Chromium that the Node process
  can launch headlessly. The current `node:22-alpine` base needs the runtime
  libraries Playwright's chromium build requires.

## Acceptance Criteria

- [ ] Adding
      `https://www.thewarehouse.co.nz/p/kpop-demon-hunters-comforter-set-2-piece-double/R3064250.html`
      creates a product row and records a successful first price reading
      (not a rollback).
- [ ] Adding the pbtech URL still works (no regression).
- [ ] `fetchPage` no longer depends on `wreq-js`; the package is removed from
      `packages/prices` dependencies.
- [ ] The Docker image builds cleanly and the app container can launch
      Playwright Chromium at runtime.
- [ ] `pnpm typecheck` and `pnpm lint` pass across the monorepo.

## Out of Scope

- UI / form changes.
- Adding retailer-specific coupons or SKU variant selection.
- Headed (non-headless) browser runs.
- Mobile-emulation profiles.
- Proxy / IP rotation; we accept that aggressive IP-level rate limits remain
  the responsibility of upstream scheduling/backoff.

## Open Questions

- None at start of execution.

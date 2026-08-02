# Support pbtech.co.nz product URL parsing

## Goal

Allow a pbtech.co.nz product URL to be added and successfully tracked, so its
price is captured and monitored like products from other retailers already are.
Root cause is a fetch-layer failure, not a missing retailer mapping.

## Background / confirmed facts

- URL under test: `https://www.pbtech.co.nz/product/NBKHNB161049/HP-HyperX-OMEN-16-ap1049AX-NVIDIA-GeForce-RTX-5060`.
- The create flow (`packages/api/src/modules/products/procedures/create.ts:51`)
  runs the first synchronous `checkPrice`; on failure it **rolls back the
  product row** and surfaces `"Could not read a price from the page: <reason>.
  The product was not added."`
- User observed failure reason: `"Page fetch failed"`.
- The page fetch is Node's native `fetch` (undici) in
  `packages/prices/src/pipeline/fetch-page.ts:58`.
- pbtech is behind **Cloudflare Managed Security Challenge**. With the app's
  undici call the response is `403` (`server: cloudflare`, `cf-ray` header
  present) — undici's HTTP/2 + TLS fingerprint is flagged as a bot.
- `curl` to the same URL returns `200` on both HTTP/1.1 and HTTP/2
  (curl's TLS fingerprint passes the challenge). The page HTML contains a
  product JSON-LD block with `"price": 4999, "priceCurrency": "NZD"`, so the
  price is extractable once HTML is delivered.
- `403` is NOT in `RETRYABLE_STATUS_CODES`
  (`packages/prices/src/pipeline/fetch-page.ts:16`), so the fetch fails
  immediately instead of retrying/falling back.
- There is no URL allowlist anywhere; `createProductInputSchema`
  (`packages/api/src/modules/products/types.ts:30`) only validates http(s).

## Goal

pbtech.co.nz product URLs can be added, fetched, and price-extracted reliably.

## Requirements

- R1: The page fetcher must obtain pbtech product HTML (bypass the Cloudflare
  challenge) instead of failing on 403.
- R2: The fix should be generic where cheap — not coded specifically to a single
  pbtech URL — and must not break existing retailers (fetch currently works for
  others).
- R3: When the delivery layer returns a challenge/403, the pipeline should
  classify & fall back gracefully (retry/alternate transport) rather than a
  one-shot failure.
- R4: Preserve structured logging and the shared concurrency limiter
  (fetch-page.ts) already used by the pipeline.

## Acceptance Criteria

- [ ] Adding
      `https://www.pbtech.co.nz/product/NBKHNB161049/HP-HyperX-OMEN-16-ap1049AX-NVIDIA-GeForce-RTX-5060`
      creates a product row and records a successful first price reading
      (price ~4999 NZD), not a rollback.
- [ ] A pbtech fetch no longer returns status `403`/`"Page fetch failed"` via
      the pipeline's `fetchPage`.
- [ ] Existing retailers (others already passing) continue to fetch successfully
      (no regression).
- [ ] Extraction returns a price for the pbtech page (name, currency, available).

## Out of Scope

- UI / form changes.
- Adding pbtech-specific coupons, multiple SKU variants selection.
- Broadly solving Cloudflare for arbitrary sites (only the facilities needed to
  fetch a product page).
- Storefront structured data beyond the price/name/currency extraction.

## Open Questions

Decided (see design): transport/fallback approach for challenge bypass.
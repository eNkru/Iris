# Tech Design — pbtech.co.nz fetch support

## Problem

`fetchPage` uses Node's native `fetch` (undici). pbtech.co.nz sits behind
Cloudflare **Managed Security Challenge**, which fingerprints the HTTP/2 + TLS
client. undici is flagged → `403` → not in `RETRYABLE_STATUS_CODES`
(`fetch-page.ts:16`) → immediate failure → product rollback.

Verified: curl passes on HTTP/1.1 and HTTP/2 (its TLS fingerprint is
browser-like); Node undici fails. Hence the fix is at the transport layer, not
retailer mapping.

## Decision: transport fallback using a browser-TLS library

Per user decision, replace/fail-over the straight undici fetch with a browser
TLS fingerprint impersonator.

### Library choice

Two viable candidates:

- `wreq-js` — Rust `wreq` native bindings via NAPI, MIT license, actively
  maintained (2025+), fetch-style API, TS-first, per-request/session control.
  GitHub `0x677e6/e/wreq-js`.
- `node-tls-client` — native shared-library bindings, GPL-3.0 license, older
  (last publish ~1yr).

**Recommendation: `wreq-js`** — MIT license (no copyleft infection on the app),
modern, `after`-profile support, identical fetch style to what the pipeline
already uses. Its native artifacts are published for the common platforms;
verify musl/alpine artifact at install time (Docker image is
`node:22-alpine`). If no prebuilt musl artifact exists, we bundle a multi-stage
build that compiles via `@napi-rs/cli` (adds Rust toolchain to the single-stage
Dockerfile) — flagged as deploy risk below.

## Architecture / flow

`fetchPage` keeps its contract (`FetchPageResult | null`) and its
shared-concurrency limiter. Transport selection:

```
fetchPage(url, opts)
  └─ attempt 1: native fetch (undici)   ← current path, no regression for
  │                                         retailers that already work.
  └─ if response.status === 403 || 503 && retryable:
        attempt 2: wreq session (browser profile) ← sfirces Cloudflare
  └─ final null + structured log on total failure
```

Concretely: keep undici as the primary. When `fetchPage` gets a
`403`/`503`/529 Cloudflare challenge (Cloudflare-proxied), retry with the
browser-TLS client using a modern browser profile that matches our UA
(Chrome ~130, matching `User-Agent` header already set in fetch-page.ts:18-19).

## Data flow & contract

- `fetchPage(url)` unchanged signature. Return `{ html, url }` from whichever
  transport produced a `2xx`. Keep retry/backoff/reset semantics; route a
  challenge response into the alternate transport rather than giving up.

## Compatibility & migration notes

- Undici path is untouched for existing retailers → zero regression risk.
- Only Cloudflare-challenged responses (403/503) take the alternate path.
- `wreq-js` must be added to `packages/prices/package.json` deps; pnpm approve
  its build script in `pnpm-workspace.yaml` `allowBuilds` (NAPI native build).
- Dockerfile: if no prebuilt musl artifact, add a Rust build stage and copy the
  resulting `.node` artifact into the runtime image.

## Trade-offs

- Keeping undici primary is the safest (no behavioral change for existing
  retailers); the browser-TLS client is a targeted fallback.
- Extra native dependency increases image build complexity and supply-chain
  surface; mitigated by pinning the version and only using it on challenge.
- GPL-alternative (`node-tls-client`) avoided for licensing harmony with the
  rest of the repo.

## Risks / open items

- **Deploy (blocking-ish):** `node:22-alpine` is musl. If `wreq-js` has no
  prebuilt musl artifact, image build requires Rust toolchain; validate early
  in 2.1 before wiring the pipeline.
- **Library dead-ends:** if `wreq-js` fails to install/run in the container,
  fall back to the GPL `node-tls-client` or a curl subprocess temporary.
- Keep behavior: only challenge 403/503 triggers the alternate transport;
  other 4xx remain hard failures.

## Rollout / rollback

- Backward-compatible single unit: swap lives inside `fetch-page.ts` only.
- Roll back by reverting the single `fetchPage` change (transport selection).

## Verification

See `implement.md`; engine of proof is a network test hitting the pbtech URL
and asserting `fetchPage` returns `200` + parseable HTML.
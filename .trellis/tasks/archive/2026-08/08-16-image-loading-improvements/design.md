# Design — Image loading pipeline improvements

## Architecture at a glance

```
   ┌─────────────────────────────┐
   │ check-price.ts (orchestrator)│
   │  calls downloadProductImage  │
   └──────────────┬───────────────┘
                  │
                  ▼
   ┌─────────────────────────────┐
   │ extract-image.ts            │
   │  - extractProductImageUrl   │  (unchanged)
   │  - downloadProductImage     │  ← HARDENED
   └──────────────┬───────────────┘
                  │ POST /v1/fetch-image
                  ▼
   ┌─────────────────────────────┐
   │ camoufox sidecar (Python)   │
   │  returns { contentType,     │
   │            data (base64) }  │
   └──────────────┬───────────────┘
                  │ Buffer in memory
                  ▼
   ┌─────────────────────────────┐
   │ new: validateImage(buffer,  │
   │         contentType) → {    │
   │            ext, buffer } |  │
   │            null             │
   └──────────────┬───────────────┘
                  │ writeFileSync
                  ▼
   ┌─────────────────────────────┐
   │ IMAGES_DIR / {id}.{ext}     │
   └──────────────┬───────────────┘
                  │
   ▼ HTTP GET /api/images/:id
   ┌─────────────────────────────┐
   │ apps/web/server.ts          │  ← drops "svg" entry
   └─────────────────────────────┘
```

## Module changes

### A. `packages/prices/src/pipeline/retry.ts` (new)

Extracted retry helper. Lives in `packages/prices/` so the
`fetch-page.ts` module can also use it (replacing the existing inlined
`calculateBackoffDelay` / `sleep` for consistency). Single-purpose export:

```ts
export async function retryWithBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { maxRetries: number; baseMs: number; maxMs: number; jitter?: number; onError?: (e: unknown, attempt: number) => void },
): Promise<T>;
```

Semantics:
- `attempt` is 1-indexed.
- Returns the first non-throwing result.
- Throws the last error after `maxRetries` attempts (or re-throws if the
  caller predicate returns false — see `shouldRetry` below).
- Caller decides what's retryable by returning a `RetryDecision`:

```ts
type RetryDecision = { retry: true; retryAfterMs?: number } | { retry: false };
```

This is more flexible than predicate-on-error: the image fetch wants to
retry on 502 but not on schema mismatch, both of which are caught at the
HTTP layer.

### B. `packages/prices/src/pipeline/extract-image.ts` (modified)

#### B1. New content-type → extension table

```ts
const CONTENT_TYPE_EXTENSIONS: Record<string, { ext: string; magic: Buffer }> = {
  "image/jpeg":  { ext: ".jpg",  magic: Buffer.from([0xff, 0xd8, 0xff]) },
  "image/png":   { ext: ".png",  magic: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  "image/gif":   { ext: ".gif",  magic: Buffer.from("GIF87a") /* or GIF89a */ },
  "image/webp":  { ext: ".webp", magic: Buffer.from("RIFF") },  // + WEBP at offset 8
  "image/avif":  { ext: ".avif", magic: Buffer.from([0x00, 0x00, 0x00]) },  // ISOBMFF ftyp box
};
```

GIF and WebP need a tiny extra check (signature continuation) — handled
inline. AVIF/HEIC start with an ISOBMFF box; the simplest reliable check is
"starts with `....ftyp`" looking at bytes 4–8 of the box. Implementation is
small: a `validateMagic(buf, expected)` helper that takes the expected
header bytes and checks the prefix.

The helper returns `{ ext: string; buffer: Buffer }` on success, `null` on
failure. `null` triggers a warning log and downloader returns `null` to the
orchestrator.

#### B2. SVG handling

- `image/svg+xml` is NOT in the new table. Any sidecar response with this
  content type is rejected with a warning. Reason: SVG can carry inline
  scripts and the existing serve endpoint ships the saved bytes into the
  authenticated user's DOM with the same origin — a direct XSS vector when
  the retailer authors a malicious `og:image` (unlikely for the trusted
  retailers in scope, but the indirection through the sidecar makes defense
  in depth cheap).
- The fallback behavior is no longer `.jpg` — it is "skip and warn".

#### B3. Retry + concurrency

```ts
const imageDownloadLimiter = pLimit(IMAGE_DOWNLOAD_CONCURRENCY);  // = 3

export async function downloadProductImage(productId, imageUrl): Promise<string | null> {
  return imageDownloadLimiter(async () => {
    return retryWithBackoff(
      async (attempt) => attemptSidecarFetchImage(imageUrl),
      { maxRetries: 2, baseMs: 1_000, maxMs: 10_000, jitter: 0.5 },
    ).then(/* extract payload, validate, write */).catch((err) => {
      logger.warn("Product image download failed after retries", { productId, imageUrl, error: err.message });
      return null;
    });
  });
}
```

`attemptSidecarFetchImage` is the existing inline fetch, lifted to a
top-level function so it can be wrapped by the retry helper. Throws on
network error, non-2xx status, or schema mismatch. The retry wrapper
classifies these via a small `shouldRetry` predicate in the call site:

```ts
{ retry: true }      // 5xx, network error, AbortError
{ retry: false }     // 4xx (other than 408/429), schema mismatch
```

#### B4. Magic-byte validation

A new `validateImageBuffer` function:

```ts
function validateImageBuffer(buffer: Buffer, contentType: string):
  | { ext: string; contentType: string }
  | null
```

- Looks up `contentType` in the table.
- If the type is not in the table, returns `null`.
- Reads the magic bytes from the buffer and compares to the expected
  signature (with the small per-format nuances noted in B1).
- Returns the verified extension on success.

### C. `apps/web/server.ts` (modified)

The `contentTypes` table at lines 90–98 drops the `svg: "image/svg+xml"`
entry. The `?? "application/octet-stream"` fallback already handles
unknown extensions, so a stale `.svg` row gets `application/octet-stream`
which the browser will refuse to render — but per AC6 we want 404 instead.
The cleanest fix is to check the extension explicitly:

```ts
const ext = product.imagePath.split(".").pop()?.toLowerCase() ?? "";
const contentType = contentTypes[ext];
if (!contentType) {
  return c.body("Not found", 404);
}
```

This drops the `octet-stream` fallback. A `.svg` row, an `.avif` row that
the new server doesn't recognize, or any other unknown extension → 404.

### D. Shared retry helper (optional refactor of `fetch-page.ts`)

The existing `calculateBackoffDelay` and `sleep` are inlined in
`fetch-page.ts`. Migrating to the new shared helper is a small refactor
and improves consistency. Decision: **yes, do it** — keeps the two retry
loops in lockstep and the new helper is tiny.

The signature changing to `{ retry: boolean }` instead of `true/false`
keeps the existing call sites readable.

## Data flow walk-through

Happy path (AVIF image):

1. `checkPrice(productId)` → `imagePath` is null → call `downloadProductImage`.
2. `imageDownloadLimiter` accepts (≤ 3 in flight).
3. `retryWithBackoff` calls `attemptSidecarFetchImage(url)`.
4. Sidecar returns `{ ok: true, contentType: "image/avif", data: "<base64>" }`.
5. Buffer is built (≤ 10 MB, reject if larger).
6. `validateImageBuffer(buffer, "image/avif")` → checks ISOBMFF ftyp box → `{ ext: ".avif" }`.
7. `writeFileSync(IMAGES_DIR/${id}.avif, buffer)`.
8. Returns `"{id}.avif"`.
9. Transaction writes `imagePath: "{id}.avif"`.

Retry path (first 502 then 200):

1. `attemptSidecarFetchImage(url)` → HTTP 502 → throws `SidecarImage5xxError`.
2. `retryWithBackoff` predicate returns `{ retry: true }`. Sleep ~1 s
   (jittered). Attempt 2.
3. `attemptSidecarFetchImage(url)` → HTTP 200 → returns payload.
4. Continues to validation.

SVG reject path:

1. Sidecar returns `contentType: "image/svg+xml"`.
2. `validateImageBuffer` returns `null` (type not in table).
3. Logger warns; downloader returns `null`. No file written, DB row
   `imagePath` stays `null`.

Serve path (legacy `.svg` row):

1. `/api/images/:id` for a product with `imagePath: "{id}.svg"`.
2. `ext = "svg"` → `contentTypes["svg"]` is undefined → return 404.

## Tradeoffs

- **Dropping SVG outright vs. sanitizing.** Sanitization (DOMPurify) is a
  real dependency and a real surface; ROI is low for this app — SVG logos
  in `og:image` are not useful as product imagery. Rejecting is cheaper and
  safer.
- **2 retries vs. 3.** Image fetch is best-effort; the next scheduled
  check will retry naturally. 2 attempts + 1 retry is enough to absorb
  transient 5xx without blocking the pipeline.
- **`pLimit(3)` vs. sidecar semaphore.** The sidecar already has its own
  concurrency limit. The Node-side `pLimit(3)` is a defense against
  buffering many large base64 payloads in memory simultaneously. The
  effective concurrency is `min(3, sidecar_limit)`.
- **Magic-byte strictness.** Checking the full 8-byte PNG signature is
  easy; checking WEBP needs to look at offset 8. We accept the small
  per-format branch to keep the validator correct.

## Backwards compatibility

- **Existing PNG/JPEG/WebP/GIF downloads keep working.** The new validator
  is a strict superset of the old content-type lookup.
- **Existing `.svg` rows in the DB** become 404 until the next check
  downloads a non-SVG image (or stays 404 if the retailer only offers
  SVG). This is acceptable per the design intent.
- **Existing `.avif` rows** (none today — the old code saved them as
  `.jpg`) — the new code saves them as `.avif`, so a fresh check is a
  one-time upgrade.
- **No DB migration:** `imagePath` schema is unchanged.

## Roll-out

- Single PR, single package (`packages/prices`) plus one small edit in
  `apps/web/server.ts`.
- No environment changes.
- No new dependencies (uses `p-limit` already in the package).
- No new env vars.
- Tests: new file `packages/prices/src/pipeline/extract-image.test.ts`
  covers AC1–AC5, AC7. Existing tests serve as the AC8 regression net.

## Rollback

- Revert the PR. No stored data is broken by the change (DB rows still
  hold `imagePath` strings; the worse case is a 404 on a stale `.svg` row,
  which is recoverable on the next check).

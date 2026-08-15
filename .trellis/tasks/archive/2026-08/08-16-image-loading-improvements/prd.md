# Image loading pipeline improvements

## Goal

Harden the server-side product image pipeline so downloads are reliable (retry,
bounded concurrency, content-type-correct), the served bytes are safe (no XSS
via SVG), and the on-disk extension matches what the sidecar actually returns
(no silent `.jpg` for AVIF/HEIC).

Out of scope for this task: redesigning the page-fetch pipeline, replacing the
sidecar, or any UI work.

## Background

`packages/prices/src/pipeline/extract-image.ts` downloads product images from
the retailer's site via the Camoufox sidecar (`POST /v1/fetch-image`) and saves
them to `IMAGES_DIR`. The saved file is then served by
`apps/web/server.ts` (`/api/images/:id`) as the authenticated image endpoint.

The pipeline has four concrete weak spots that surfaced while debugging a
PB Tech product page where the image occasionally fails to load:

1. **Invalid content-type fallback silently writes `.jpg`.** The
   `Content-Type` → extension map at `extract-image.ts:5–11` lists only jpeg,
   png, gif, webp, svg. AVIF, HEIC, BMP, JXL, ICO all fall through to a silent
   `.jpg` default and the serve endpoint then sends the bytes with
   `Content-Type: image/jpeg`, breaking the browser render.
2. **No retry on image fetch.** A single flaky request (Cloudflare 522, DNS
   hiccup, transient 5xx) returns `null` permanently for that product's
   `imagePath`. The page-fetch pipeline retries 3×; the image one does not.
3. **No concurrency limit on image downloads.** Page fetches share
   `pLimit(5)`; image fetches have no limiter. A burst of first-time products
   fires all downloads at once; the sidecar's semaphore + the 10 MB payload
   buffer can spike memory.
4. **SVG is served verbatim to authenticated user's DOM.** `og:image` on many
   retailer pages is a logo SVG; the serve endpoint returns it with
   `Content-Type: image/svg+xml` and a same-origin authenticated response — a
   direct XSS vector if the SVG contains inline scripts.

## Requirements

### R1. Validate image content before saving and serving

- The downloaded buffer must match the claimed content type. If the magic
  bytes don't match the declared MIME, reject the download (`return null`).
- The extension recorded in `imagePath` must match the verified MIME.
- Unknown / unsupported image types must NOT silently become `.jpg`. They
  trigger a warning log and the download is skipped (return `null`).
- The new accepted MIME set is: `image/jpeg`, `image/png`, `image/gif`,
  `image/webp`, `image/avif`. SVG is intentionally excluded from the
  downloader (see R3).

### R2. Retry the sidecar image fetch on transient failures

- Mirror the page-fetch pattern: 2 attempts, exponential backoff with jitter
  (e.g. 1 s base, 50 % jitter, cap 10 s).
- Use the same `calculateBackoffDelay` / `sleep` helpers already defined in
  `fetch-page.ts` (extract to a shared helper if there is no natural place —
  prefer avoiding duplication).
- Network errors, 5xx, and `AbortError` retry. Schema mismatches do not.

### R3. Bound image-download concurrency

- Put the image-download call behind a `pLimit` sized to the camoufox sidecar
  budget. Reasonable default: 3 (smaller than page-fetch's 5 because image
  downloads buffer the full payload in memory).
- The limit must be a module-level singleton, not per-call, so a scheduler
  tick that fires N image downloads is naturally bounded.
- The existing `MAX_IMAGE_BYTES` ceiling (10 MB) remains.

### R4. Reject SVG in the downloader; refuse to serve SVG

- The `extract-image.ts` `CONTENT_TYPE_EXTENSIONS` map drops
  `image/svg+xml`. If the sidecar reports an SVG content type, the download
  is rejected with a warning log and `null` is returned.
- The serve endpoint's extension map in `apps/web/server.ts:90–98` drops the
  `svg: "image/svg+xml"` entry. If a stale DB row has `imagePath` ending in
  `.svg` (pre-fix), the endpoint returns 404 (acceptable — the user can
  re-check and the new downloader will leave it unset / a fresh image will
  overwrite). Do NOT silently serve SVG under `application/octet-stream`.

### R5. Backwards compatibility and clean migration

- Existing products in the DB with `.svg` `imagePath` rows keep working
  *only* in the sense that the broken-404 path is visible to the user; the
  next check will overwrite the row with a fresh non-SVG image when
  available.
- If the first image download produces a new extension for an existing
  product (e.g. AVIF changes the served file), the new file overwrites the
  old extension's file in `IMAGES_DIR` and the DB row is updated. No stale
  orphan files are left behind (the deletion of the old file is a
  follow-up improvement; out of scope here but documented in notes).

## Out of scope

- Changing which image URL is preferred (og:image vs twitter:image vs JSON-LD).
- Backgrounding the image download after the price-write transaction.
- Deleting stale image files on extension change.
- Adding a `imageFetchFailedAt` column for retry-on-failure tracking.
- A unified `sidecarUrl(path)` helper (small duplication; lifecycle addressed
  in a separate task).
- Re-fetching the image if the saved file extension doesn't match the served
  bytes at runtime (defensive read-side check; can be added later).

## Acceptance Criteria

- [ ] **AC1. Content-type validation.** Given a sidecar response with
      `Content-Type: image/avif` and valid AVIF bytes, the file is saved with
      `.avif` extension. Given `Content-Type: image/jpeg` but the bytes start
      with the PNG magic (`89 50 4E 47`), the download is rejected and
      `null` is returned (warning log).
- [ ] **AC2. Unknown content type rejected.** An `image/avif` mapping exists
      in code, but `image/heic` does not. The sidecar returning
      `Content-Type: image/heic` causes `null` to be returned with a warning
      log (not silently saved as `.jpg`).
- [ ] **AC3. Image fetch retries.** A test that injects a 502 response on the
      first attempt and a 200 on the second shows the download succeeds. A
      test of three consecutive 502s sees `null` returned after the second
      retry (no infinite loop).
- [ ] **AC4. Concurrency limit.** A test that fires 20 downloads in parallel
      sees at most 3 in flight at the sidecar at any time (verified via the
      existing sidecar test helper or a mock).
- [ ] **AC5. SVG rejected at download.** A sidecar response with
      `Content-Type: image/svg+xml` returns `null` and logs a warning. The
      downloaded file is NOT saved on disk.
- [ ] **AC6. SVG not served.** The `/api/images/:id` endpoint returns 404 for
      a product whose `imagePath` ends in `.svg`. A product with `.png`
      continues to serve `image/png`.
- [ ] **AC7. Magic-byte validator covers the documented MIME set.** Tests
      cover JPEG, PNG, GIF, WebP, AVIF. SVG signature (because R5 may have
      legacy `.svg` rows) is not required by the validator since the download
      side no longer produces SVG.
- [ ] **AC8. No regression on existing image types.** Existing tests
      (acceptance/sidecar-fetch.test.ts and any image-pipeline tests) still
      pass; the simple happy-path PNG / JPEG / WebP / GIF downloads still
      work end-to-end with the same on-disk filename scheme.
- [ ] **AC9. Lint + type-check clean.** `pnpm lint` and `pnpm typecheck` (or
      the project's equivalent) pass with no new errors introduced.

## Notes

- Magic-byte detection is intentionally narrow (first 4–12 bytes). False
  positives are preferred over false negatives — being too permissive would
  re-introduce the silent corruption class.
- The shared retry helper is intentionally small and lives in
  `packages/prices/src/pipeline/retry.ts` (new file) so future fetches
  (prices, alerts) can reuse it.
- The `pLimit` image budget is a module-level singleton; consistent with the
  existing `pageFetchLimiter` pattern in `fetch-page.ts`.
- The serve route's `contentTypes` table is the existing one; the change is
  removing the `svg` entry so a stale `.svg` row returns 404 instead of
  serving attacker-controlled bytes.

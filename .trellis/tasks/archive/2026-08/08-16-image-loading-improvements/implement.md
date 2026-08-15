# Implement — Image loading pipeline improvements

## Execution order

1. Create `packages/prices/src/pipeline/retry.ts` — extract the retry helper.
2. Add `validateImageBuffer` + new content-type table in `extract-image.ts`.
3. Refactor `downloadProductImage` to use the retry helper + `pLimit`.
4. Drop SVG from the downloader (already enforced by step 2 if not in table).
5. Update `apps/web/server.ts` to return 404 for unknown extensions.
6. Refactor `fetch-page.ts` to use the new shared retry helper.
7. Add tests for `extract-image.ts` covering AC1–AC5, AC7.
8. Run lint + typecheck.

## Files touched

| File | Change |
|------|--------|
| `packages/prices/src/pipeline/retry.ts` | NEW — `retryWithBackoff` helper |
| `packages/prices/src/pipeline/extract-image.ts` | Validation, retry, pLimit, drop SVG |
| `packages/prices/src/pipeline/extract-image.test.ts` | NEW — unit tests |
| `packages/prices/src/pipeline/fetch-page.ts` | Use the shared retry helper |
| `apps/web/server.ts` | Drop SVG entry, return 404 for unknown ext |

## Validation commands

- Project lint: `pnpm lint` (or `bun run lint`).
- Project typecheck: `pnpm typecheck` (or `bun run typecheck`).
- Targeted tests: `bun test packages/prices/src/pipeline/extract-image.test.ts`.
- Full suite: `bun test` to catch AC8 regressions.

## Test plan (AC → test)

| AC | Test |
|----|------|
| AC1 | `validateImageBuffer` accepts JPEG with JPEG magic; rejects bytes claiming JPEG but starting with PNG magic. |
| AC2 | `validateImageBuffer` returns `null` for `image/heic` and warns. |
| AC3 | `downloadProductImage` fails twice then succeeds; also fails three times → returns `null`. |
| AC4 | 20 parallel `downloadProductImage` calls; assert at most 3 concurrent calls (counter-mock). |
| AC5 | `downloadProductImage` returning `image/svg+xml` → `null`, no file written. |
| AC6 | `/api/images/:id` with `imagePath` ending in `.svg` → 404. |
| AC7 | Table-driven test for each accepted MIME. |
| AC8 | Existing `tests/acceptance/sidecar-fetch.test.ts` still passes. |
| AC9 | `pnpm lint` and `pnpm typecheck` exit 0. |

## Review gates

- After step 1: helper is exported; one focused test.
- After step 3: `downloadProductImage` API unchanged (same signature, same return type) — no caller changes needed.
- After step 5: server tests for `/api/images/:id` pass.
- After step 6: diff in `fetch-page.ts` is purely a refactor — page-fetch tests still pass.
- After step 7: full suite green.
- After step 8: lint and typecheck clean.

## Risks

- Magic-byte table is small. Cover JPEG, PNG, GIF, WebP, AVIF. SVG is intentionally absent. Anything else → reject.
- `pLimit(3)` is conservative. If the sidecar stays at `FETCH_CONCURRENCY = 5`, the effective concurrency is 3. If that hurts throughput, raise to 4 in a follow-up.
- Legacy `.svg` rows go 404. Acceptable; users see a missing image until the next check is performed (or the row is overwritten by a fresh non-SVG image). Manual cleanup of legacy `.svg` files in `IMAGES_DIR` is a follow-up.

## Rollback

- Revert the PR. No stored data is broken by the change (DB rows still hold `imagePath` strings; the worst case is a 404 on a stale `.svg` row, which is recoverable on the next check).

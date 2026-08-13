# Implement — throttle OpenCode Zen extraction

## Checklist

1. Add `p-limit` import and the module-level limiter / min-interval / 429-retry helper to `packages/prices/src/pipeline/ai-extract.ts`.
   - Read `AI_EXTRACT_CONCURRENCY` (default 1) and `AI_EXTRACT_MIN_INTERVAL_MS` (default 2000) from `process.env`.
   - Wrap both `generateText` call sites (`extractFromPageContent`, `extractWithFetchTool`).
   - Detect 429 via `status`/`code` and `/rate limit/i` on the message.
   - Log `Rate limited, retrying` per `performance.md:125`.
2. Keep `aiExtractPrice` never-throwing. Do not touch `fetch-page.ts` or `scheduler.ts` concurrency.
3. Add a focused unit test next to existing prices tests (or a new `tests/` file if that package has no local test) that:
   - two overlapping extracts serialize `generateText`
   - a first-call 429 is retried and can succeed
4. Document the two env knobs in `.env.example` (optional, commented).
5. Update `.trellis/spec/backend/ai-sdk-integration.md` Common Error Types / extraction section: extraction now uses a shared limiter + 429 backoff.
6. Validate: `pnpm typecheck`, `pnpm lint`, existing fetch/blocked-signature tests.

## Validation commands

```bash
pnpm typecheck
pnpm lint
pnpm exec vitest run tests/acceptance/sidecar-fetch.test.ts
```

Plus the new extract-limiter test once written.

## Risky files / rollback

- `packages/prices/src/pipeline/ai-extract.ts` — only production code file.
- Rollback: revert that file. No DB, no Docker, no Camoufox change.

## Follow-up before `task.py start`

- Operator has approved slowing Zen; Akamai fingerprint is explicitly out of scope.
- Manifests below curated.

# Implementation Plan — OpenCode Zen AI provider support

## Checklist (ordered)

1. **Registry** — `packages/utils/src/lib/enum-types.ts:17`: add `"opencode"` to
   `AI_PROVIDER_VALUES`.
2. **Env schema** — `packages/utils/src/lib/env.ts`: add `OPENCODE_API_KEY`
   (`z.string().default("")`) and `OPENCODE_BASE_URL`
   (`z.string().url().default("https://opencode.ai/zen/v1")`).
3. **Dependency** — `packages/prices/package.json`: add
   `@ai-sdk/openai-compatible` (match the `^1.0.0` range style used by the
   other `@ai-sdk/*` deps), then `pnpm install`.
4. **Model construction** — `packages/prices/src/pipeline/ai-extract.ts`
   `createModel`: add `case "opencode"` before the final `return null`:
   - `if (env.OPENCODE_API_KEY === "") return null;`
   - `return createOpenAICompatible({ baseURL: env.OPENCODE_BASE_URL, apiKey: env.OPENCODE_API_KEY })(config.model);`
   - import `createOpenAICompatible` from `@ai-sdk/openai-compatible`.
5. **DB migration** — run `pnpm db:generate`, commit the generated migration,
   then apply it locally with `pnpm db:migrate` (against local Postgres).
6. **Config surface**:
   - `.env.example`: add `OPENCODE_API_KEY=` and
     `OPENCODE_BASE_URL=https://opencode.ai/zen/v1` under the AI provider block.
   - `docker-compose.yml`: add `OPENCODE_API_KEY: ${OPENCODE_API_KEY:-}` and
     `OPENCODE_BASE_URL: ${OPENCODE_BASE_URL:-https://opencode.ai/zen/v1}` to the
     `app` service environment.
   - `.env` (local, gitignored): set `AI_PROVIDER=opencode`,
     `AI_MODEL=deepseek-v4-flash-free`, `OPENCODE_API_KEY=<key>` for testing.

## Validation

- `pnpm -r typecheck`
- `pnpm -r lint`
- `pnpm db:generate` produces the `ALTER TYPE ... ADD VALUE 'opencode'`
  migration; `pnpm db:migrate` applies it cleanly against local Postgres.
- Confirm `openapi`/`gemini`/`anthropic` behavior unchanged (typecheck + existing
  behavior review).
- **Functional (optional, requires operator key)**: run the app
  (`docker compose up --build -d`), add a product, and confirm a price is
  extracted via the Zen endpoint (check `AI price extraction` log lines or the
  product's recorded price).
- Degrade check: with `OPENCODE_API_KEY` empty, a check logs
  "AI provider not configured" and records an unavailable/failed check without
  crashing.

## Risky files / rollback points

- `packages/prices/src/pipeline/ai-extract.ts` — the only behavior change;
  keep the new case isolated. Rollback = revert this file + registry + env.
- `packages/utils/src/lib/enum-types.ts` — propagates to the DB enum; reverting
  requires a migration (acceptable for a small private dataset).
- The generated migration under `packages/database/drizzle/migrations/` — remove
  it if the change is abandoned before merge.

## Review gates

- Gate 1: registry + env + dependency changes pass typecheck/lint before
  touching the pipeline.
- Gate 2: migration generated and applied before functional verification.
- Gate 3: full-scope pass — PRD acceptance criteria all green (see
  `prd.md`).

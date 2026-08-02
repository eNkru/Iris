# Design — OpenCode Zen AI provider support

## Problem

Iris's AI price extraction (`packages/prices/src/pipeline/ai-extract.ts`) only
supports the three native AI SDK providers (`openai`, `gemini`, `anthropic`),
each hardwired to its vendor endpoint with no base-URL override. The operator
wants to use OpenCode Zen — an OpenAI-compatible gateway — with their own key
and models (e.g. `deepseek-v4-flash-free`).

## Design

### 1. Registry change (`packages/utils/src/lib/enum-types.ts`)

Add `"opencode"` to `AI_PROVIDER_VALUES`. This single change propagates to:

- the Postgres `ai_provider` enum via `packages/database/src/drizzle/schema/postgres.ts:23`
  (`pgEnum("ai_provider", AI_PROVIDER_VALUES)`),
- the admin settings dropdown (`admin-settings-section.tsx` maps
  `AI_PROVIDER_VALUES`),
- API input/output Zod schemas (`packages/api/src/modules/admin/types.ts` uses
  `aiProviderZodSchema`).

`AI_PROVIDER_VALUES` is typed `as const`, so the new value is a literal that
flows through `AiProvider` and the DB `AiProvider` union types.

### 2. DB migration (`packages/database`)

`db:generate` (drizzle-kit) detects the enum value change and emits an
`ALTER TYPE "public"."ai_provider" ADD VALUE 'opencode'` migration. Postgres
enum `ADD VALUE` runs outside a transaction block; drizzle-kit emits the raw
statement. The entrypoint runs `db:migrate` on container start, so a fresh
`docker compose up --build` applies it.

Note: Postgres does not allow using the new enum value within the same
transaction that adds it — irrelevant here since the value is only used by app
writes after the migration completes.

### 3. Env schema (`packages/utils/src/lib/env.ts`)

Add two fields, following the existing per-provider key pattern:

- `OPENCODE_API_KEY: z.string().default("")`
- `OPENCODE_BASE_URL: z.string().url().default("https://opencode.ai/zen/v1")`

Defaults keep every existing deployment working without config changes.

### 4. Model construction (`packages/prices/src/pipeline/ai-extract.ts`)

In `createModel`, add a `case "opencode"` that:

1. returns `null` (no-op degrade path) when `OPENCODE_API_KEY === ""`, matching
   the existing pattern at `ai-extract.ts:51-68`;
2. otherwise returns
   `createOpenAICompatible({ baseURL: getEnv().OPENCODE_BASE_URL, apiKey: getEnv().OPENCODE_API_KEY })(config.model)`.

Requires adding `@ai-sdk/openai-compatible` to `packages/prices/package.json`.

No changes to `resolveAiConfig`, the pipeline, or `generateObject` — the
`opencode` provider flows through the existing `ResolvedAiConfig`/`AiProvider`
types.

### 5. Config surface

- `.env.example`: document `OPENCODE_API_KEY` (empty) and `OPENCODE_BASE_URL`
  (default Zen).
- `docker-compose.yml`: pass both through the `app` service environment block,
  matching how `OPENAI_API_KEY` etc. are passed.
- `.env` (gitignored): the operator sets `AI_PROVIDER=opencode`,
  `AI_MODEL=deepseek-v4-flash-free`, `OPENCODE_API_KEY=<key>`.

## Contracts / Data flow

```
env.ts (OPENCODE_API_KEY, OPENCODE_BASE_URL, AI_PROVIDER, AI_MODEL)
  → resolveAiConfig() → ResolvedAiConfig { provider: "opencode", model }
  → createModel() → createOpenAICompatible({ baseURL, apiKey })(model)
  → generateObject({ model, schema: priceExtractionSchema, prompt })
  → PriceExtraction | null
```

`global_settings.aiProvider` stores `'opencode'` after the admin selects it.

## Compatibility & Migration

- Existing rows default to `openai`; adding an enum value is backward
  compatible. No data backfill needed.
- The `.env`/compose additions are additive; unset values fall back to
  defaults.
- Rollback: revert the enum addition (requires a new migration removing the
  value, or restoring the prior snapshot) and revert the code. Since this is a
  private app with a small dataset, a destructive rebuild is acceptable if ever
  needed.

## Trade-offs

- **Why a dedicated `opencode` provider value instead of a generic
  "openai-compatible" one**: minimal surface, matches the existing registry
  pattern, and keeps the base-URL override optional. The provider identity is
  `opencode` even though the wire protocol is OpenAI-compatible.
- **`@ai-sdk/openai-compatible` vs `@ai-sdk/openai`**: `openai-compatible` is
  the correct client for an arbitrary OpenAI-compatible `/chat/completions`
  endpoint; the OpenAI SDK assumes the real OpenAI API. Zen documents
  `@ai-sdk/openai-compatible` for the `deepseek-*` family.
- **Only `/chat/completions`**: GPT-style (`/responses`) and Claude-style
  (`/messages`) Zen endpoints are out of scope; the extraction prompt is
  text-only JSON-object output, which chat completions handles.

## Operational notes

- The API key stays env-only (never stored in the DB), consistent with the
  existing design comment in `ai-extract.ts`.
- Degrades to a logged warning (not a crash) when the key is missing.

# Design — Generic OpenAI-compatible AI API config

## 1. Architecture & boundaries

The AI provider system collapses from a 4-way provider enum + per-provider SDK
switch into a single generic OpenAI-compatible path. The config triples
`(base URL, API key, model)` live in `global_settings` (admin-editable, key
masked on read); env vars provide build-time defaults for seeding / fallback;
the pipeline resolves `DB → env` and routes everything through
`@ai-sdk/openai-compatible`'s `createOpenAICompatible`.

### Layer-by-layer change

| Layer | File | Change |
|---|---|---|
| Enum/types | `packages/utils/src/lib/enum-types.ts` | Remove `AI_PROVIDER_VALUES`, `aiProviderZodSchema`, `AiProvider`. Keep channel enums. |
| Env | `packages/utils/src/lib/env.ts` | Remove `AI_PROVIDER`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENCODE_API_KEY`, `OPENCODE_BASE_URL`. Add `AI_BASE_URL` (url, default `https://api.openai.com/v1`), `AI_API_KEY` (default `""`), `AI_MODEL` (default `gpt-4o-mini`). |
| Shared schemas | `packages/utils/src/lib/schemas.ts` | `aiModelOverrideSchema` → `{ model?: string }` only (drop `provider`; per-user baseUrl/key is out of scope). |
| DB schema | `packages/database/src/drizzle/schema/postgres.ts` | Drop `aiProviderEnum`. On `globalSettings`: remove `aiProvider` col; add `aiBaseUrl` (text, notNull, default `https://api.openai.com/v1`) + `aiApiKey` (text, default `""`). Keep `aiModel`. Remove `AI_PROVIDER_VALUES` import. |
| DB query types | `packages/database/src/drizzle/queries/types.ts` | `GlobalSettingsRow`: `aiProvider` → `aiBaseUrl: string` + `aiApiKey: string`. `GlobalSettingsInput`: `aiProvider?` → `aiBaseUrl?` + `aiApiKey?`. Drop `AiProvider` import. |
| DB seed | `packages/database/src/seed.ts` | Seed `aiBaseUrl`, `aiApiKey`, `aiModel` from `process.env` (with the same defaults as env schema). Drop `aiProvider`. |
| Admin types | `packages/api/src/modules/admin/types.ts` | `globalSettingsShapeSchema`: `aiProvider` → `aiBaseUrl` (url) + `aiApiKey` (string, masked). `updateGlobalSettingsInputSchema`: `aiBaseUrl?` (url) + `aiApiKey?` (write-only, Telegram-token pattern). Generalize `maskTelegramBotToken` → `maskSecret(value)`. |
| Admin GET | `.../procedures/get-global-settings.ts` | Return `aiBaseUrl`, `aiApiKey: maskSecret(row?.aiApiKey ?? null)`, `aiModel`. Defaults via `??` for first-boot. |
| Admin UPDATE | `.../procedures/update-global-settings.ts` | Merge `aiBaseUrl`, `aiModel` normally; save `aiApiKey` only when non-empty (same pattern as `telegramBotToken`). |
| Pipeline | `packages/prices/src/pipeline/ai-extract.ts` | Rewrite per §2 below. |
| Pipeline caller | `packages/prices/src/pipeline/check-price.ts` | Drop `html` from `aiExtractPrice` call (keep the pre-fetch for fail-fast). |
| Frontend | `apps/web/components/admin-settings-section.tsx` | Replace provider dropdown with base URL + API key (password, masked placeholder) + model fields. Remove `AiProvider`/`AI_PROVIDER_VALUES` import. |
| Deps | `packages/prices/package.json`, root `package.json` if listed | Remove `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/anthropic`. Keep `ai`, `@ai-sdk/openai-compatible`. |
| Config | `.env`, `.env.example` | Replace the AI provider section with `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`. |
| Spec | `.trellis/spec/backend/ai-sdk-integration.md` | Rewrite provider section to generic; remove per-provider SDK sections; keep gotchas 1a/1b/1c/1d (still relevant). |

## 2. Pipeline rewrite (`ai-extract.ts`)

### `ResolvedAiConfig`

```ts
export interface ResolvedAiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}
```

### `resolveAiConfig`

Resolution order: per-user model override → DB `global_settings` → env. The
API key and base URL are instance-level (no per-user override).

```ts
export function resolveAiConfig(
  globalSettings: Pick<GlobalSettingsRow, "aiBaseUrl" | "aiApiKey" | "aiModel"> | null,
  override: AiModelOverride | null = null,
): ResolvedAiConfig | null {
  const env = getEnv();
  const baseUrl = globalSettings?.aiBaseUrl || env.AI_BASE_URL;
  const apiKey = globalSettings?.aiApiKey || env.AI_API_KEY;
  const model = override?.model ?? globalSettings?.aiModel ?? env.AI_MODEL;
  if (!baseUrl || !model) return null;
  return { baseUrl, apiKey, model };
}
```

`apiKey` is allowed to be empty here — `createModel` handles the degrade-to-null
case so the behavior matches the current "missing key → logged no-op" design.

### `createModel` (single path)

```ts
function createModel(config: ResolvedAiConfig): LanguageModel | null {
  if (config.apiKey === "") return null;
  return createOpenAICompatible({
    name: "iris",
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  })(config.model);
}
```

### `aiExtractPrice` (always fetch-tool)

Drop the `generateObject` branch, `priceExtractionAiSchema`, `buildExtractionPrompt`,
and `MAX_PROMPT_HTML_CHARS`. Keep `reducePageHtml` (used by the `fetchPage` tool),
`buildFetchPageTool`, `buildToolExtractionPrompt`, `parseExtractionJson`,
`extractWithFetchTool`. The body becomes:

```ts
export async function aiExtractPrice(options: AiExtractOptions): Promise<PriceExtraction | null> {
  const { url, productId, config } = options;
  const model = createModel(config);
  if (!model) {
    logger.warn("AI provider not configured (missing API key)", { productId, url });
    return null;
  }
  try {
    return await extractWithFetchTool(model, url, productId);
  } catch (error) { /* same logging */ return null; }
}
```

`AiExtractOptions` drops `html`: `{ url: string; productId?: string; config: ResolvedAiConfig }`.

### Imports removed

`generateObject`, `createAnthropic`, `createGoogleGenerativeAI`, `createOpenAI`,
and the `AiProvider` import. Keep `generateText`, `tool`, `jsonSchema` from `ai`,
`createOpenAICompatible` from `@ai-sdk/openai-compatible`.

## 3. Config resolution & data flow

```
admin UI ──PATCH /admin/global-settings──> global_settings (aiBaseUrl, aiApiKey, aiModel)
                                                  │
scheduler/checkPrice ─ getGlobalSettings() ───────┤
                                                  ▼
                                  resolveAiConfig(DB → env fallback)
                                                  │
                                  createOpenAICompatible({baseURL, apiKey})(model)
                                                  │
                                  generateText + fetchPage tool
                                                  │
                                  parseExtractionJson → priceExtractionSchema.safeParse
```

- **First boot / unseeded DB**: `getGlobalSettings()` returns null →
  `resolveAiConfig` falls back to env (`AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`).
- **Key masked on read**: `GET /admin/global-settings` returns
  `aiApiKey: maskSecret(row.aiApiKey)` (never the real value). `UPDATE` saves a
  new key only when the submitted value is non-empty; empty/absent leaves the
  stored key unchanged (identical to `telegramBotToken` handling).
- **Degrade to no-op**: if both DB `aiApiKey` and `env.AI_API_KEY` are empty,
  `createModel` returns null → pipeline logs "AI provider not configured" and
  records a failed check instead of throwing.

## 4. Migration

`pnpm db:generate` diffs the schema and should emit roughly:

```sql
ALTER TABLE "global_settings" DROP COLUMN "aiProvider";
ALTER TABLE "global_settings" ADD COLUMN "aiBaseUrl" text NOT NULL DEFAULT 'https://api.openai.com/v1';
ALTER TABLE "global_settings" ADD COLUMN "aiApiKey" text DEFAULT '';
DROP TYPE "ai_provider";
```

**Risk**: drizzle-kit may omit the `DROP TYPE "ai_provider"` statement (it sometimes
leaves unused enum types). After generating, **inspect the new migration SQL** and
append `DROP TYPE IF EXISTS "ai_provider";` manually if missing. The `aiModel`
column is unchanged, so existing model values survive. Existing `aiProvider` values
are discarded (the operator sets a new base URL anyway).

The `user_settings.aiModelOverride` jsonb column is unaffected (jsonb is
schema-flexible); only its TS type changes shape — no migration needed there.

## 5. Compatibility & rollback

- **Rollback shape**: revert the schema file + drop the new migration. The enum
  can be re-added (Postgres allows re-creating a dropped type). Existing rows'
  `aiBaseUrl`/`aiApiKey` would be dropped with the columns. Acceptable for a
  pre-production app.
- **Breaking**: any deployment relying on `OPENAI_API_KEY` / `GOOGLE_*` /
  `ANTHROPIC_API_KEY` / `OPENCODE_*` env vars must migrate to `AI_BASE_URL` /
  `AI_API_KEY` / `AI_MODEL`. Documented in `.env.example`.
- **Operator action required**: after deploy, set base URL + API key in the admin
  UI (or via env). Old per-provider keys cease to function.

## 6. Trade-offs

- **Dropping native Gemini/Anthropic SDKs**: those models are only reachable via
  an OpenAI-compatible gateway. Acceptable per D1 — the price-extraction use case
  doesn't need their native features.
- **Fetch-tool path for all models**: requires the configured model to support
  tool calling. Cheap/local models without tool support won't work. The operator
  picks a tool-capable model (per D3).
- **Double page fetch**: `checkPrice` pre-fetches for fail-fast, then the
  `fetchPage` tool re-fetches a compact reduction. This already exists for the
  `opencode` case; keeping it preserves fail-fast and the compact-reduction
  benefit. A future optimization could pass the pre-fetched HTML into the tool's
  `execute` via closure — out of scope for MVP.
- **API key in DB**: slightly higher blast radius if DB compromised, but the
  Telegram bot token precedent already accepts this; the key is masked on read.

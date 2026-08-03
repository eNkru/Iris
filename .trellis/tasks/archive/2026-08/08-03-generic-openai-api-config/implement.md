# Implement — Generic OpenAI-compatible AI API config

Ordered execution checklist. Run validation after each major step; do not
`task.py start` until this plan is approved.

## Validation commands (run from repo root)

- `pnpm typecheck` — workspace typecheck
- `pnpm lint` — workspace lint
- `pnpm --filter @iris/database db:generate` — regenerate migration from schema diff
- `pnpm --filter @iris/database db:migrate` — apply migration (needs a running Postgres)
- `pnpm --filter @iris/database db:seed` — reseed singleton row

## Step 1 — Utils layer (enum, env, schemas)

Files:
- `packages/utils/src/lib/enum-types.ts` — remove `AI_PROVIDER_VALUES`, `aiProviderZodSchema`, `AiProvider`.
- `packages/utils/src/lib/env.ts` — remove the 6 old AI env vars; add `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`.
- `packages/utils/src/lib/schemas.ts` — reduce `aiModelOverrideSchema` to `{ model?: string }`.

Validate: `pnpm --filter @iris/utils typecheck` (will fail elsewhere until dependents are updated — expected; continue).

## Step 2 — DB layer (schema, query types, seed, migration)

Files:
- `packages/database/src/drizzle/schema/postgres.ts` — drop `aiProviderEnum` + `aiProvider` column + the `AI_PROVIDER_VALUES` import; add `aiBaseUrl` (text notNull default `https://api.openai.com/v1`) and `aiApiKey` (text default `""`).
- `packages/database/src/drizzle/queries/types.ts` — `GlobalSettingsRow` / `GlobalSettingsInput`: replace `aiProvider` with `aiBaseUrl` + `aiApiKey`; drop `AiProvider` import.
- `packages/database/src/seed.ts` — seed `aiBaseUrl` / `aiApiKey` / `aiModel` from `process.env` with the same defaults as the env schema; drop `aiProvider`.

Then:
```bash
pnpm --filter @iris/database db:generate
```
Inspect the generated `packages/database/drizzle/migrations/00XX_*.sql`. Verify it:
1. drops the `aiProvider` column,
2. adds `aiBaseUrl` + `aiApiKey`,
3. drops the `ai_provider` type (`DROP TYPE IF EXISTS "ai_provider"`).
If `DROP TYPE` is missing, append it manually to the generated SQL.

Validate: `pnpm --filter @iris/database typecheck`. If a local Postgres is available, `pnpm --filter @iris/database db:migrate && pnpm --filter @iris/database db:seed`.

## Step 3 — API layer (admin types, GET, UPDATE procedures)

Files:
- `packages/api/src/modules/admin/types.ts` — `globalSettingsShapeSchema`: replace `aiProvider` with `aiBaseUrl` (z.string().url()) + `aiApiKey` (z.string().nullable()). `updateGlobalSettingsInputSchema`: `aiBaseUrl: z.string().url().optional()`, `aiApiKey: z.string().optional()` (write-only). Generalize `maskTelegramBotToken` → `maskSecret(value: string | null)`; update its doc.
- `packages/api/src/modules/admin/procedures/get-global-settings.ts` — return `aiBaseUrl`, `aiApiKey: maskSecret(row?.aiApiKey ?? null)`, `aiModel`; use `??` defaults for first-boot.
- `packages/api/src/modules/admin/procedures/update-global-settings.ts` — merge `aiBaseUrl` + `aiModel` normally; save `aiApiKey` only when non-empty (mirror `telegramBotToken`).

Validate: `pnpm --filter @iris/api typecheck`.

## Step 4 — Pipeline rewrite (`ai-extract.ts` + caller)

Files:
- `packages/prices/src/pipeline/ai-extract.ts` — rewrite per design §2:
  - `ResolvedAiConfig` → `{ baseUrl, apiKey, model }`.
  - `resolveAiConfig` → resolve `baseUrl`/`apiKey`/`model` (DB → env; model honors override).
  - `createModel` → single `createOpenAICompatible` path; return null on empty key.
  - `aiExtractPrice` → always `extractWithFetchTool`; drop the `generateObject` branch.
  - `AiExtractOptions` → drop `html`.
  - Remove unused imports (`generateObject`, `createOpenAI`, `createGoogleGenerativeAI`, `createAnthropic`, `AiProvider`) and dead helpers (`priceExtractionAiSchema`, `buildExtractionPrompt`, `MAX_PROMPT_HTML_CHARS`). Keep `reducePageHtml` (used by the tool).
- `packages/prices/src/pipeline/check-price.ts` — drop `html: page.html` from the `aiExtractPrice` call.
- `packages/prices/package.json` (and root `package.json` if the deps are hoisted there) — remove `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/anthropic`. Then `pnpm install`.

Validate: `pnpm --filter @iris/prices typecheck`.

## Step 5 — Frontend (`admin-settings-section.tsx`)

Files:
- `apps/web/components/admin-settings-section.tsx` — replace the provider `<select>` with:
  - base URL `<Input type="url">` (placeholder `https://api.openai.com/v1`),
  - API key `<Input type="password">` (write-only; helper text shows masked stored value, mirroring the Telegram token field),
  - model `<Input type="text">`.
  Remove the `AI_PROVIDER_VALUES` / `AiProvider` import from `@iris/utils/enum-types`. Update `useState` defaults and the `updateGlobalSettings.mutateAsync` payload (`aiBaseUrl`, `aiApiKey`, `aiModel`). `use-settings.ts` types are inferred from the orpc client — no manual type change needed.

Validate: `pnpm --filter @iris/web typecheck`.

## Step 6 — Config & spec docs

Files:
- `.env` and `.env.example` — replace the AI provider section with:
  ```
  # AI (OpenAI-compatible). Instance-level config is admin-editable at runtime;
  # these are build-time fallbacks used for seeding / first boot.
  AI_BASE_URL=https://api.openai.com/v1
  AI_API_KEY=
  AI_MODEL=gpt-4o-mini
  ```
  Remove `AI_PROVIDER`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENCODE_API_KEY`, `OPENCODE_BASE_URL`.
- `.trellis/spec/backend/ai-sdk-integration.md` — rewrite §1 "Supported Providers" + §7 "Provider-Specific Configuration" + §9 "Environment Variables" to the generic single-provider model. Keep §1a (zod v4 incompatibility), §1b (DeepSeek tool_choice — now the universal path), §1c (truncation — note it's avoided by the fetch-tool path), §1d (no web access — the fetch-tool path is now mandatory).

## Step 7 — Full validation & quality gate

```bash
pnpm typecheck   # all workspaces pass
pnpm lint        # all workspaces pass
pnpm --filter @iris/database db:generate   # no new diff (idempotent)
```

Run a `trellis-check` pass before commit. Run the price-extraction pipeline
against a real configured endpoint (manual smoke test) to confirm AC1.

## Risky files / rollback points

- **`packages/database/drizzle/migrations/00XX_*.sql`** — manual edit risk (DROP TYPE). If the hand-edit is wrong, drop the migration file and re-run `db:generate`.
- **`packages/prices/src/pipeline/ai-extract.ts`** — large rewrite; the `generateObject` deletion is the riskiest single edit. Rollback = git revert the file.
- **`packages/utils/src/lib/enum-types.ts`** — removing `AiProvider` cascades typecheck failures across 5 packages; expected and resolved step-by-step. Don't commit mid-step.
- **`pnpm-lock.yaml`** — removing 3 `@ai-sdk/*` deps regenerates the lockfile. Commit it together with the package.json changes.

## Follow-up checks before `task.py start`

- [ ] All 4 decided (D1–D4) reflected in code.
- [ ] `pnpm typecheck` + `pnpm lint` green.
- [ ] Generated migration inspected; `DROP TYPE` present.
- [ ] `.env.example` and spec updated.
- [ ] Manual smoke test plan for AC1 ready (a configured OpenAI-compatible endpoint).

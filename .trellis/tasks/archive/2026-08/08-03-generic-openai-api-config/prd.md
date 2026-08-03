# Generic OpenAI-compatible AI API config

## Goal

Make Iris's AI API configuration generic and OpenAI-compatible so the operator can
swap to **any model** and **any service URL** they like, without code changes or
rebuilds. This is about Iris's own AI provider config (the price-extraction
pipeline), NOT the opencode TUI's own configuration.

## Background — current architecture (confirmed from code)

- **Provider enum** — `AI_PROVIDER_VALUES = ["openai", "gemini", "anthropic", "opencode"]`
  in `packages/utils/src/lib/enum-types.ts:17`. Single source of truth for the Zod
  schema, the `ai_provider` pgEnum, and the DB schema. Adding a provider needs a
  code change + DB migration.
- **Env vars** — `packages/utils/src/lib/env.ts:33-45`. Per-provider API key env
  vars (`OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `ANTHROPIC_API_KEY`,
  `OPENCODE_API_KEY`) + `OPENCODE_BASE_URL`. API keys are env-only (R6 rule:
  "API keys always come from the environment, never the database").
- **DB global_settings** — `packages/database/src/drizzle/schema/postgres.ts:120-128`.
  Singleton row (id=1) with `aiProvider` (pgEnum) + `aiModel` (text), admin-editable
  via `admin.globalSettings.update`. Seeded with `openai` / `gpt-4o-mini`.
- **createModel switch** — `packages/prices/src/pipeline/ai-extract.ts:50-85`. A
  `switch (config.provider)` over the 4 providers. The `opencode` case already uses
  `createOpenAICompatible({ name, baseURL, apiKey })` — the generic OpenAI-compatible
  path. OpenAI/Gemini/Anthropic use their native SDKs.
- **Two extraction paths** — `ai-extract.ts:298-321`:
  - `opencode` → `generateText` + `fetchPage` tool (model fetches the page itself;
    avoids the truncation gotcha 1c; works with DeepSeek thinking models that reject
    `tool_choice` per gotcha 1b).
  - others → `generateObject` with pre-fetched truncated HTML (40k char cap).
- **Frontend** — `apps/web/components/admin-settings-section.tsx`. A `<select>` of
  `AI_PROVIDER_VALUES` + a free-text model field. No URL / key field.
- **Per-user override** — `aiModelOverrideSchema` in `packages/utils/src/lib/schemas.ts:58-63`
  is reserved (schema-ready, not exposed in MVP UI).
- **Spec** — `.trellis/spec/backend/ai-sdk-integration.md` documents the 4 providers,
  the `ai@4.x`/zod v4 incompatibility (1a), the DeepSeek `tool_choice` gotcha (1b),
  the page-truncation gotcha (1c), and the no-web-access gotcha (1d).
- **Migrations** — drizzle-kit generates SQL from schema diffs. The `ai_provider`
  pgEnum was created in `0000` and had `opencode` added via `ALTER TYPE ... ADD VALUE`
  in `0001`. Dropping it requires dropping the dependent column first.

Key insight: the `opencode` provider already demonstrates a generic OpenAI-compatible
path with an overridable `baseURL`. The user wants this generalized so any model +
service URL is swappable.

## Key decisions

- **D1. Fully replace** the 4 named providers with one generic OpenAI-compatible
  config. Drop the `ai_provider` pgEnum, the `createModel` switch, and the
  per-provider env keys (`OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`,
  `ANTHROPIC_API_KEY`, `OPENCODE_API_KEY`, `OPENCODE_BASE_URL`). Everything routes
  through `createOpenAICompatible`. Native Gemini/Anthropic SDKs are dropped; those
  models are reachable via any OpenAI-compatible gateway (OpenRouter, Zen, etc.).
- **D2. All config in DB**, env as build-time defaults. New `aiBaseUrl`,
  `aiApiKey`, `aiModel` columns on `global_settings`; the API key is write-only /
  masked on read (same pattern as the Telegram bot token in
  `packages/api/src/modules/admin/types.ts:44-51`). Env vars (`AI_BASE_URL`,
  `AI_API_KEY`, `AI_MODEL`) become seeding / first-boot fallback only.
- **D3. Always use the fetch-tool extraction path** for every generic config —
  `generateText` + `fetchPage` tool + manual `priceExtractionSchema` validation
  (the current `opencode` path in `ai-extract.ts:191-214`). Eliminates the
  `generateObject` branch and the 40k-char truncation gotcha (1c), and works with
  thinking models (1b). Limitation: the configured model must support tool calling.
- **D4. Single active config** (singleton `global_settings` row), not multiple
  named presets. Swapping = editing the three values. Matches the existing singleton
  design and the user's "swap to any model and service URL I like" phrasing.
  (Veto point: if you want saved presets, say so at the final review.)

## Requirements

- **R1.** The operator configures a generic OpenAI-compatible endpoint via three
  values — **base URL**, **API key**, **model** — and can swap any of them freely.
- **R2.** All three values are stored in `global_settings` and admin-editable via
  the admin UI at runtime. The API key is masked on read (`••••••` + last 4 chars,
  Telegram-token pattern); saved only when a non-empty value is submitted.
- **R3.** Env vars (`AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`) provide build-time
  defaults used only for seeding / first-boot fallback. The pipeline resolves
  config as: DB row → env fallback (when DB unseeded).
- **R4.** Price extraction uses a single unified path: `generateText` + `fetchPage`
  tool, then parse + validate the returned JSON with `priceExtractionSchema`. No
  `generateObject` branch, no `opencode` special case.
- **R5.** The `ai_provider` pgEnum and per-provider env keys are removed; the
  `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/anthropic` deps are removed; only
  `ai` + `@ai-sdk/openai-compatible` remain.
- **R6.** The DB migration is reversible in shape (drop enum + column, add text
  columns); existing `aiModel` values are preserved.

## Acceptance criteria

- **AC1.** An operator can set base URL + API key + model from the admin UI and
  the price-extraction pipeline calls exactly that endpoint with no code change or
  rebuild. Verified by a pipeline run against a configured endpoint.
- **AC2.** The API key is never returned in full by `GET /admin/global-settings`;
  it is masked (`••••••` + last 4). Submitting an empty key on update leaves the
  stored key unchanged.
- **AC3.** `pnpm db:generate` produces a migration that drops the `ai_provider`
  enum + `aiProvider` column and adds `aiBaseUrl` + `aiApiKey` text columns;
  `pnpm db:migrate` applies cleanly on a database seeded with the old schema.
- **AC4.** `pnpm typecheck` and `pnpm lint` pass across all workspaces.
- **AC5.** `.trellis/spec/backend/ai-sdk-integration.md` and `.env.example` reflect
  the generic config (no per-provider sections).

## Out of scope

- The opencode TUI's own AI configuration.
- Per-user AI overrides (remain reserved / schema-ready, not exposed in MVP UI).
- Multiple named presets (D4 — single config only; revisit if needed).
- A model/tool-support detection layer (the operator picks a tool-capable model).
- Provider-specific SDK features (native Gemini/Anthropic caching, Vertex AI, etc.)
  — reachable via OpenAI-compatible gateways instead.

## Open questions (blocking planning)

None. All decisions resolved; remaining technical detail belongs in `design.md`.

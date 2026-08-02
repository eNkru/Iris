# Add OpenCode Zen AI provider support

## Goal

Allow Iris's AI price extraction to use OpenCode Zen (https://opencode.ai/zen/v1,
OpenAI-compatible) as a provider, so the operator can use their OpenCode Zen API
key and models (e.g. `deepseek-v4-flash-free`) instead of only the native
OpenAI/Gemini/Anthropic SDKs.

## Background

- AI provider resolution lives in `packages/prices/src/pipeline/ai-extract.ts`
  (`resolveAiConfig` + `createModel`), which only supports `openai`, `gemini`,
  `anthropic` via the official `@ai-sdk/*` packages and each vendor's fixed
  endpoint. There is no base-URL override today.
- The provider registry is a single source of truth in
  `packages/utils/src/lib/enum-types.ts:17` (`AI_PROVIDER_VALUES`), reused by
  the Postgres enum (`packages/database/src/drizzle/schema/postgres.ts:23`),
  the admin settings UI dropdown (`admin-settings-section.tsx`, auto-derived),
  and API schemas (`packages/api/src/modules/admin/types.ts`).
- Env schema: `packages/utils/src/lib/env.ts` — `AI_PROVIDER` enum, `AI_MODEL`,
  and per-provider API keys (`OPENAI_API_KEY` etc.). API keys come from env
  only, never the DB (per `ai-extract.ts` comment).
- OpenCode Zen is OpenAI-compatible. Per zen docs, `deepseek-v4-flash-free`
  (and other open-source models) route through `POST /zen/v1/chat/completions`
  and the matching AI SDK client is `@ai-sdk/openai-compatible` with
  `baseURL: https://opencode.ai/zen/v1`.
- The app runs in Docker Compose; env is passed via `.env` → compose
  (`docker-compose.yml` environment block), validated at build time by
  `env.ts` (module-load validation requires `DATABASE_URL` only).

## Requirements

- R1. Add a new `opencode` value to the AI provider registry
  (`AI_PROVIDER_VALUES`) so it is selectable in the admin global-settings UI
  and stored in the `global_settings.aiProvider` enum column.
- R2. Extend `ai-extract.ts` `createModel` to build a model for `opencode` via
  `@ai-sdk/openai-compatible` pointed at `https://opencode.ai/zen/v1`, using the
  operator's Zen API key from env.
- R3. Add an env variable for the Zen API key (recommended: `OPENCODE_API_KEY`),
  wired through `env.ts`, `.env.example`, and `docker-compose.yml`.
- R4. Add `OPENCODE_BASE_URL` (default `https://opencode.ai/zen/v1`) so the
  OpenAI-compatible endpoint is overridable without a rebuild.
- R5. Keep the existing `openai`/`gemini`/`anthropic` behavior unchanged.

## Acceptance Criteria

- [ ] `pnpm -r typecheck` and `pnpm -r lint` pass after the change.
- [ ] A Postgres migration adds `'opencode'` to the `ai_provider` enum type.
- [ ] Admin settings page shows `opencode` in the AI provider dropdown and it
      saves to `global_settings.aiProvider` (verified via API).
- [ ] With `AI_PROVIDER=opencode`, `AI_MODEL=<zen model>`, and
      `OPENCODE_API_KEY` set, a product check successfully extracts a price
      using the Zen endpoint (verified by a check on a real product).
- [ ] `OPENCODE_BASE_URL` is honored when set (overrides the Zen default).
- [ ] With `OPENCODE_API_KEY` unset, `createModel` returns null and the
      pipeline logs the existing "AI provider not configured" warning rather
      than throwing.
- [ ] `.env.example` documents `OPENCODE_API_KEY` and `OPENCODE_BASE_URL`.

## Out of Scope

- Per-user AI provider overrides in the UI (schema-ready but unused today).
- Generic "any OpenAI-compatible endpoint" provider beyond the `opencode`
  provider value; the base URL is overridable but the provider identity is
  `opencode`.
- Changing the default provider/model; defaults stay `openai`/`gpt-4o-mini`.
- Support for GPT-style `/responses` or Claude-style `/messages` zen endpoints.

## Open Questions

- None.

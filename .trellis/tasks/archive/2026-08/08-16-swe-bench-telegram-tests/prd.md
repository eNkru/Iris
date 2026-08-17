# SWE-bench P2P tests for Telegram notification

## Goal

Create a comprehensive P2P (pass-to-pass) test suite for the Telegram notification module, suitable for SWE-bench evaluation. Tests must be self-contained, deterministic, and cover both backend logic and frontend UI.

## Confirmed Facts (from codebase inspection)

- **Test framework**: Vitest v3.2.7 (existing)
- **Test location**: `tests/` directory at repo root, with `unit/` and `acceptance/` subdirectories
- **No existing Telegram tests**: zero test coverage for the notification module
- **Existing spec**: `.trellis/spec/backend/notifications-telegram.md` defines executable contracts and error matrix

### Backend module inventory

| Module | File | Key exports |
|--------|------|-------------|
| Low-level sender | `packages/prices/src/notifications/telegram.ts` | `sendTelegramText()`, `telegramChannel` |
| Message formatters | `packages/prices/src/notifications/format.ts` | `formatPriceAlertMessage()`, `escapeTelegramHtml()`, `formatTelegramLink()`, `formatPriceGrouped()` |
| Summary | `packages/prices/src/notifications/summary.ts` | `sendProductSummary()`, `formatProductSummaryMessage()`, `formatRelativeTime()` |
| Dispatch | `packages/prices/src/notifications/dispatch.ts` | `dispatchPriceAlert()` |
| Channel registry | `packages/prices/src/notifications/channel.ts` | `registerChannel()`, `getChannel()` |
| API channels CRUD | `packages/api/src/modules/channels/` | `create`, `list`, `update`, `delete`, `sendSummary` procedures |
| API admin settings | `packages/api/src/modules/admin/` | `getGlobalSettings`, `updateGlobalSettings` procedures |
| DB schema | `packages/database/src/drizzle/schema/sqlite.ts` | `alertChannels` table, `globalSettings.telegramBotToken` |

### Frontend module inventory

| Component | File | Purpose |
|-----------|------|---------|
| Channels section | `apps/web/src/components/channels-section.tsx` | CRUD UI for Telegram channels |
| Telegram help tooltip | `apps/web/src/components/telegram-help-tooltip.tsx` | Setup guide tooltip |
| Admin settings | `apps/web/src/components/admin-settings-section.tsx` | Bot token config form |
| Product list | `apps/web/src/components/product-list.tsx` | Send summary button |
| Channel hooks | `apps/web/src/hooks/use-channels.ts` | React Query hooks |
| Settings hooks | `apps/web/src/hooks/use-settings.ts` | Global settings hooks |

### Key design decisions relevant to testing

1. **No SDK dependency** — plain `fetch()` to Telegram Bot API
2. **Best-effort delivery** — `sendTelegramText` never throws; failures logged and swallowed
3. **Token resolution** — DB (`global_settings.telegramBotToken`) → env (`TELEGRAM_BOT_TOKEN`) → skip
4. **Concurrency** — `p-limit(5)` limiter shared across all sends
5. **HTML parse mode** — all messages use `parse_mode: "HTML"`; user content escaped
6. **Fallback retry** — HTTP 400 → retry as plain text (strips HTML tags)
7. **Per-language batching** — summary groups channels by `config.language`
8. **One channel per user per type** — `(userId, channelType)` unique constraint

## Requirements

### R1: Backend unit tests

Test all pure functions and core logic in isolation with mocked external dependencies:

- **R1.1** `sendTelegramText`: token resolution, empty chatId skip, missing token skip, HTTP 200 success, HTTP 400 HTML→plain-text retry, HTTP 5xx swallow, timeout, concurrency
- **R1.2** `telegramChannel.send`: missing chatId in config, language resolution (en/zh/missing), message formatting delegation
- **R1.3** `formatPriceAlertMessage`: rise/fall messages, HTML escaping, missing product name fallback, percent calculation, en/zh localization
- **R1.4** `formatProductSummaryMessage`: empty products, active/paused counts, relative time formatting, en/zh localization
- **R1.5** `formatRelativeTime`: just now, minutes, hours, days, never, en/zh
- **R1.6** `escapeTelegramHtml`: `&`, `<`, `>` escaping
- **R1.7** `formatTelegramLink`: quote escaping in href, label escaping
- **R1.8** `formatPriceGrouped`: thousands separators, negative prices, no currency
- **R1.9** `sendProductSummary`: no products, no channels, mixed-language channels, chatId missing, per-language batching
- **R1.10** `dispatchPriceAlert`: no enabled channels, adapter not registered, multiple channels, allSettled error handling
- **R1.11** `channel.ts`: registerChannel/getChannel, idempotent registration

### R2: Frontend component tests

Test UI components with mocked hooks and API calls:

- **R2.1** `channels-section.tsx`: render channel list, add channel form, delete confirmation, edit flow, empty state
- **R2.2** `telegram-help-tooltip.tsx`: render steps, toggle visibility
- **R2.3** `admin-settings-section.tsx`: bot token field display (masked), save action, validation
- **R2.4** `product-list.tsx`: send summary button state, loading/success/error feedback

### R3: Frontend infrastructure

- Add `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` as devDependencies
- Configure vitest `environment: "jsdom"` for frontend test files
- Frontend tests mock React Query hooks (`useChannels`, `useSettings`, etc.) and API calls
- Use `render`, `screen`, `fireEvent` / `userEvent` from `@testing-library/react`

### R4: Test structure

- Backend: `tests/unit/telegram.test.ts`, `tests/unit/telegram-format.test.ts`, `tests/unit/telegram-summary.test.ts`, `tests/unit/telegram-dispatch.test.ts`, `tests/unit/telegram-channel.test.ts`
- Frontend: `tests/components/channels-section.test.tsx`, `tests/components/telegram-help-tooltip.test.tsx`, `tests/components/admin-settings-section.test.tsx`, `tests/components/product-list-summary.test.tsx`
- Use Vitest + existing mocking patterns (`vi.mock`, `vi.stubGlobal`)
- Tests reference spec acceptance criteria where applicable
- Each test file maps to one source module

## Acceptance Criteria

- [ ] All R1 backend tests pass with `npx vitest run`
- [ ] All R2 frontend tests pass with `npx vitest run`
- [ ] Tests are self-contained and deterministic (no network, no live services)
- [ ] Each test has clear pass/fail criteria suitable for SWE-bench evaluation
- [ ] Tests follow existing project conventions (Vitest, `describe`/`it`, workspace aliases)
- [ ] No regressions in existing 21 tests
- [ ] `@testing-library/react` + `jsdom` installed and configured in vitest

## Out of Scope

- E2E tests requiring live Telegram Bot API or Camoufox sidecar
- Snapshot tests
- Visual regression tests

## Key Decisions

- **Frontend testing**: Full component tests with `@testing-library/react` + `jsdom`. Mock React Query hooks, not API calls directly.
- **Test organization**: One test file per source module. Backend in `tests/unit/`, frontend in `tests/components/`.
- **SWE-bench format**: Tests are self-contained, deterministic, and suitable as P2P evaluation criteria for automated code generation tasks.
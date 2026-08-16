# Implementation Plan: SWE-bench P2P tests for Telegram notification

## Checklist

### Phase 1: Infrastructure

- [ ] **1.1** Install frontend test dependencies
  ```bash
  pnpm add -D -w @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
  ```
- [ ] **1.2** Create `tests/setup.ts` with `@testing-library/jest-dom/vitest` import
- [ ] **1.3** Update `vitest.config.ts`:
  - Add `environment: "jsdom"` for `tests/components/**` pattern
  - Add `setupFiles: ["./tests/setup.ts"]`
  - Add `@iris/web` workspace alias for component imports
- [ ] **1.4** Create `tests/components/` directory
- [ ] **1.5** Verify: `pnpm vitest run` (existing tests still pass)

### Phase 2: Backend unit tests

- [ ] **2.1** `tests/unit/telegram-format.test.ts` — pure functions, simplest to start
  - `escapeTelegramHtml` (3 tests)
  - `formatTelegramLink` (2 tests)
  - `formatPriceGrouped` (5 tests)
  - `formatPriceAlertMessage` (8 tests)
  - **Verify**: `npx vitest run tests/unit/telegram-format.test.ts`
- [ ] **2.2** `tests/unit/telegram-channel.test.ts` — small, no dependencies
  - `registerChannel` / `getChannel` (3 tests)
  - **Verify**: `npx vitest run tests/unit/telegram-channel.test.ts`
- [ ] **2.3** `tests/unit/telegram.test.ts` — core sender with fetch mocking
  - Token resolution (3 tests)
  - Empty chatId (1 test)
  - HTTP 200 (1 test)
  - HTTP 400 retry (2 tests)
  - HTTP 5xx (1 test)
  - Timeout (1 test)
  - Concurrency (1 test)
  - telegramChannel.send (3 tests)
  - **Verify**: `npx vitest run tests/unit/telegram.test.ts`
- [ ] **2.4** `tests/unit/telegram-summary.test.ts` — format + send
  - `formatRelativeTime` (10 tests)
  - `formatProductSummaryMessage` (6 tests)
  - `sendProductSummary` (5 tests)
  - **Verify**: `npx vitest run tests/unit/telegram-summary.test.ts`
- [ ] **2.5** `tests/unit/telegram-dispatch.test.ts` — dispatch pipeline
  - No channels (1 test)
  - Single channel (1 test)
  - Multiple channels (1 test)
  - Unregistered adapter (1 test)
  - allSettled error (1 test)
  - Idempotent registration (1 test)
  - **Verify**: `npx vitest run tests/unit/telegram-dispatch.test.ts`

### Phase 3: Frontend component tests

- [ ] **3.1** `tests/components/telegram-help-tooltip.test.tsx` — simplest component
  - Render button (1 test)
  - Hidden by default (1 test)
  - Show on hover (1 test)
  - Hide on leave (1 test)
  - Custom title (1 test)
  - **Verify**: `npx vitest run tests/components/telegram-help-tooltip.test.tsx`
- [ ] **3.2** `tests/components/channels-section.test.tsx` — CRUD component
  - Loading (1 test)
  - Error (1 test)
  - Empty (1 test)
  - Channel list (1 test)
  - Add form + validation (2 tests)
  - Add success (1 test)
  - Delete (1 test)
  - Toggle enable (1 test)
  - Language change (1 test)
  - **Verify**: `npx vitest run tests/components/channels-section.test.tsx`
- [ ] **3.3** `tests/components/admin-settings-section.test.tsx` — bot token field
  - Loading (1 test)
  - Error (1 test)
  - Token field display (2 tests)
  - Token not configured (1 test)
  - Save with token (1 test)
  - Save empty (1 test)
  - Save success (1 test)
  - **Verify**: `npx vitest run tests/components/admin-settings-section.test.tsx`
- [ ] **3.4** `tests/components/product-list-summary.test.tsx` — summary button
  - Render button (1 test)
  - Loading (1 test)
  - Success (1 test)
  - Error (1 test)
  - **Verify**: `npx vitest run tests/components/product-list-summary.test.tsx`

### Phase 4: Final verification

- [ ] **4.1** Run all tests: `npx vitest run`
- [ ] **4.2** Run existing tests: `npx vitest run tests/unit/ai-extract.test.ts tests/unit/extract-image.test.ts` (no regressions)
- [ ] **4.3** Run acceptance tests: `pnpm test:acceptance` (no regressions)
- [ ] **4.4** Run typecheck: `pnpm typecheck` (no new errors)
- [ ] **4.5** Run lint: `pnpm lint` (no new errors)

## Validation Commands

```bash
# Run all unit tests
npx vitest run tests/unit/

# Run all component tests
npx vitest run tests/components/

# Run all tests
npx vitest run

# Run specific test file
npx vitest run tests/unit/telegram.test.ts

# Watch mode for development
npx vitest tests/unit/telegram.test.ts
```

## Risky Files

- `vitest.config.ts` — changes affect all tests
- `package.json` — new devDependencies
- `tests/unit/telegram.test.ts` — mocks `fetch` globally, must restore
- `tests/components/channels-section.test.tsx` — most complex component, many mocked hooks

## Rollback Points

- After Phase 1: revert `vitest.config.ts` and `package.json` changes, delete `tests/setup.ts` and `tests/components/`
- After Phase 2: delete individual test files, backend tests are additive
- After Phase 3: delete individual test files, frontend tests are additive

## Estimated Test Count

| Section | Tests |
|---------|-------|
| telegram-format.test.ts | 18 |
| telegram-channel.test.ts | 3 |
| telegram.test.ts | 13 |
| telegram-summary.test.ts | 21 |
| telegram-dispatch.test.ts | 6 |
| telegram-help-tooltip.test.tsx | 5 |
| channels-section.test.tsx | 10 |
| admin-settings-section.test.tsx | 8 |
| product-list-summary.test.tsx | 4 |
| **Total** | **~88** |
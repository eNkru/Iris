# Technical Design: SWE-bench P2P tests for Telegram notification

## Architecture

```
tests/
├── unit/
│   ├── telegram.test.ts          # sendTelegramText, telegramChannel.send
│   ├── telegram-format.test.ts   # escapeTelegramHtml, formatTelegramLink, formatPriceGrouped, formatPriceAlertMessage
│   ├── telegram-summary.test.ts  # formatRelativeTime, formatProductSummaryMessage, sendProductSummary
│   ├── telegram-dispatch.test.ts # dispatchPriceAlert, registerDefaultChannels
│   └── telegram-channel.test.ts  # registerChannel, getChannel, NotificationChannel interface
├── components/
│   ├── channels-section.test.tsx       # ChannelsSection CRUD
│   ├── telegram-help-tooltip.test.tsx  # TelegramHelpTooltip
│   ├── admin-settings-section.test.tsx # AdminSettingsSection bot token
│   └── product-list-summary.test.tsx   # ProductList send summary button
└── setup.ts                     # jsdom + testing-library setup
```

## Backend Test Design

### Mocking Strategy

All backend tests mock external dependencies following the existing pattern in `tests/unit/ai-extract.test.ts`:

| Dependency | Mock approach |
|-----------|---------------|
| `fetch()` (Telegram API) | `vi.stubGlobal("fetch", ...)` — return controlled HTTP responses |
| `getGlobalSettings()` (DB) | `vi.mock("@iris/database/drizzle/queries")` — return custom `telegramBotToken` |
| `db` (Drizzle) | `vi.mock("@iris/database")` — return mock query builder |
| `logger` | `vi.spyOn(logger, "warn"/"error")` — assert log calls without output |
| `p-limit` | Not mocked — test real concurrency behavior (tests run single-threaded in Vitest) |

### Test Files Detail

#### `tests/unit/telegram.test.ts`

Tests `sendTelegramText` and `telegramChannel.send`.

- **Token resolution** (3 tests):
  - DB token present → uses DB token
  - DB token empty, env var present → uses env var
  - Both empty → skips (warn log, no fetch)
- **Empty chatId** (1 test): `""` or `"  "` → warn + skip
- **HTTP 200 success** (1 test): POST to correct URL, correct body shape, `parse_mode: "HTML"`, `disable_web_page_preview: true`
- **HTTP 400 retry** (2 tests):
  - First call 400 → retries as plain text (no `parse_mode`, stripped tags)
  - Both calls 400 → logs error, swallows
- **HTTP 5xx** (1 test): 502 → logs error, swallows, no retry
- **Timeout** (1 test): AbortSignal fires → logs error, swallows
- **Concurrency** (1 test): 10 concurrent sends → at most 5 in-flight at once
- **telegramChannel.send** (3 tests):
  - Valid config with chatId + language="zh" → calls formatPriceAlertMessage with lang="zh"
  - Missing chatId → warn + skip
  - Invalid language → defaults to "en"

#### `tests/unit/telegram-format.test.ts`

Tests pure functions from `format.ts` — no mocks needed.

- **escapeTelegramHtml** (3 tests): `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, combined string, no-op on safe text
- **formatTelegramLink** (2 tests): URL with quotes in href, label with special chars
- **formatPriceGrouped** (5 tests): thousands separator, negative price, no currency, zero, large number
- **formatPriceAlertMessage** (8 tests):
  - Rise message (en) — contains `📈`, `Price increase`, correct price lines
  - Drop message (en) — contains `📉`, `Price drop`
  - Chinese localization — `价格上涨`, `价格下跌`, `追踪商品`, `查看商品`
  - Null product name uses fallback name
  - HTML escaping in product name
  - Percent calculation (rise: +10.5%, drop: -5.0%)
  - Old price = 0 → no percent displayed
  - Missing currency → no currency prefix

#### `tests/unit/telegram-summary.test.ts`

Tests `formatRelativeTime`, `formatProductSummaryMessage`, and `sendProductSummary`.

- **formatRelativeTime** (10 tests):
  - null date → "never" / "从未"
  - < 60s → "just now" / "刚刚"
  - 1-59 min → "Xm ago" / "X分钟前"
  - 1-23 hr → "Xh ago" / "X小时前"
  - 1-6 days → "Xd ago" / "X天前"
  - ≥ 7 days → locale date string
- **formatProductSummaryMessage** (6 tests):
  - Empty items → header + "No products tracked yet."
  - Single active product → correct card with number keycap, price, active status
  - Single paused product → paused status
  - Multiple products → numbered cards, correct count line
  - Product with null price → "No price recorded"
  - Chinese localization → `商品摘要`, `暂无追踪商品`, `活跃`, `暂停`
- **sendProductSummary** (5 tests):
  - No products → still sends "No products tracked yet."
  - No channels → returns `{ total: 0, sent: 0 }`
  - Single channel → sends one message, returns `{ total: 1, sent: 1 }`
  - Mixed language channels → builds ≤2 messages, sends to correct groups
  - Channel missing chatId → skipped, not counted in sent

#### `tests/unit/telegram-dispatch.test.ts`

Tests `dispatchPriceAlert` and `registerDefaultChannels`.

- **No enabled channels** (1 test): returns `{ sent: 0, total: 0 }`
- **Single channel** (1 test): calls adapter.send, returns `{ sent: 1, total: 1 }`
- **Multiple channels** (1 test): fans out, returns correct counts
- **Adapter not registered** (1 test): warns, skips, counts as settled
- **allSettled error handling** (1 test): adapter throws → logged, not thrown, sent < total
- **registerDefaultChannels idempotent** (1 test): calling twice still registers once

#### `tests/unit/telegram-channel.test.ts`

- **registerChannel + getChannel** (1 test): register then retrieve
- **getChannel unregistered** (1 test): returns undefined
- **Idempotent registration** (1 test): register same type twice → last wins

## Frontend Test Design

### Infrastructure

Add to root `package.json`:
```
@testing-library/react, @testing-library/jest-dom, @testing-library/user-event, jsdom
```

Update `vitest.config.ts`:
- Add `environment: "jsdom"` for files matching `tests/components/**`
- Add `setupFiles: ["./tests/setup.ts"]` with `@testing-library/jest-dom/vitest` import

### Mocking Strategy

Frontend tests mock hooks and i18n, not API calls:

| Dependency | Mock approach |
|-----------|---------------|
| `useChannels` / `useCreateChannel` / `useUpdateChannel` / `useDeleteChannel` | `vi.mock("../hooks/use-channels")` |
| `useGlobalSettings` / `useUpdateGlobalSettings` | `vi.mock("../hooks/use-settings")` |
| `useI18n` | `vi.mock("../lib/i18n")` — return mock `t(key)` function |
| `useSendSummary` | `vi.mock("../hooks/use-channels")` |
| React Router `Link` | Not mocked — use `MemoryRouter` wrapper |

Each component test wraps the component in necessary providers:
```tsx
function renderWithProviders(ui: ReactElement) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        {ui}
      </MemoryRouter>
    </QueryClientProvider>
  );
}
```

### Test Files Detail

#### `tests/components/channels-section.test.tsx`

- **Loading state** (1 test): shows spinner while `isLoading: true`
- **Error state** (1 test): shows error box when `isError: true`
- **Empty state** (1 test): shows empty message when no channels
- **Channel list** (1 test): renders channel rows with chatId, enabled/disabled status, language selector, enable/disable button, delete button
- **Add channel form** (2 tests): renders form with chatId input + language selector + submit button; validates chatId (rejects non-numeric)
- **Add channel success** (1 test): calls `createChannel.mutateAsync` with correct payload
- **Delete channel** (1 test): calls `deleteChannel.mutateAsync` with channel id
- **Toggle enable/disable** (1 test): calls `updateChannel.mutate` with `{ enabled: !current }`
- **Language change** (1 test): calls `updateChannel.mutate` with `{ language: "zh" }`

#### `tests/components/telegram-help-tooltip.test.tsx`

- **Renders button** (1 test): shows "?" trigger button
- **Tooltip hidden by default** (1 test): no tooltip visible initially
- **Tooltip shows on hover** (1 test): mouseEnter reveals 4-step list
- **Tooltip hides on mouse leave** (1 test): mouseLeave hides tooltip
- **Custom title** (1 test): renders custom title prop

#### `tests/components/admin-settings-section.test.tsx`

- **Loading state** (1 test): shows spinner
- **Error state** (1 test): shows error box
- **Bot token field** (2 tests): renders password input; shows "stored" hint when token exists
- **Bot token not configured** (1 test): shows "none" hint when no token
- **Save with token** (1 test): submits with `telegramBotToken` in payload
- **Save with empty token** (1 test): submits without `telegramBotToken` (undefined)
- **Save success** (1 test): shows "Saved." feedback

#### `tests/components/product-list-summary.test.tsx`

- **Send summary button** (1 test): renders button with help tooltip
- **Loading state** (1 test): button shows spinner while `isPending: true`
- **Success feedback** (1 test): shows success box with sent count
- **Error feedback** (1 test): shows error on mutation failure

## Data Flow for Mocked Tests

### Backend: sendTelegramText

```
Test → sendTelegramText(chatId, text)
  → resolveBotToken() → mocked getGlobalSettings() returns { telegramBotToken: "test-token" }
  → fetch("https://api.telegram.org/bot<token>/sendMessage", ...) → mocked fetch returns { ok: true }
  → assert: no errors thrown, correct URL called, correct body
```

### Frontend: ChannelsSection

```
Test → render(<ChannelsSection />)
  → mocked useChannels() returns { data: { channels: [...] }, isLoading: false }
  → mocked useI18n() returns { t: (key) => mockTranslations[key] }
  → assert: channel rows rendered, buttons present
```

## Compatibility

- No changes to source code — tests only
- Existing vitest config extended, not replaced
- New devDependencies added to root `package.json`
- Tests use same workspace aliases as existing tests (`@iris/utils`, `@iris/database`, etc.)

## Trade-offs

- **Mocking fetch vs MSW**: Using `vi.stubGlobal("fetch")` is simpler and matches existing patterns. MSW would add complexity without benefit for unit tests.
- **Mocking DB queries vs in-memory SQLite**: Mocking query functions is faster and more deterministic. An in-memory SQLite would test Drizzle queries but not the notification logic itself.
- **Component tests vs E2E**: Component tests with mocked hooks are fast and deterministic. They don't test the full oRPC → DB → notification pipeline, but that's covered by backend unit tests.
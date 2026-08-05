# Send product summary to Telegram from UI

## Goal

Give the user a button in the web UI that sends a summary of all their registered
tracked items (products) to their Telegram chat, reusing the existing Telegram
alert channel.

## Background / Confirmed facts

- This is Iris, a price-tracking & alert app (monorepo: `apps/web`, `packages/api`,
  `packages/prices`, `packages/database`, `packages/utils`).
- "Registered items" = the user's tracked **products** (`products` table,
  `packages/database/src/drizzle/schema/postgres.ts`). Each product has
  `name`, `url`, `currency`, `currentPrice`, `lastCheckedAt`, `active`,
  `pollIntervalMinutes`, `alertRules`.
- Price readings (`price_readings`) are stored only on price change.
- Telegram delivery already exists:
  - `alert_channels` table holds per-user channels with `config: { chatId }`,
    `enabled` (one `telegram` row per user, `(userId, channelType)` unique).
  - `@iris/prices` notifications module: `packages/prices/src/notifications/`
    — `telegram.ts` adapter (plain HTTP `sendMessage`, bot token from
    `global_settings.telegramBotToken` or `TELEGRAM_BOT_TOKEN` env), `channel.ts`
    registry, `dispatch.ts` (`dispatchPriceAlert`), `format.ts`.
  - Frontend channel management in Settings → "Alert channels"
    (`apps/web/components/channels-section.tsx`, hooks `use-channels.ts`).
- API layer is oRPC: module routers in `packages/api/src/modules/*`, frontend
  client from `apps/web/lib/orpc.ts`, queries/mutations via TanStack Query hooks
  (`apps/web/hooks/*`).
- Home page shows the product list (`apps/web/app/page.tsx`,
  `apps/web/components/product-list.tsx`).

## Requirements

- A button on the Products page that sends a summary of the user's tracked products
  to their Telegram chat.
- The button provides an on-hover help tooltip explaining (a) how to create a
  Telegram bot (via @BotFather) and obtain its token, and (b) how to configure the
  bot token and connect a chat id (which feeds the existing bot-token/chat-id
  flow). The tooltip surfaces this guidance near the action that depends on it.
- Summary format (per item): product name, current price + currency, active/paused
  status, last-checked time, and product URL. Message includes a header line with
  total item count.
- Include ALL tracked products (active and paused), each labeled with its status.
- Reuse the existing Telegram channel infrastructure (`alert_channels`,
  `@iris/prices` notifications adapter). No new channel types.
- No new database tables.
- If the user has no enabled Telegram channel, show a clear error and a link to
  Settings → Alert channels (do not silently fail). If they have no products, the
  message should still send (with a "No products" body) or the action should report
  the empty state clearly.

## Acceptance Criteria

- A "Send summary to Telegram" button is visible on the Products page.
- The button shows a hover tooltip with setup guidance: how to create a bot with
  @BotFather, where to get the bot token, and how to configure the token and chat
  id so the summary can be delivered.
- Clicking it builds and sends a Telegram message containing every tracked product
  (active + paused), formatted as: name + price/currency, status, last-checked time,
  and URL, with a header showing the total count.
- The summary is delivered to the user's Telegram via their configured enabled
  Telegram chat id, using the existing bot token resolution.
- If no enabled Telegram channel exists, the UI shows a clear error and directs the
  user to Settings → Alert channels.
- The action is reachable only by an authenticated user and respects their own data.
- Sending is a no-op/clear error if there are no tracked products.

## Out of Scope

- New notification channel types (e.g. email).
- Telegram bot webhook handling / inbound commands (e.g. sending `/summary` to the bot).
- Scheduled/automated summary sending.

## Open Questions

- None (all product decisions resolved).

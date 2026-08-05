# Send product summary to Telegram from UI — Design

## Architecture / boundaries

New backend capability lives in `@iris/prices` notifications module; a thin
oRPC procedure exposes it; a button + hook on the Products page call it.

```
[ProductList button] --rpc--> channels.sendSummary (packages/api)
                                     |
                                     v
                 sendProductSummary(userId)  (packages/prices/src/notifications/summary.ts)
                    |-- query enabled alert_channels for user
                    |-- query products (all) for user
                    |-- build text via formatProductSummaryMessage
                    '-- sendTelegramText(chatId, text) per enabled telegram channel
```

## Key pieces

### 1. Low-level telegram sender (refactor `packages/prices/src/notifications/telegram.ts`)

Extract the token-resolution + `sendMessage` call currently inside
`telegramChannel.send` into an exported `sendTelegramText(chatId, text, meta?)`
helper (still uses the p-limit limiter, 10s timeout, error-swallowing, structured
logging). `telegramChannel.send` delegates to it. The summary path reuses it, so
bot-token resolution and send semantics stay in ONE place.

### 2. Summary module (new `packages/prices/src/notifications/summary.ts`)

- `formatProductSummaryMessage(products, count): string` — pure function:
  header `📦 Product summary — N tracked item(s)`, then per item a compact
  block: name, formatted price/currency (reuse `formatPrice` from `format.ts`),
  Active/Paused label, last-checked relative time, and the product URL.
  `formatRelativeTime` is currently in `apps/web/components/ui.tsx` (client);
  add a small server-side equivalent here (date math only) rather than sharing
  UI code into the API package.
- `sendProductSummary(userId): Promise<{ sent, total, productsCount }>`:
  queries the user's enabled `alert_channels` (only telegram type is registered),
  queries the user's products (all, active + paused), builds the text, sends via
  `sendTelegramText` per channel. Never throws on send failure (matches existing
  adapter contract). Empty products → still send a short "No products tracked yet"
  message so the user gets Telegram confirmation. Returns `{ sent, total, productsCount }`.

### 3. oRPC procedure (new `packages/api/src/modules/channels/procedures/send-summary.ts`)

`protectedProcedure`, `POST /channels/summary`, no input. Calls
`sendProductSummary(context.user.id)`; if `total === 0` (no enabled channel)
throw `ORPCError("PRECONDITION_FAILED", { message: "No enabled Telegram channel — add one in Settings → Alert channels" })`.
Output schema `sendSummaryOutputSchema`: `{ success: true, reason, sent, total, productsCount }`.
Register in `channelsRouter` as `sendSummary`.

### 4. Frontend

- `apps/web/hooks/use-channels.ts`: add `useSendSummary()` mutation calling
  `orpcClient.channels.sendSummary()`.
- `apps/web/components/product-list.tsx`: add a "Send summary to Telegram"
  `ButtonSecondary` next to the existing "Refresh" button in the footer row;
  on success show a transient `SuccessBox`; on error show `ErrorBox` (e.g. the
  PRECONDITION_FAILED message telling the user to configure a channel in Settings).
- The button is wrapped in a helper component that renders a hover tooltip
  (React `onMouseEnter`/`onMouseLeave` + absolute-positioned panel) containing
  step-by-step Telegram setup guidance: create a bot with @BotFather, copy the
  bot token, set the token in global settings (admin) / env, then send the bot
  `/start` and add the generated chat id in Settings → Alert channels. Reuse this
  tooltip content constant so it can also be placed in Settings → Alert channels
  if desired.

## Data flow / contracts

- Input: none (authenticated user from session).
- Output: `{ success, reason, sent, total, productsCount }`.
- Errors: `UNAUTHORIZED` (no session), `PRECONDITION_FAILED` (no enabled channel).
- No new tables; no schema migration; no new env vars.

## Trade-offs

- Direct `sendTelegramText` for telegram channels rather than adding a second
  method to the `NotificationChannel` interface: MVP has only telegram; keeping
  the interface tied to price alerts avoids forcing every future channel to
  implement summary sending. If multi-channel summaries are wanted later, add an
  optional `sendSummary` method to the interface.
- Summary is generated server-side from DB rows, not from the client's cached
  list, so the message always reflects current data.
- Sending is best-effort like price alerts: Telegram failures are logged, never
  thrown; the procedure still returns `success: true` with `sent < total`. The UI
  reports "sent to N channel(s)".

## Rollback

- Removing the procedure + button restores previous behavior. No schema change
  means no data migration. The `telegram.ts` refactor is behavior-preserving
  (extract-only) and safe to revert.

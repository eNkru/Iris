# Telegram Notifications — Code Spec

Executable contracts for the `@iris/prices` notifications module
(`packages/prices/src/notifications/`). All Telegram message text is sent with
`parse_mode: "HTML"`, so every message formatter MUST produce escaped Telegram
HTML (see [HTML escaping](#html-escaping)). Sends are best-effort and never
throw to the caller.

## Architecture / boundaries

```
[Caller: price-check pipeline | summary procedure]
        |  (packages/prices/src/notifications/)
        v
  sendTelegramText(chatId, text, meta?)      <- LOW-LEVEL, exportable
        |  token resolution -> p-limit -> sendMessage (10s timeout)
        '-> never throws; failures logged
```

High-level senders (`telegramChannel.send`, `sendProductSummary`) delegate to
`sendTelegramText`. Bot-token resolution and send semantics live in exactly one
place.

## Signatures

```typescript
// packages/prices/src/notifications/telegram.ts
export async function sendTelegramText(
  chatId: string,
  text: string,
  meta?: Record<string, unknown>,
): Promise<void>;

// packages/prices/src/notifications/format.ts
// Notifications are localized; every formatter takes `lang: Language = "en"`.
// `Language` = `"en" | "zh"` (z.enum(LANGUAGE_VALUES) from @iris/utils).
export function formatPriceAlertMessage(
  notification: PriceAlertNotification,
  lang: Language = "en",
): string;

// packages/prices/src/notifications/summary.ts
export function formatProductSummaryMessage(
  items: ProductSummarySource[],
  lang: Language = "en",
): string;
export function formatRelativeTime(date: Date | null, lang: Language = "en"): string;
export async function sendProductSummary(userId: string): Promise<{
  sent: number;        // channels that received a message
  total: number;       // enabled telegram channels targeted
  productsCount: number;
}>;
```

The `lang` parameter **defaults to `"en"`** so all pre-existing non-localized
callers/backfills behave identically (bounded blast radius; unset channel
configs get the English default).

## Contracts

- **Bot token resolution**: `global_settings.telegramBotToken` first, falling
  back to `TELEGRAM_BOT_TOKEN` env var. No token → warn + skip (no throw).
- **Empty chatId** (`""` or whitespace) → warn + skip.
- **Per-channel language**: each `alert_channels` row stores
  `config.language` (`"en" | "zh"`), validated on channel create/update by
  `languageZodSchema`. Missing/invalid value resolves to `"en"` at send time.
- **`sendTelegramText`** posts `chat_id`, `text`, `parse_mode: "HTML"`,
  `disable_web_page_preview: true`. Runs inside the shared `p-limit`
  limiter (`TELEGRAM_CONCURRENCY`). HTTP non-OK → retry once as plain text
  (strips HTML tags) when status is `400`; otherwise log + swallow.
- **oRPC procedure** `channels.sendSummary` (`POST /channels/summary`,
  protected, no input):
  - Output `sendSummaryOutputSchema`:
    `{ success: z.literal(true), reason, sent, total, productsCount }`.
  - `total === 0` (no enabled telegram channel) → `ORPCError("PRECONDITION_FAILED")`.
- **Summary text** (parse_mode HTML): header `📦 Product summary`, count line
  (`N tracked · A active · P paused`), one card per product: number keycap,
  `<b>`-wrapped clickable name link, `💰` price line, `✅ Active` / `⏸️ Paused`
  + `checked <relative time>`. Empty products → header + "No products tracked
  yet." line (still sends). The localized header/prose come from
  `summaryText[lang]` / `priceAlertText[lang]`.
- **Per-language message batching**: `sendProductSummary` groups enabled
  channels by `config.language`, building **one message per distinct language**
  (`en`/`zh`, ≤2 messages) and sharing it across channels in that group via
  `Promise.all` (never `await` in a loop). Each send carries meta
  `{ userId, productsCount, language }`.

## Validation & Error Matrix

| Condition                        | Behavior                                         |
| -------------------------------- | ------------------------------------------------ |
| No bot token configured          | warn log, skip (no throw)                        |
| Empty / whitespace chatId        | warn log, skip                                   |
| `config.language` missing / invalid | sends with default `"en"`                     |
| Telegram API 400 (bad markup)    | retry once as plain text; if still failing, log  |
| Telegram API network/5xx         | log + swallow (message dropped)                  |
| No enabled telegram channel      | procedure throws PRECONDITION_FAILED             |
| No products                      | summary still sends "No products tracked yet."   |

## HTML escaping

`format.ts` exports helpers used by ALL message formatters:

- `escapeTelegramHtml(text)` — escapes `&`, `<`, `>` (telegram HTML only
  understands `<b>`, `<i>`, `<a>`, etc.; user content must be escaped).
- `formatTelegramLink(url, label)` — attribute-escapes `"` in href, escapes
  label text. Use instead of raw URLs in messages.
- `formatPriceGrouped(price, currency)` — thousands separators, e.g.
  `"USD 1,999.00"` (vs `formatPrice`'s plain `"USD 1999.00"`).

> **Warning**: Never interpolate user-supplied strings (product name, URL)
> directly into a Telegram HTML message. Escape every value. Raw `<` or `&`
> from a product name breaks parsing or renders wrong.

## Design decisions

- **`sendTelegramText` extracted** as the single low-level sender so both price
  alerts and summaries share token resolution, rate limiting, timeout, and
  error handling.
- **Best-effort delivery**: Telegram failures are logged, never thrown; a
  procedure may still return `success: true` with `sent < total`. The UI
  reports `sent` / `total`.
- **Summary built server-side** from DB rows (not the client cache) so the
  message always reflects current data.
- **No per-channel interface method** for summaries (MVP has only telegram);
  add an optional `sendSummary` to `NotificationChannel` if multi-channel
  summaries arrive.
- **Per-language batching** (`sendProductSummary`): enabled channels are
  grouped by `config.language` so users with mixed `en`/`zh` channels still get
  ≤2 summary messages, each built once and shared (reuse the `textByLanguage`
  map); sends run concurrently via `Promise.all`, never `await` inside a loop.
- **Backward-compatible `lang` default**: formatters take `lang: Language =
  "en"` so legacy non-localized callers (e.g. stored notification templates)
  render identically; message text lives in `summaryText[lang]` /
  `priceAlertText[lang]` maps keyed by `Language`.

## Related

- `packages/prices/src/notifications/format.ts` — message formatters + escaping
- `packages/prices/src/notifications/summary.ts` — summary module
- `packages/api/src/modules/channels/procedures/send-summary.ts` — oRPC wrapper
- `apps/web/components/telegram-help-tooltip.tsx` — `TELEGRAM_SETUP_STEPS`
  (shared setup guidance constant)

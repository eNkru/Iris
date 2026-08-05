# Send product summary to Telegram from UI — Implement

## Checklist

1. Refactor `packages/prices/src/notifications/telegram.ts`:
   - Extract `sendTelegramText(chatId, text, meta?)` low-level sender
     (token resolution, p-limit, timeout, error-swallowing, logging).
   - `telegramChannel.send` delegates to it. Behavior preserved.
2. Add `packages/prices/src/notifications/summary.ts`:
   - `formatProductSummaryMessage(products, count)` — header + per-item block
     (name, price/currency, Active/Paused, last-checked time, URL).
   - `formatRelativeTime` server-side helper (date math only).
   - `sendProductSummary(userId)` — query enabled channels, query products,
     build text, send per telegram channel; empty-products → short message.
     Returns `{ sent, total, productsCount }`.
3. Export summary from `packages/prices/src/notifications/index.ts`.
4. Add `sendSummaryOutputSchema` to `packages/api/src/modules/channels/types.ts`.
5. Add `packages/api/src/modules/channels/procedures/send-summary.ts`
   (`POST /channels/summary`, protected, PRECONDITION_FAILED when `total === 0`).
6. Register `sendSummary` in `packages/api/src/modules/channels/router.ts`.
7. Add `useSendSummary()` to `apps/web/hooks/use-channels.ts`.
8. Add "Send summary to Telegram" button + transient success/error feedback in
   `apps/web/components/product-list.tsx`.
9. Add a hover tooltip component (or a shared `TelegramHelpTooltip` in
   `apps/web/components/`) with the @BotFather → bot token → chat-id setup
   guidance, and wrap the "Send summary" button with it in `product-list.tsx`.

## Validation commands

```bash
pnpm --filter @iris/prices typecheck
pnpm --filter @iris/api typecheck
pnpm --filter @iris/web typecheck
pnpm lint
pnpm build
```

## Risky files / rollback points

- `packages/prices/src/notifications/telegram.ts` — refactor must be
  behavior-preserving; verify existing price-alert dispatch still works.
- `packages/api/src/modules/channels/router.ts` — ensure no path conflicts.
- `apps/web/components/product-list.tsx` — UI only, easy to revert.

## Review gates

- PRD acceptance criteria all satisfied.
- `pnpm lint` and typecheck pass with 0 errors.
- Manual smoke: no channel configured → clear error; channel configured +
  products → Telegram message with all items; empty products → "No products
  tracked yet" message; tooltip shows setup steps on hover.

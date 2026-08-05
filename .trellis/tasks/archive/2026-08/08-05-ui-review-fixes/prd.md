# Frontend UX/UI review fixes

## Goal

Apply the 2026-08-05 UX/UI review of the Iris web app (`apps/web`) so that product-tracking flows are reliable, every user action gives visible feedback, and the interface is consistent and keyboard-accessible. Pure-frontend work only — no API/schema changes.

User value: no misleading shared loading states, no silent failures, no accidental silent trackers, clearer price/freshness presentation.

## Background / Confirmed Facts

Evidence gathered from the codebase (2026-08-05):

- App surface: home/products list (`app/page.tsx`), product detail (`app/products/[id]/page.tsx`), settings (`app/settings/page.tsx`), login (`app/login/page.tsx`). UI primitives are hand-rolled in `components/ui.tsx` (intentionally dependency-free — no clsx/tailwind-merge/component library).
- React Query defaults: `retry: 1`, `refetchOnWindowFocus: false` (`components/providers.tsx:18-21`) — nothing auto-refreshes today.
- oRPC's RPC-JSON serializer revives `Date` instances on the client (verified in `@orpc/client` dist), so `checkedAt`/`lastCheckedAt` arrive as real `Date` objects — relative-time math is safe client-side.
- Alert-rule semantics (`packages/prices/src/pipeline/alert-rules.ts`): `anyChange: false` **and** no thresholds configured ⇒ the product never alerts. The current form (`components/product-edit-form.tsx:89-112`) gives no hint of this.
- Product `name` is filled by the AI extraction only after the first successful check (`packages/prices/src/pipeline/check-price.ts:128`); until then it is `null`. Detail page renders `"Untitled product"` (`app/products/[id]/page.tsx:66`); list falls back to the URL (`components/product-list.tsx:71`).
- List items include `latestReading` (last change-point) but **not** the previous reading (`packages/api/src/modules/products/types.ts` `productListItemOutputSchema`) — a list trend indicator (up/down) is not implementable without an API change.
- Telegram adapter (`packages/prices/src/notifications/telegram.ts`) sends via `sendMessage` using the admin-configured bot token; it can only deliver if the user has started a conversation with the bot. The channel form (`components/channels-section.tsx:116-137`) does not explain how to obtain the chat id or that prerequisite.
- No `apps/web/public` directory and no `app/icon.*` — the browser gets a favicon 404.
- All list rows share one mutation state: `checkNow.isPending` / `updateProduct.isPending` gate every row's buttons and spinners (`components/product-list.tsx:96-107`).
- Product-detail "Check now" is fired with no `onError` (`app/products/[id]/page.tsx:87`) — network/auth failures are invisible.
- Delete confirmation uses `window.confirm` (`components/product-list.tsx:31`).
- `"Saved."` is rendered from `isSuccess`, which stays true indefinitely after one save (`components/product-edit-form.tsx:115-117`, `components/user-settings-section.tsx:71-73`, `components/admin-settings-section.tsx:167-169`).
- Chart range selector reuses `ButtonSecondary` with a dark-override className hack (`components/price-chart.tsx:62-74`).
- Buttons and nav links have no focus-visible styles (`components/ui.tsx:21,33,45`, `components/app-nav.tsx:29`); inputs do.
- Price formatting is hand-rolled `${currency} ${amount}` (`components/ui.tsx:125-128`).
- Login copy has a wording glitch ("we will send you a magic link") and the post-send state replaces the form with no resend/spam-folder guidance (`app/login/page.tsx:46-50,82-83`).

## Requirements

### P0 — broken or misleading states

- **R1. Per-row action state in the product list.** "Check now" and "Pause/Resume" pending state must apply only to the row clicked; other rows stay enabled and show no spinner. (`components/product-list.tsx`)
- **R2. No silent check-now failures on the product detail page.** Mutation errors (network, session expiry, NOT_FOUND) must render an inline error instead of disappearing. (`app/products/[id]/page.tsx`)
- **R3. Alert-rules silent-config warning.** When `anyChange` is unchecked and all four thresholds are empty, show an inline warning that no alerts will be sent. Saving remains allowed (user decision: allow + warn — silent history-only tracking is a legitimate use case). (`components/product-edit-form.tsx`)

### P1 — important UX gaps

- **R4. Paused products visibly marked in the list.** A paused product must be distinguishable at a glance (badge + muted styling), not only via the Pause/Resume button label. (`components/product-list.tsx`)
- **R5. Inline delete confirmation.** Replace `window.confirm` with an inline two-step confirm (Confirm delete / Cancel) on the row. (`components/product-list.tsx`)
- **R6. Freshness: relative "last checked" + auto-refresh.** Show relative times ("just now", "5m ago", "3h ago", "2d ago", then locale date) with the full timestamp in a `title` attribute, on both list and detail. The products list auto-refetches every 30 s while the home page is mounted. (`components/ui.tsx`, `components/product-list.tsx`, `app/products/[id]/page.tsx`, `hooks/use-products.ts`)
- **R7. Telegram chat-id guidance.** The channel form must explain how to obtain the chat id and that the user must send the bot a message first before alerts can be delivered. (`components/channels-section.tsx`)
- **R8. Transient "Saved." feedback.** Success text appears after a successful save and clears on the next field edit or after ~3 s — it never lingers indefinitely. Applies to product edit, user settings, and admin global settings forms. (`components/product-edit-form.tsx`, `components/user-settings-section.tsx`, `components/admin-settings-section.tsx`)

### P2 — polish & accessibility

- **R9. Locale-aware price formatting.** `formatPrice` uses `Intl.NumberFormat` with `style: "currency"` when the currency is a valid ISO-4217 code; falls back to `CODE amount` (or bare amount when currency is null) on invalid/unknown codes without throwing. Applied everywhere prices render, including chart tooltip and Y-axis. (`components/ui.tsx`, `components/price-chart.tsx`)
- **R10. Segmented control for chart range.** Replace the ButtonSecondary-with-dark-override hack with a proper segmented control (`aria-pressed` on each option). nuqs URL state (`?range=`) unchanged. (`components/price-chart.tsx`, new primitive in `components/ui.tsx`)
- **R11. Chart currency context.** Tooltip and axis show the product's currency when known (e.g. tooltip series label "Price (NZD)"). (`components/price-chart.tsx`)
- **R12. Visible keyboard focus.** All buttons and nav links get `focus-visible` ring styles consistent with the inputs. (`components/ui.tsx`, `components/app-nav.tsx`)
- **R13. Detail title fallback.** When `name` is null the detail page shows the (truncated) URL as the heading instead of "Untitled product". (`app/products/[id]/page.tsx`)
- **R14. Login polish.** Natural copy, plus after the magic link is sent: spam-folder hint and a way to resend (re-submit) without reloading. (`app/login/page.tsx`)
- **R15. Favicon.** Add an app icon (e.g. `app/icon.svg`, auto-served by Next.js App Router) so the tab shows an icon and there is no favicon 404.

## Acceptance Criteria

- [ ] **AC1 (R1).** With ≥2 tracked products, clicking "Check now" (or Pause/Resume) on one row shows pending state only on that row; every other row's buttons remain enabled.
- [ ] **AC2 (R2).** A failed check-now request on the product detail page (e.g. offline network / expired session) shows an inline error message; a silent no-feedback failure is not the result.
- [ ] **AC3 (R3).** With "Alert on any price change" unchecked and all thresholds blank, an inline warning states no alerts will be sent; saving still succeeds; checking the box or entering any threshold hides the warning.
- [ ] **AC4 (R4).** A paused product shows a visible "Paused" badge in the product list.
- [ ] **AC5 (R5).** Delete shows an inline Confirm/Cancel state; Cancel restores the row; Confirm deletes; `window.confirm` is gone from the codebase.
- [ ] **AC6 (R6).** "Last checked" renders as a relative time with the full timestamp in the `title` attribute (list + detail); while the home page is open, the product list refetches automatically (~every 30 s) with no user action.
- [ ] **AC7 (R7).** The alert-channels section explains how to find the Telegram chat id and that the user must message the bot first.
- [ ] **AC8 (R8).** After saving any of the three settings forms, "Saved." appears, then disappears on the next field edit or within ~3 s; it never persists indefinitely.
- [ ] **AC9 (R9).** Prices with a valid currency code (e.g. NZD) render via `Intl.NumberFormat`; null or invalid codes fall back gracefully (no exceptions, no `NaN`).
- [ ] **AC10 (R10).** The chart range selector renders as a segmented control with correct `aria-pressed` states; selecting a range still updates the `?range=` URL param.
- [ ] **AC11 (R11).** Chart tooltip (and axis where practical) include the product currency when known.
- [ ] **AC12 (R12).** Tabbing through the app shows a visible focus ring on every button and nav link.
- [ ] **AC13 (R13).** A product with a null name shows its truncated URL as the detail-page heading.
- [ ] **AC14 (R14).** After requesting a magic link the user sees a spam-folder hint and can resend from the same screen.
- [ ] **AC15 (R15).** The browser tab displays the Iris icon; no favicon 404 in dev tools.
- [ ] **AC16.** `pnpm --filter @iris/web typecheck` and `pnpm --filter @iris/web lint` pass.

## Out of Scope / Deferred (follow-up task, needs API changes)

- **Test-alert button** on the channels section (needs a `channels.test` endpoint).
- **Product rename** (`products.update` input schema has no `name` field).
- **List trend indicator** (list payload lacks the previous reading; needs `products.list` extension).
- Per-user AI-model override UI, email alert channel, dark mode, i18n, mobile nav redesign.

## Key Decisions

1. **Scope:** all P0–P2 frontend-only items plus auto-refresh; API-dependent enhancements deferred to a follow-up task (user decision, 2026-08-05).
2. **Silent alert config:** allowed but warned inline — history-only tracking stays possible (user decision, 2026-08-05).
3. **No new dependencies:** segmented control, inline confirm, and relative-time helper are hand-rolled in `components/ui.tsx`, preserving its dependency-free contract.
4. **Auto-refresh cadence:** 30 s `refetchInterval` on the products list query only (detail/history page keeps manual "Check now").

## Risks / Technical Notes

- Relative time renders client-side only; pages are gated behind `AuthGate` (client-resolved session), so no SSR/hydration mismatch is introduced.
- `Intl.NumberFormat` throws `RangeError` on invalid currency codes — wrap in try/catch with the current string format as fallback.
- Inline delete confirm must handle the user starting a delete on one row then clicking another — track a single `confirmingDeleteId`.
- Per-row pending tracking clears in `onSettled` (not just `onSuccess`) so failed mutations re-enable the row.

## Artifact Status

- `prd.md` — this file (convergence pass applied).
- `design.md` — technical design for all 15 requirements.
- `implement.md` — ordered execution checklist + validation.

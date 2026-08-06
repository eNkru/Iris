# Dark/light mode + multi-language (en/zh)

## Goal

Give Iris a dark/light appearance toggle and a Chinese/English UI with
localized Telegram notification messages. Both features follow the app's
existing dependency-free, React-Context conventions.

## Background / Confirmed facts

- Monorepo: `apps/web` (Next.js 15 App Router), `packages/prices`
  (notifications), `packages/utils` (shared enums).
- Dark mode groundwork already uncommitted in the working tree:
  - `apps/web/lib/theme.tsx` — `ThemeProvider` + `useTheme()` (localStorage
    `iris.theme`, follows OS preference live, `.dark` class on `<html>`).
  - `apps/web/components/theme-toggle.tsx` — ☀️/🌙 toggle button (NOT yet
    mounted in `app-nav.tsx`).
  - `apps/web/app/globals.css` — `@custom-variant dark` (Tailwind v4 class mode).
  - `apps/web/app/layout.tsx` — FOUC-prevention script + `dark:` body classes.
  - `apps/web/components/providers.tsx` — `ThemeProvider` wired in.
  - `apps/web/components/ui.tsx` — shared primitives already have `dark:`
    variants (Button, ButtonSecondary, ButtonDanger, Input, Label, Card,
    Spinner, ErrorBox, SuccessBox, SegmentedControl).
- i18n groundwork (uncommitted): `packages/utils/src/lib/enum-types.ts` has
  `LANGUAGE_VALUES = ["en", "zh"]`, `languageZodSchema`, `type Language` — the
  intent comment says "notification message language, stored per alert channel
  in `alert_channels.config.language`" (JSONB, no migration). Nothing uses it yet.
- Notification flow today:
  - `dispatchPriceAlert(notification)` queries enabled channels and calls
    `adapter.send(notification, asRecord(channel.config))` (dispatch.ts).
  - `telegramChannel.send` reads `config.chatId`, calls
    `formatPriceAlertMessage(notification)` (English, hardcoded).
  - `sendProductSummary(userId)` builds one English message via
    `formatProductSummaryMessage(items)` and sends to every enabled channel.
  - Message formatters in `packages/prices/src/notifications/format.ts`
    (`escapeTelegramHtml`, `formatPriceGrouped`, `formatTelegramLink`) are
    language-agnostic; the surrounding prose/emoji lines are hardcoded English.
- UI pages include server components with static text: `apps/web/app/page.tsx`,
  `apps/web/app/login/page.tsx`, `apps/web/app/settings/page.tsx`,
  `apps/web/app/products/[id]/page.tsx`; the interactive surface lives in
  `apps/web/components/*` "use client" components.
- Repo conventions: dependency-free UI utilities (no clsx/next-intl), React
  Context for appearance/UI state, structured logging, Tailwind v4.

## Requirements

### Dark / light mode

- R1. A theme toggle is visible in the top nav (and anywhere the layout uses it).
- R2. Toggling switches every page/component between light and dark with no
  visible flash of wrong theme (FOUC script already handles first paint).
- R3. All visible UI surfaces get `dark:` variants: app-nav, product-list,
  add-product-form, channels-section, admin/user settings sections,
  product-edit-form, price-chart, login, auth-gate, telegram-help-tooltip,
  and any remaining slate-colored utilities.
- R4. Choice persists (localStorage `iris.theme`); no stored choice follows OS
  `prefers-color-scheme` live.

### UI language (en/zh)

- U1. A language switcher (English / 中文) in the top nav.
- U2. Switching translates the UI: nav links, page headings/intro, forms,
  product list (statuses, buttons, empty states), settings sections, chart
  labels, login page, tooltips, transient success/error boxes.
- U3. Choice persists; default is English.
- U4. Server components (page headings/intro, `<html lang>`, metadata title)
  reflect the chosen language, not just client components.

### Notification message language (en/zh)

- N1. Each alert channel can carry a notification language in
  `alert_channels.config.language` (`en` | `zh`), default `en`.
- N2. Price-alert messages are formatted in the channel's language.
- N3. Product summaries respect each channel's language (channels with the
  same language share one message; mixed-language channels get per-language
  messages).
- N4. The Settings → Alert channels UI offers the language choice when adding
  / editing a channel.

## Acceptance Criteria

- [ ] AC-Theme: A toggle in the nav switches the whole app light ↔ dark and
      back; all pages (products, product detail, settings, login) render
      correctly in both modes with no light-only surfaces or unreadable text.
- [ ] AC-Theme: Reload keeps the chosen theme; no flicker on first paint; with
      no stored choice the OS theme applies.
- [ ] AC-UI: A language switcher in the nav toggles the interface between
      English and Chinese across nav, home, product list, add/edit product
      forms, settings (alert channels, admin, user), product detail, chart,
      login, and tooltips.
- [ ] AC-UI: Reload keeps the chosen language; default is English; `<html lang>`
      and page metadata reflect it.
- [ ] AC-N1: Creating an alert channel stores `config.language` (default `en`);
      editing a channel can change it.
- [ ] AC-N2: With `config.language = "zh"`, a triggered price alert arrives in
      Chinese; with `"en"` in English.
- [ ] AC-N3: The "Send summary" action delivers messages in each enabled
      channel's configured language (single shared language → one message).
- [ ] AC-Q: `pnpm lint`, all three `--filter typecheck`s, and `pnpm build` pass.

## Out of Scope

- URL-path locales (`/en`, `/zh`), `next-intl` or other i18n libraries.
- Machine translation / locale-aware number/date formatting (keep the current
  server-side relative-time + grouped-price helpers).
- Storing UI language per user in the DB (localStorage only).
- Additional languages beyond en/zh.

## Open Questions

- None (architecture resolved from repository conventions; see design.md).

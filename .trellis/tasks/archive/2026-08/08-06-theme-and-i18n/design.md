# Dark/light mode + multi-language (en/zh) — Design

## Architecture / boundaries

Two independent features sharing the same persistence conventions
(localStorage + React Context), plus one backend touch point (notification
language).

```
[ThemeToggle] ──useTheme──> ThemeProvider (lib/theme.tsx)   .dark on <html>
[LangToggle]  ──useI18n──> LanguageProvider (lib/i18n.tsx)  <html lang> + t(lang,key)

dispatchPriceAlert ──adapter.send(n, config)──> telegramChannel.send
                                                  └─> formatPriceAlertMessage(n, config.language)
sendProductSummary ──channels ──> formatProductSummaryMessage(items, lang) per language group
```

## Part A — Dark mode completion (mostly scaffolded)

Already uncommitted and working: `theme.tsx`, `theme-toggle.tsx`,
`globals.css` dark variant, FOUC script, `Providers` wiring, `ui.tsx` dark
variants. Remaining work is purely additive styling:

1. Mount `<ThemeToggle />` in `apps/web/components/app-nav.tsx` (right side,
   before the email / sign-out).
2. Add `dark:` variants to every component/page that still uses raw slate
   classes: `app-nav.tsx` (header, links, brand), `product-list.tsx`,
   `add-product-form.tsx`, `channels-section.tsx`, `admin-settings-section.tsx`,
   `user-settings-section.tsx`, `product-edit-form.tsx`, `price-chart.tsx`,
   `auth-gate.tsx`, `telegram-help-tooltip.tsx`, `login/page.tsx` +
   `components/*` used there, `settings/page.tsx`, `products/[id]/page.tsx`.
   Palette convention (follow `ui.tsx`): surfaces `slate-900/white` →
   `dark:slate-900/800`, borders `slate-200` → `dark:slate-700/800`, muted text
   `slate-500` → `dark:slate-400`, danger/emerald tinted surfaces stay hue-tinted.
3. Verify no component mixes fixed dark-only text colors that break on light
   (all existing slate colors are fine on both; only add `dark:`).

## Part B — UI i18n (dependency-free)

Follow the theme pattern exactly — a plain dictionary + context. No `next-intl`,
no URL routes.

### Files

- `apps/web/lib/i18n.ts` (new): `type Lang = "en" | "zh"`; `dictionaries` with
  typed keys; `t(lang, key, vars?)` interpolating `{n}` placeholders; flat
  `DictKey` union so missing keys fail typecheck.
- `apps/web/lib/i18n.tsx` (new): `LanguageProvider` (localStorage `iris.lang`,
  default `"en"`) + `useI18n()` returning `{ lang, setLang, t }` + `mounted`
  (same SSR pattern as theme). Sets `document.documentElement.lang`.
- `apps/web/components/language-toggle.tsx` (new): segmented English/中文 toggle
  (reuse `SegmentedControl` from `ui.tsx`), mounted next to `ThemeToggle`.
- Provider added inside `providers.tsx` (client) — same position as
  `ThemeProvider`.

### Server components

`page.tsx`, `settings/page.tsx`, `login/page.tsx`, `products/[id]/page.tsx` are
server components. They read the language from the `iris.lang` cookie (client
toggle writes the cookie in addition to context state) via a tiny server helper
`getLang()` using Next `cookies()`, and render headings/intro through `t()`.
`<html lang>` is set in the server `layout.tsx` from the same cookie helper.
Client toggle keeps the cookie in sync so the next SSR render matches.

### Translation surface (enumerate in implement.md)

All user-visible strings in nav, home, product list, add/edit product forms,
settings (channels/admin/user), price chart labels/aria, login, product detail,
tooltips, transient success/error copy, and `TelegramHelpTooltip` steps.

## Part C — Notification message language

### Data

- `alert_channels.config.language` (`"en" | "zh"`, JSONB, no migration).
  Default `en`. Validated by `languageZodSchema` from `@iris/utils`.

### Formatting

- `formatPriceAlertMessage(notification, lang: Language)` — localize the
  prose/emoji lines (`Price increase`/`价格上涨`, `View product`/`查看商品`,
  `Tracked product`/`追踪商品`, `Price drop`/`价格下跌`). Price/percent helpers
  stay language-agnostic.
- `formatProductSummaryMessage(items, lang)` — localize header
  (`Product summary`/`商品摘要`), `N tracked · A active · P paused`
  (`. N 个商品 · A 活跃 · P 暂停`), `Active`/`Paused` labels
  (`活跃`/`暂停`), `checked <time>` (`检查于`/`checked`), and the empty
  `No products tracked yet` (`暂无追踪商品`) message. Emoji markers unchanged.
- `formatRelativeTime` output strings localize (`ago`/`前`, `just now`/`刚刚`,
  `never`/`从未`).

### Flow

- `telegramChannel.send(notification, config)` reads `config.language`
  (default `en`), passes it to `formatPriceAlertMessage`. No signature change to
  the `NotificationChannel` interface — language rides the config object.
- `sendProductSummary(userId)` groups enabled channels by `config.language`,
  builds one message per language, sends each group's channels with that text.
  `chatId`/empty handling unchanged.

### Channels UI

- `channels-section.tsx`: language selector (SegmentedControl en/zh) in the
  "add channel" form; show chosen language on each channel row; allow changing
  it via the existing update path (`updateChannel.mutate({ id, language })`).

## Contracts

- `Language` enum: `"en" | "zh"` (from `@iris/utils` `languageZodSchema`).
- `alert_channels.config`: `{ chatId: string, language?: "en" | "zh" }`.
- API: `createChannel` / `updateChannel` input schemas gain optional
  `language`; output reflects it. Backward compatible (missing = `en`).
- Cookie: `iris.lang` (`en`/`zh`); localStorage keys `iris.theme`, `iris.lang`.
- No new tables; no new env vars; no new dependencies.

## Trade-offs

- **Lightweight dictionaries vs `next-intl`**: no new dependency, matches repo
  convention, typechecked keys. Cost: no pluralization/ICU, manual interpolation.
- **Cookie for server text vs client-only context**: server components
  (headings, `<html lang>`, metadata) stay translated; cost: cookie sync on
  toggle (next navigation reflects it).
- **Language per channel on config JSONB vs new column**: zero migration,
  consistent with existing `config.chatId`.
- **Summary per-language grouping**: one HTTP message per distinct language per
  user (≤2), still best-effort.

## Rollback

- Dark mode: remove toggle mount + revert `dark:` classes (mechanical).
- UI i18n: remove provider + switches; keys unused → tree-shaken.
- Notification language: default `en` keeps old behavior when unset; revert
  config reads → hardcoded English. No schema/migration to undo.

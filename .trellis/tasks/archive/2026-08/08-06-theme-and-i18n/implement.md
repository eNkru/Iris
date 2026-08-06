# Dark/light mode + multi-language (en/zh) — Implement

## Checklist

### Part A — Dark mode
1. Mount `<ThemeToggle />` in `apps/web/components/app-nav.tsx` (with the
   email + sign-out cluster).
2. Add `dark:` variants to: `app-nav.tsx`, `product-list.tsx`,
   `add-product-form.tsx`, `channels-section.tsx`, `admin-settings-section.tsx`,
   `user-settings-section.tsx`, `product-edit-form.tsx`, `price-chart.tsx`,
   `auth-gate.tsx`, `telegram-help-tooltip.tsx`, `login/page.tsx`,
   `settings/page.tsx`, `products/[id]/page.tsx`, and any login/detail
   components they render. Use `ui.tsx` palette conventions.
3. Grep audit: `rg "text-slate-|bg-slate-|border-slate-"` in `apps/web` for
   surfaces still missing `dark:`.

### Part B — UI i18n
4. `apps/web/lib/i18n.ts`: `type Lang`, typed `dictionaries` (en/zh), `t()`
   with `{n}` interpolation, exported `DictKey` union.
5. `apps/web/lib/i18n.tsx`: `LanguageProvider` + `useI18n()` (localStorage
   `iris.lang`, default `en`, `mounted` SSR guard, sets `html.lang`, writes
   `iris.lang` cookie for server components).
6. `apps/web/components/language-toggle.tsx`: en/中文 `SegmentedControl`.
   Mount in `app-nav.tsx` next to `ThemeToggle`. Wire `LanguageProvider` in
   `providers.tsx`.
7. Translate all client UI strings via `useI18n().t`: app-nav, add-product-form,
   product-list (incl. send-summary + transient copy), channels-section,
   admin/user settings, product-edit-form, price-chart labels/aria,
   auth-gate, telegram-help-tooltip steps, login + its form.
8. Server components: `getLang()` helper (Next `cookies()`); `layout.tsx`
   `<html lang>` + metadata from cookie; translate `page.tsx`,
   `settings/page.tsx`, `login/page.tsx`, `products/[id]/page.tsx` headings.

### Part C — Notification language
9. `packages/prices/src/notifications/format.ts`: add `lang` param to
   `formatPriceAlertMessage`; localize prose/emoji lines via a small
   `en`/`zh` message map in `format.ts` (or `summary.ts` shared module).
10. `packages/prices/src/notifications/summary.ts`: `lang` param on
    `formatProductSummaryMessage` + `formatRelativeTime`; `sendProductSummary`
    groups channels by `config.language`, builds per-language text, sends each.
11. `telegram.ts` `telegramChannel.send`: read `config.language`, pass to
    `formatPriceAlertMessage`.
12. Channels API: `createChannel`/`updateChannel` schemas accept optional
    `language` (validate with `languageZodSchema`), persist to `config.language`;
    list output includes it.
13. `apps/web/hooks/use-channels.ts`: pass `language` in create/update.
14. `channels-section.tsx`: language SegmentedControl on add form; show + allow
    changing language per channel row.

## Validation commands

```bash
pnpm --filter @iris/prices typecheck
pnpm --filter @iris/api typecheck
pnpm --filter @iris/web typecheck
pnpm lint
pnpm build
```

## Risky files / rollback points

- `apps/web/app/layout.tsx`, `providers.tsx` — provider order + FOUC script;
  easy to revert.
- `packages/prices/src/notifications/format.ts` + `summary.ts` — signature
  changes to formatters; keep `lang` optional-with-default `en` so old callers
  behave identically.
- `packages/api/src/modules/channels/*` — schema additions backward compatible.
- UI string extraction — largest mechanical surface; per-component, easy to
  revert.

## Review gates

- PRD AC-Theme / AC-UI / AC-N1..N3 satisfied.
- `pnpm lint` + all typechecks + `pnpm build` pass with 0 errors.
- Manual smoke: dark mode on every page (no white flash, no unreadable text);
  zh switch translates nav/home/forms/settings/tooltips; server headings + html
  lang follow; channel with zh config → Chinese price alert & Chinese summary;
  mixed en/zh channels → two summaries.

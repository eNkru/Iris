# Professional UI polish + repo/issues links

## Goal

Make the Iris web UI feel more professional through a heavier visual redesign—clearer hierarchy, calmer surfaces, consistent chrome, stronger page structure—while keeping existing product workflows intact, and expose easy access to the public GitHub repository and Issues page via an app footer.

## Background

- App surface today: authenticated shell with `AppNav` + page `main`; pages are Home (`/`), Settings (`/settings`), Product detail (`/products/[id]`), and Login (`/login`).
- Styling is dependency-free Tailwind primitives in `apps/web/components/ui.tsx`. Palette is slate + class-based dark mode on `<html>`.
- Nav is brand “Iris” · Products · Settings | Language · Theme · email · Sign out. No footer; no GitHub / Issues links.
- i18n is a typed en/zh dictionary in `apps/web/lib/dictionary.ts`.
- Spec index mentions Radix, but the app has no Radix dependency—custom Tailwind only.
- Public repo: `https://github.com/eNkru/Iris`. Issues: `https://github.com/eNkru/Iris/issues`.
- `docs/screenshot.png` is brand illustration art (rainbow angel), not used in the app; brand decision excludes it from chrome.
- Layout is repeated per page: `min-h-screen` wrapper + `AppNav` + `main.mx-auto.max-w-5xl` (Home, Settings, Product detail). Login is a centered card with no nav/footer.

## Requirements

### R1 — Heavier visual redesign

- Rework visual hierarchy, density, page headers, empty/loading/status treatment, product rows, and shared chrome across Home, Settings, Product detail, and Login.
- Do **not** change product workflows (add / list / check / pause / delete / settings / login).
- Preserve dark mode, en/zh i18n, and existing accessibility basics (focus rings, alert roles, `aria-*` on segmented control).
- Stay on custom Tailwind primitives (no Radix/shadcn migration).
- Brand: restrained slate neutrals + optional subtle cool accent; text “Iris” and/or simple monogram—not the full rainbow angel illustration in chrome.
- Shell: richer app shell with sticky header, shared page-header pattern, flex column so the footer sits at the bottom; content width remains `max-w-5xl`.

### R2 — Repository and Issues entry points (footer only)

- App footer links:
  - Repository → `https://github.com/eNkru/Iris`
  - Issues → `https://github.com/eNkru/Iris/issues`
- Open in a new tab with `rel="noopener noreferrer"`.
- Labels i18n’d (en + zh).
- No GitHub/Issues controls in the top nav.
- Footer on all authenticated pages; login page should include a compact equivalent so unauthenticated users can also find the project/issues.

## Acceptance Criteria

- [ ] AC1: Home, Settings, Product detail, and Login look materially more professional: stronger page hierarchy, calmer surfaces, consistent chrome, improved empty/loading/status treatment.
- [ ] AC2: Footer (or login compact equivalent) links to `https://github.com/eNkru/Iris` in one click, new tab.
- [ ] AC3: Footer (or login compact equivalent) links to `https://github.com/eNkru/Iris/issues` in one click, new tab.
- [ ] AC4: New chrome strings exist in both `en` and `zh` and typecheck.
- [ ] AC5: Light and dark mode remain usable with acceptable contrast on redesigned surfaces.
- [ ] AC6: No product workflow regression (add product, list actions, settings, login).
- [ ] AC7: Shared primitives / shell components are the source of visual consistency—pages do not invent conflicting one-off styles.
- [ ] AC8: Brand is restrained slate + monogram/text only (no full rainbow angel in chrome).
- [ ] AC9: Top nav has no GitHub/Issues controls; those live in the footer (and login compact equivalent).
- [ ] AC10: Authenticated layout uses sticky header + bottom footer within a min-height flex column; content stays `max-w-5xl`.

## Out of scope

- Backend / API / Camoufox / scheduler changes.
- New product features (filters, bulk actions, analytics beyond visual polish).
- Migration to Radix/shadcn or another component library.
- Rewriting auth or i18n architecture.
- Changing business rules for price checks, alerts, or admin settings.
- Full colorful angel illustration as in-app chrome.
- GitHub/Issues links in the top nav.
- Widening content beyond `max-w-5xl`.

## Key decisions

| Decision | Choice | Date |
| --- | --- | --- |
| Polish ambition | Heavier redesign | 2026-08-07 |
| Brand mark / palette | Restrained slate + monogram; optional subtle cool accent; no angel art in chrome | 2026-08-07 |
| Link placement | Footer only (login gets compact equivalent) | 2026-08-07 |
| Layout shell | Richer shell, content `max-w-5xl` (sticky header, page header pattern, footer at bottom) | 2026-08-07 |
| Component library | Stay custom Tailwind | 2026-08-07 |

## Technical notes (non-design detail)

- Likely touchpoints: `app-nav.tsx`, new `app-footer.tsx` / `app-shell.tsx`, `ui.tsx`, `globals.css`, page files under `apps/web/app/`, `product-list.tsx`, `dictionary.ts`, possibly login.
- Constants for repo URLs should live in one place (e.g. `lib/links.ts` or footer module) to avoid drift.

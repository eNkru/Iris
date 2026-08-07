# Implement — Professional UI polish + repo/issues links

## Ordered checklist

1. **Tokens & primitives**
   - [ ] Add optional accent / surface tokens in `apps/web/app/globals.css` (light + `.dark`).
   - [ ] Polish `apps/web/components/ui.tsx` (Button variants, Card, Input focus, add `Badge`/`StatusPill`, consider `PageHeader` export or sibling component).
2. **Project link constants**
   - [ ] Add `apps/web/lib/project-links.ts` with `PROJECT_REPO_URL` and `PROJECT_ISSUES_URL`.
3. **i18n**
   - [ ] Add footer / brand / page-header related keys to `apps/web/lib/dictionary.ts` (`en` + `zh`).
4. **Shell chrome**
   - [ ] Create `apps/web/components/app-footer.tsx` (repo + issues external links).
   - [ ] Create `apps/web/components/app-shell.tsx` (sticky `AppNav` + flex main + `AppFooter`).
   - [ ] Refine `apps/web/components/app-nav.tsx` (monogram + wordmark, sticky-friendly styles, denser right cluster if needed—**no** GitHub links).
   - [ ] Optional monogram SVG component (inline, dependency-free).
5. **Adopt shell on authenticated pages**
   - [ ] `apps/web/app/page.tsx` (Home) → `AppShell` + `PageHeader` + calmer add form / list section.
   - [ ] `apps/web/app/settings/page.tsx` → `AppShell` + `PageHeader`.
   - [ ] `apps/web/app/products/[id]/page.tsx` → `AppShell` + improved header/meta (all loading/error branches too).
6. **Product list / forms polish**
   - [ ] `product-list.tsx`: status badge, row hierarchy, action grouping, empty state.
   - [ ] Light polish on `add-product-form.tsx` / detail edit if needed for consistency.
7. **Login**
   - [ ] `apps/web/app/login/page.tsx`: monogram brand treatment + compact repo/issues links (reuse footer link piece or footer component variant).
8. **Auth gate loading state**
   - [ ] Align `auth-gate.tsx` loading chrome with new surfaces if it looks orphaned.
9. **Validate**
   - [ ] Typecheck, lint, manual light/dark pass, footer link smoke.

## Validation commands

```bash
pnpm --filter @iris/web typecheck
pnpm --filter @iris/web lint
# optional full mono:
pnpm typecheck
```

Manual:

- Light + dark: Home, Settings, Product detail, Login.
- Footer: Repo → `https://github.com/eNkru/Iris`, Issues → `https://github.com/eNkru/Iris/issues`, both `target=_blank`.
- Smoke: sign-in page renders; product list actions still clickable; settings sections still save (no API change expected).

## Risky files / rollback points

| File | Risk | Rollback note |
| --- | --- | --- |
| `components/ui.tsx` | Global visual blast radius | Revert first if contrast/regressions spread |
| `components/app-shell.tsx` / page adoptions | Layout regressions | Adopt page-by-page; revert one page if needed |
| `lib/dictionary.ts` | Missing zh key = type error | Keep en/zh in same commit |
| `app/globals.css` | Dark mode FOUC/token mistakes | Tokens only; easy revert |

## Follow-up before `task.py start`

- [x] Product decisions locked (ambition, brand, placement, shell).
- [x] `prd.md` converged.
- [x] `design.md` + `implement.md` written.
- [ ] Curate `implement.jsonl` + `check.jsonl` with real spec entries.
- [ ] User explicitly approves this planning summary.

## Out of scope reminders for implementers

- No Radix/shadcn install.
- No workflow/API changes.
- No angel PNG in chrome.
- No GitHub links in nav.

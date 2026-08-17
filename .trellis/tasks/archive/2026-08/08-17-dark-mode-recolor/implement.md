# Dark-mode re-color to gold/amber — Implementation plan

## Ordered checklist

1. **`apps/web/src/index.css`** — replace the `:root` and `.dark` token blocks
   with the amber/stone values from `design.md` (token table). Add the new
   `--accent-strong` token to both blocks (light `#92400e`, dark `#fbbf24`).
   Keep the `@custom-variant dark` and chart-color comment header (update the
   header comment from "restrained slate + cool accent" to a gold/goddess note).

2. **`apps/web/index.html`** — body class: `bg-slate-50→bg-stone-50`,
   `text-slate-900→text-stone-900`, `selection:text-slate-900→…stone-900`,
   `dark:bg-slate-950→dark:bg-stone-950`, `dark:text-slate-100→…stone-100`,
   `dark:selection:text-slate-50→…stone-50`. Leave `selection:bg-[var(--accent-muted)]`.

3. **Mechanical neutral swap across components** — in each file below, replace
   every `slate-<n>` with `stone-<n>` (same number). Leave `red-*` and any
   `var(--accent*)` untouched.
   - `routes/home.tsx`, `routes/login.tsx`, `routes/product.tsx`, `routes/settings.tsx`
   - `components/ui.tsx`, `app-nav.tsx`, `language-toggle.tsx`, `app-footer.tsx`,
     `telegram-help-tooltip.tsx` (incl. `ring-slate-*` → `ring-stone-*`),
     `add-product-form.tsx`, `product-list.tsx`, `auth-gate.tsx`,
     `app-shell.tsx`, `theme-toggle.tsx`, `product-edit-form.tsx`,
     `admin-settings-section.tsx`, `channels-section.tsx`,
     `user-settings-section.tsx`, `price-chart.tsx`

4. **`--accent-strong` call-sites** (contrast fix):
   - `components/app-nav.tsx:49` — active state `text-[var(--accent)]` →
     `text-[var(--accent-strong)]`.
   - `components/ui.tsx:152` — amber Badge variant light side
     `text-[var(--accent)]` → `text-[var(--accent-strong)]` (keep the
     `dark:text-[var(--accent)]` half as-is).

5. **`components/brand-mark.tsx`** — logo redesign: replace the eye/iris-ring SVG
   (circles + radial ticks) with the geometric rainbow-arc mark from
   `design.md` (5 half-circle bands, `-400` rainbow, radii 13/11/9/7/5,
   `stroke-width="2"`, baseline center cx=16 cy=27) + gold sun circle at
   (16,12) `fill="#fbbf24"`. Keep the `BrandMark` API (`className`/`title`/
   `decorative`/`role`/`aria-*`/`<title>`) exactly. Colors are static attrs,
   not `var(--accent)`.

6. **`apps/web/public/icon.svg`** — favicon parity: rewrite to the warm
   `stone-950 #0c0a09` rounded square (`rx="14"`, viewBox 0 0 64 64) + the
   same rainbow arc scaled to 64 but **3 bands** (red-400/amber-400/sky-400)
   at `stroke-width="6"` for 16px legibility + gold sun. Keep `index.html`
   `<link rel="icon" href="/icon.svg" …>` unchanged.

7. **Visual sanity sweep (manual, both themes)** — toggle dark/light, check:
   dashboard, product detail (chart line/dot/axis/grid), settings (3 sections),
   login (logo at h-9 w-9), app-nav (logo at h-7 w-7 + active pill), Button
   (primary + ghost + destructive), SegmentedControl active, Badge amber,
   Spinner, focus rings, brand mark crispness at 28px, favicon in a browser
   tab, selection highlight. Confirm no blue cast, gold reads premium, rainbow
   arc reads as the goddess mark (not a generic sunset).

## Validation commands

```bash
pnpm --filter @iris/web lint
pnpm --filter @iris/web typecheck
pnpm --filter @iris/web build
pnpm --filter @iris/web server:build
```

## Guardrail grep checks (must return empty / only-expected)

```bash
# No slate-* left in recolored web sources (should be empty):
grep -rn "slate-" apps/web/src apps/web/index.html || echo OK_NONE

# No indigo/blue hex left in index.css tokens (should be empty):
grep -nE "#4f46e5|#4338ca|#6366f1|#818cf8|#a5b4fc|#e0e7ff|#1e1b4b|#0f172a|#020617|#1e293b" apps/web/src/index.css || echo OK_NONE

# Red semantic palette must still be present (destructive button) — expect matches:
grep -rn "text-red\|bg-red\|border-red" apps/web/src/components/ui.tsx
```

## Risky points / rollback

- **Active-nav / Badge contrast in light mode** is the one real accessibility
  risk. `--accent-strong` amber-800 (`#92400e`) on amber-100 (`#fef3c7`) ≈ 6.5:1
  (passes AA). If the bronze looks too dark, amber-700 (`#b45309`) is brighter
  but ≈ 4.3:1 — do NOT drop below amber-700 without re-checking AA.
- **Brand-mark rainbow arc at small size** — verify the 5 bands don't blur at
  `h-7 w-7` (28px). Fallback: drop to 4 bands (remove sky-400 or red-400).
  Favicon uses 3 bands precisely to stay legible at 16px.
- **Rainbow reading as "sunset/weather app"** — the gold sun + muted `-400`
  palette + price-arc resonance should anchor it as the Iris mark; if still off
  after a visual check, fallback motif is the "eye + rainbow hybrid."
- **Rollback**: `git checkout -- apps/web/` reverts everything (one feature's
  worth of edits, no migration artifacts).

## Follow-up before `task.py start`

- Confirm this `implement.md` checklist + `design.md` token table match the
  approved planning summary (no drift).
- `implement.jsonl` / `check.jsonl` are seed-only for this inline workflow;
  Phase 2 loads context via `trellis-before-dev`, so no JSONL gating needed.

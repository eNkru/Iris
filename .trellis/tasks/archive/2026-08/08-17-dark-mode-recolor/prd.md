# Re-color dark mode away from blue (Iris goddess direction)

## Goal & user value

Re-color the Iris web app so it no longer reads "blueish," grounding the
palette in the brand's actual namesake — Iris (Ἶρις), the ancient Greek
goddess of the **rainbow** and divine **messenger** (depicted with **golden
wings**) — rather than the current arbitrary "restrained slate + cool accent"
indigo theme. The product itself is a messenger (it watches prices and carries
you alerts), so the goddess framing fits the product, not just the name. The
re-color must stay professional and restrained, not garish.

## Background — why dark mode reads blue today

Two compounding layers (both in `apps/web/src/index.css`, from the archived
`08-06-theme-and-i18n` task):

1. **Accent is indigo (blue-purple).** Dark `--accent: #818cf8` (indigo-400),
   `--accent-hover: #a5b4fc`; chart line/dot are indigo too. The CSS header
   literally says "restrained slate + cool accent."
2. **Neutral surfaces are slate (blue undertone).** Dark `--surface: #0f172a`,
   `--surface-muted: #020617` (slate-950 family); slate is blue-gray by design.

The accent flows through centralized CSS variables (`--accent*`, `--chart-*`),
so swapping the accent is ~6 token lines and re-themes Button, Spinner,
SegmentedControl, nav active state, chart, links, focus rings. (The redesigned
rainbow logo uses static brand colors, not `var(--accent)`.) The neutral
palette is used as raw Tailwind utilities across ~21 source files (81
`slate-<n>` occurrences); re-warming surfaces is broader but mechanical.

## Key decisions (all resolved)

- **D1. Direction: gold/amber accent + warm neutrals.** References Iris's
  golden wings + price/value/money semantics; warmest, furthest from blue.
- **D2. Scope: both light and dark mode** — same gold hue family in both;
  light uses deeper amber (`#d97706`) for legibility on white so the brand
  accent stays consistent across theme toggle.
- **D3. Logo redesigned to a rainbow arc (full redesign, supersedes tick-tint).**
  Replace the eye/iris-ring monogram with a geometric 5-band rainbow arc + gold
  sun, in the muted `-400` sequence (the goddess = the rainbow; the arc echoes
  a rising price curve). Applies to `brand-mark.tsx` (app-nav, login) and the
  `public/icon.svg` favicon (3-band variant for 16px). This reverses the prior
  `08-07-ui-professional-polish` "no rainbow/angel in chrome" decision, opting
  for distinctive goddess identity over SaaS restraint.
- **D4. New `--accent-strong` token** — amber is lighter than indigo, so a
  single `--accent` can't serve both button-bg (wants bright gold) and
  text-on-tint (active nav / amber Badge, needs AA contrast). Add
  `--accent-strong` (light `#92400e` amber-800; dark `=` `--accent`) for the
  two text-on-tint call-sites only. See `design.md` for the contrast math.

## Requirements

- R1. Dark mode no longer reads blueish: accent is warm amber/gold and surfaces
  are warm-neutral (stone family), not slate. (D1)
- R2. Accent re-color is centralized through existing CSS variables so every
  accent consumer re-themes without per-component hue edits; only two
  call-sites adopt the new `--accent-strong`. (D4)
- R3. Neutral surface/border/text Tailwind utilities migrate slate→stone (1:1,
  same numeric scale) across all components in both light and dark. (D2)
- R4. Light mode is coherent with the same gold hue family (gold accent + warm
  neutrals), with a deeper amber shade for button/link legibility on white. (D2)
- R5. Chart stays legible: `--chart-line`/`--chart-dot` use gold; `--chart-grid`/
  `--chart-axis` use warm-neutral mid tones. (D1)
- R6. Logo is redesigned to a geometric rainbow-arc mark (5 bands + gold sun),
  replacing the eye monogram in `brand-mark.tsx`; the `BrandMark` component API
  (`className`/`title`/`decorative`/`role`/`aria-*`/`<title>`) is unchanged. The
  `public/icon.svg` favicon is redesigned to match (3-band variant for 16px).
  Rainbow colors are static brand attrs (not theme vars). (D3)
- R7. No behavior changes: theme persistence, OS-follow, i18n, toggle logic
  (`theme.tsx`), and SSR mounted-guard are unchanged; only color tokens + raw
  color utilities change.
- R8. WCAG AA contrast preserved on text: `--accent-fg` (dark text on gold
  buttons) and `--accent-strong` (text on amber-muted tint) meet ≥4.5:1 for
  normal text. Semantic red (destructive button) is untouched.

## Acceptance criteria

- [ ] AC1. Dark-mode `--accent` resolves to amber/gold (not indigo) and
  `--surface`/`--surface-muted` resolve to warm-neutral stone (not slate) in
  the `.dark` block of `index.css`.
- [ ] AC2. No indigo/blue hex remains in any `var(--accent*)` / `var(--chart-*)`
  token in `index.css` (`:root` or `.dark`).
- [ ] AC3. No `slate-<n>` utilities remain in `apps/web/src/**` or
  `apps/web/index.html` (grep returns nothing).
- [ ] AC4. Semantic red (`text-red-*`/`bg-red-*`/`border-red-*` in `ui.tsx`
  destructive button) is still present and unchanged.
- [ ] AC5. `--accent-strong` exists in both `:root` and `.dark`; the two
  call-sites (`app-nav.tsx` active, `ui.tsx` amber Badge light) use it.
- [ ] AC6. `brand-mark.tsx` renders the rainbow-arc logo (5 bands + gold sun,
  not the eye monogram); `BrandMark` API + a11y attrs unchanged. `public/icon.svg`
  renders the matching 3-band favicon on a warm stone-950 rounded square.
- [ ] AC7. `pnpm --filter @iris/web lint && pnpm --filter @iris/web typecheck
  && pnpm --filter @iris/web build && pnpm --filter @iris/web server:build`
  all pass.
- [ ] AC8. Manual check in both themes: dashboard, product detail (chart),
  settings, login (logo at h-9 w-9), app-nav (logo at h-7 w-7 + active pill),
  Button variants, SegmentedControl, Badge, Spinner, focus rings, brand mark
  crispness at 28px, favicon in a browser tab, selection — no blue cast, gold
  reads premium, rainbow arc reads as the Iris goddess mark, text legible.

## Out of scope

- No backend changes (notification text, etc.).
- No i18n / theme-persistence logic changes (`theme.tsx` behavior unchanged).
- No new runtime dependencies (stays dependency-free icon/color approach).
- No theme machinery changes (toggle, OS-follow, FOUC script, SSR guard).

## Open questions

- None blocking. (All resolved — see Key Decisions; design.md + implement.md
  hold the token table, migration file list, contrast math, and checklist.)

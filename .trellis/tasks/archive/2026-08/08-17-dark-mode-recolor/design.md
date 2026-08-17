# Dark-mode re-color to gold/amber — Design

## Architecture / boundaries

Pure-frontend, styling-only. No behavior, no API, no persistence change.
Three surfaces of change:

```
1. index.css :root + .dark      → swap accent tokens indigo→amber,
                                   swap neutral tokens slate→stone, add
                                   one new --accent-strong token
2. ~21 components + index.html  → mechanical slate-* → stone-* swap on raw
                                   Tailwind utilities (surfaces/borders/text);
                                   two call-sites switch text-[var(--accent)]
                                   → text-[var(--accent-strong)] for contrast
3. brand-mark.tsx + icon.svg    → REDESIGN the logo from the eye/iris-ring
                                   monogram to a geometric rainbow arc (the
                                   goddess = the rainbow) + small gold sun.
                                   Reverses the prior "no rainbow/angel in
                                   chrome" brand decision. Applies to app-nav,
                                   login, and the favicon.
```

Theme machinery is untouched: `theme.tsx`, `theme-toggle.tsx` logic,
`ThemeProvider`, localStorage `iris.theme`, OS-follow, i18n — all unchanged.

## Final design tokens (`apps/web/src/index.css`)

### `:root` (light)
| Token | Old (indigo) | New (amber/gold) | Role |
|---|---|---|---|
| `--accent` | `#4f46e5` | `#f59e0b` (amber-500) | button bg, spinner, chart line/dot, link hover, focus ring |
| `--accent-hover` | `#4338ca` | `#d97706` (amber-600) | button hover |
| `--accent-fg` | `#ffffff` | `#1c1917` (stone-900) | text on bright-gold buttons (dark text on gold = high contrast) |
| `--accent-strong` | — (new) | `#92400e` (amber-800) | text on `--accent-muted` tint (active nav, amber Badge) — see contrast note |
| `--accent-muted` | `#eef2ff` | `#fef3c7` (amber-100) | active-nav / selection bg tint |
| `--accent-ring` | `#6366f1` | `#f59e0b` (amber-500) | focus ring |
| `--surface` | `#ffffff` | `#ffffff` | page surface |
| `--surface-muted` | `#f8fafc` | `#fafaf9` (stone-50) | muted surface |
| `--border-subtle` | `#e2e8f0` | `#e7e5e4` (stone-200) | subtle border / chart grid |
| `--chart-grid` | `#e2e8f0` | `#e7e5e4` (stone-200) | chart grid |
| `--chart-axis` | `#94a3b8` | `#a8a29e` (stone-400) | chart axis ticks |
| `--chart-line` | `#4f46e5` | `#d97706` (amber-600) | chart line (deeper for white-bg legibility) |
| `--chart-dot` | `#4f46e5` | `#d97706` (amber-600) | chart dot |

### `.dark`
| Token | Old (indigo) | New (amber/gold) | Role |
|---|---|---|---|
| `--accent` | `#818cf8` | `#fbbf24` (amber-400) | bright gold that pops on dark |
| `--accent-hover` | `#a5b4fc` | `#f59e0b` (amber-500) | button hover |
| `--accent-fg` | `#0f172a` | `#1c1917` (stone-900) | dark text on gold buttons |
| `--accent-strong` | — (new) | `#fbbf24` (= `--accent`) | dark mode: `--accent` already passes on amber-950 bg, so equal |
| `--accent-muted` | `#1e1b4b` | `#422006` (amber-950) | deep gold-brown tint for active nav / selection |
| `--accent-ring` | `#818cf8` | `#fbbf24` (amber-400) | focus ring |
| `--surface` | `#0f172a` | `#1c1917` (stone-900) | warm near-black surface |
| `--surface-muted` | `#020617` | `#0c0a09` (stone-950) | warm near-black muted |
| `--border-subtle` | `#1e293b` | `#292524` (stone-800) | border / chart grid |
| `--chart-grid` | `#1e293b` | `#292524` (stone-800) | chart grid |
| `--chart-axis` | `#64748b` | `#78716c` (stone-500) | chart axis ticks |
| `--chart-line` | `#a5b4fc` | `#fbbf24` (amber-400) | bright gold line on dark |
| `--chart-dot` | `#e0e7ff` | `#fde68a` (amber-200) | gold dot |

## Key design constraint: why a new `--accent-strong` token

The current indigo scheme uses one `--accent` variable for both (a) button-bg
with white text and (b) text-on-tint for the active nav / amber Badge, because
indigo-600 (`#4f46e5`) is dark enough to do both at ~7.9:1 contrast.

Amber/gold is lighter, so it **cannot** serve both:
- **Button** wants *bright* gold (amber-500/400) so it reads "gold, premium";
  dark text (`--accent-fg` stone-900) on amber-500 ≈ 7.6:1 ✓.
- **Active-nav / Badge text** sits on a pale `--accent-muted` (amber-100) bg;
  amber-500 text on amber-100 ≈ 2:1 ✗ (fails WCAG AA).

Resolution: add `--accent-strong` (amber-800 light / =`--accent` dark) for the
text-on-tint call-sites only. Two call-sites change:
`app-nav.tsx:49` active state, `ui.tsx:152` amber Badge variant (light side).
Dark mode keeps `--accent` because amber-400 on amber-950 ≈ 8.6:1 ✓.

Contrast targets (WCAG AA): normal text ≥ 4.5:1, large/UI ≥ 3:1.

## Neutral palette migration: slate → stone (1:1)

Both palettes share Tailwind's 11-step scale, so the swap is numeric-identity:
`slate-50→stone-50`, …, `slate-950→stone-950`. Stone is warm-gray (no blue
undertone), which is what removes the blue cast from surfaces.

**Guardrail — do NOT swap semantic red:** `border-red-200`, `text-red-700`,
`dark:text-red-400`, `dark:bg-red-950` (destructive `GhostButton` in `ui.tsx`)
and any other `red-*` are the danger/semantic palette, not neutral. Leave them.
Only `slate-*` → `stone-*`.

**Guardrail — selection text stays neutral:** `index.html` body
`selection:text-slate-900 … dark:selection:text-slate-50` already uses neutral
text on `--accent-muted`; swap to `selection:text-stone-900 …
dark:selection:text-stone-50` (no contrast issue; dark-on-pale-amber and
light-on-deep-amber both pass).

## Files touched (neutral migration)

`apps/web/index.html`, `src/routes/{home,login,product,settings}.tsx`,
`src/components/{ui,app-nav,language-toggle,app-footer,telegram-help-tooltip,
add-product-form,product-list,auth-gate,app-shell,theme-toggle,product-edit-form,
admin-settings-section,channels-section,user-settings-section,price-chart}.tsx`
+ `brand-mark.tsx` + `public/icon.svg` (logo redesign) + `index.css` (tokens) + the two
`--accent-strong` call-site edits in `app-nav.tsx` and `ui.tsx`.

## Logo redesign — rainbow arc (`brand-mark.tsx` + `public/icon.svg`)

Replaces the prior "rainbow-tick flourish on the eye" plan (D3) with a full
logo redesign. Reverses the archived `08-07-ui-professional-polish` decision
("no rainbow/angel in chrome — professional SaaS tone over distinctive brand
personality"): the user now opts for distinctive, goddess-grounded identity.

### Motif

A **geometric rainbow arc** — 5 concentric half-circle bands rising from a
shared baseline, in the muted Tailwind `-400` rainbow sequence (outer→inner):

```
red-400 #f87171 → orange-400 #fb923c → amber-400 #fbbf24 (gold)
→ emerald-400 #34d399 → sky-400 #38bdf8
```

A small **gold sun** (filled `amber-400` circle) floats at the arc apex — the
"rising sun / price peak." The arc form itself doubles as a rising curve,
resonating with the price-tracker's chart line (Iris watches prices rise).

A rainbow inherently includes a blue band — this is correct (the goddess's
rainbow), and is *not* the same as the blueish UI we removed. The UI chrome
stays gold/stone; multicolor lives only in the logo.

### Geometry (viewBox 0 0 32 32, in-app `BrandMark`)

- Baseline center: `cx=16, cy=27` (near the bottom).
- 5 arcs (upper semicircles, `M x1 y1 A r r 0 0 1 x2 y2`), radii
  `13, 11, 9, 7, 5` (outer→inner), `stroke-width="2"`, `fill="none"`,
  `stroke-linecap="round"`.
- Gold sun: `<circle cx="16" cy="12" r="1.6" fill="#fbbf24"/>` (just above the
  outer arc apex).
- Colors are **static stroke/fill attrs** (not CSS vars) — a rainbow is a
  fixed brand identity, not theme-dependent. This is a deliberate change from
  the old `var(--accent)`-drawn mark (which themed with the accent).
- `BrandMark` API is unchanged: `{ className, title, decorative }`, same
  `role`/`aria-*`/`<title>` behavior. Only the SVG children change.
- Used at `h-7 w-7` (nav) and `h-9 w-9` (login) — verify the 5 bands don't blur
  at 28px; if they do, drop to 4 bands (remove sky or red).

### Favicon parity (`apps/web/public/icon.svg`)

- Keep the warm **rounded-square background** `stone-950` `#0c0a09`
  (`rx="14"`, `viewBox 0 0 64 64`) for contrast at 16px regardless of browser
  tab background.
- Render the **same rainbow arc** (scaled to 64), but use **3 bands** (red-400,
  amber-400, sky-400) at `stroke-width="6"` for 16px legibility, plus the gold
  sun. Referenced unchanged as `/icon.svg` in `index.html`.
- A dark rounded-square favicon reads on both light and dark OS tabs.

### Where it appears

- `app-nav.tsx` (h-7 w-7, next to "Iris" wordmark) — `decorative` (wordmark
  already names the brand).
- `routes/login.tsx` (h-9 w-9, hero) — `decorative`.
- Browser tab via `public/icon.svg`.

The wordmark text "Iris" is unchanged (only its color migrates slate→stone
with the neutral pass).

## Compatibility / rollback

- No data, no API, no persistence change — zero migration risk.
- Full rollback = `git checkout` on `apps/web/` (one commit's worth of edits).
- No new dependencies. Tailwind v4 includes the `stone`/`amber` palettes.
- SSR-safe: tokens are static CSS; the rainbow arc bands are static SVG attrs;
  no hydration impact (`theme-toggle.tsx` mounted-guard unchanged).

## Trade-offs

- **Gold can read "crypto/warning" if over-saturated.** Mitigated by amber-500
  (not pure yellow), sparing use (accent only), warm-stone neutrals grounding it.
- **Active-nav uses a deep bronze (`amber-800`) text** in light mode for AA
  contrast — slightly less "bright gold" than indigo allowed, but on-brand as
  the bronze end of gold and only on the active pill.
- **Bigger departure from current identity** than a hue tweak — intended.
- **Logo redesign reverses a documented brand decision.** The prior
  `08-07-ui-professional-polish` task chose the eye monogram *over* the
  rainbow/angel form for "professional SaaS tone." The user now opts for
  distinctive goddess identity. Risk: a rainbow mark can read "weather/sunset
  app" if poorly executed; mitigated by the gold sun + price-arc resonance +
  muted `-400` palette. If the rainbow feels off-brand after a visual check,
  the fallback is the "eye + rainbow hybrid" motif (keep the watcher eye, tint
  its ticks) — smaller departure.
- **Rainbow logo on gold UI** reintroduces multicolor into the brand mark only.
  This is deliberate (the goddess = rainbow) and does not contradict the
  dark-mode recolor (which removed blue from *UI surfaces/accent*, not a ban on
  blue anywhere).

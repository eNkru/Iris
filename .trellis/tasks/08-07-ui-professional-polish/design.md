# Design — Professional UI polish + repo/issues links

## Architecture / boundaries

Frontend-only visual redesign inside `apps/web`. No API, auth, or pipeline changes.

### New shared shell

Introduce a thin authenticated shell so every protected page stops re-implementing the same chrome:

```
AppShell
  ├─ AppNav (sticky)
  ├─ main (flex-1, max-w-5xl)
  │    └─ optional PageHeader + page body
  └─ AppFooter
```

- `AppShell` owns the `min-h-screen flex flex-col` layout, sticky header, and footer placement.
- Pages pass children into `AppShell` (still wrapped by existing `AuthGate` where required).
- Login stays outside full `AppShell` (no nav/sign-out), but reuses brand monogram + a compact footer strip for repo/issues.

### Shared primitives (extend, don’t replace)

Keep dependency-free Tailwind in `components/ui.tsx`. Extend rather than introduce a library:

| Primitive | Change |
| --- | --- |
| Button / ButtonSecondary / ButtonDanger | Slightly tighter radius/shadow/hover; optional cool-accent primary if accent is introduced via CSS variables |
| Card | Softer border, slightly larger radius, consistent padding scale |
| Input / Label | Align focus ring with accent token if present |
| Spinner / ErrorBox / SuccessBox | Keep semantics; polish spacing/contrast |
| **New: Badge / StatusPill** | Active / Paused / needs-attention chips used by product list + detail |
| **New: PageHeader** | Title + description + optional actions slot for consistent page tops |
| **New: ExternalLink / icon link** | Shared new-tab link styling for footer |

Optional subtle cool accent (indigo/sky) as CSS variables in `globals.css` (`--accent`, `--accent-fg`) so light/dark both work without scattering raw color classes.

### Brand

- Wordmark: “Iris” text.
- Monogram: simple geometric mark (e.g. circular “I” or iris-ring SVG, inline, monochrome / accent-aware)—not the rainbow angel PNG.
- Login hero uses monogram + wordmark + refined tagline spacing.

### Footer (R2)

`AppFooter`:

- Content width matches main (`max-w-5xl`).
- Left: short product line or © / project name.
- Right (or center-right): **Repository** and **Issues** external links (text + optional GitHub-style icon, SVG inline to stay dependency-free).
- URLs centralized:

```ts
// apps/web/lib/project-links.ts
export const PROJECT_REPO_URL = "https://github.com/eNkru/Iris";
export const PROJECT_ISSUES_URL = "https://github.com/eNkru/Iris/issues";
```

- `target="_blank"` + `rel="noopener noreferrer"`.
- i18n keys e.g. `footer.repo`, `footer.issues`, `footer.tagline` (en + zh).

Login compact equivalent: same two links under the login card or a slim bottom bar—same URL constants and i18n keys.

### Page-level visual redesign (workflows unchanged)

**Home**

- `PageHeader` for title/intro.
- Add-product form in a calmer card or well-defined panel.
- Product list: clearer row hierarchy (name primary, URL secondary, price prominent); status badge; action buttons grouped (primary check vs secondary pause vs danger delete); improved empty state.

**Settings**

- `PageHeader` with signed-in subtitle.
- Section cards with clearer section titles and internal spacing rhythm.

**Product detail**

- `PageHeader`-like title block (back link, name, URL, price/status meta).
- History + settings cards with consistent section headers.
- Status / check feedback uses shared badges/colors.

**Login**

- Centered card with monogram brand, improved vertical rhythm, footer links.

### i18n

All new chrome strings in `dictionary.ts` en + zh (`DictKey` enforces parity). Theme/language toggle aria labels already partially i18n’d—align any hard-coded English left in toggles if touched.

### Accessibility

- Sticky header must not trap focus; keep visible focus rings.
- Footer links are real `<a>` elements with discernible names.
- Status badges are text (not color-only).
- Contrast: verify accent + slate pairs in light and dark.

## Data flow / contracts

No new APIs. Presentational only. External navigation is plain anchors.

## Compatibility

- No DB/migration impact.
- No env var changes.
- Existing hooks/pages keep the same props and mutation flows.

## Trade-offs

| Choice | Why | Cost |
| --- | --- | --- |
| Custom Tailwind shell vs Radix/shadcn | Matches current codebase, zero new deps | Manual a11y for any new interactive patterns |
| Sticky header + footer shell | More “app-like”, footer always reachable | Touch every authenticated page to adopt `AppShell` |
| Footer-only project links | Clean nav | Slightly less discoverable than nav icons |
| Monogram not angel art | Professional SaaS tone | Less distinctive brand personality |
| Optional cool accent via CSS vars | Easy theming without rewriting every class | Need discipline to use tokens |

## Rollout / rollback

- Single frontend PR; no staged backend.
- Rollback = revert the UI commit(s); no data migration.
- Risk files: `ui.tsx`, `app-nav.tsx`, page shells, `dictionary.ts`, `globals.css`. If mid-work is unstable, keep `AppShell` adoption per-page so partial reverts are possible.

## Validation approach

- Visual check light + dark on Home / Settings / Detail / Login (manual or `/run` if available).
- Click footer repo + issues → correct URLs, new tab.
- `pnpm --filter @iris/web typecheck` (dictionary key parity).
- Smoke: add product form still submits; list actions still fire; login form still sends magic link (no backend change expected).

# Design — Frontend UX/UI review fixes

All changes live in `apps/web`. No changes to `packages/*`, no new dependencies, no API contract changes. The hand-rolled `components/ui.tsx` stays dependency-free (no clsx/tailwind-merge) — plain template strings only.

## 1. Shared primitives (`components/ui.tsx`)

### 1a. `formatRelativeTime(date: Date | null): string` (R6)
- Buckets vs `Date.now()`: `< 60s` → `"just now"`; `< 60m` → `"Nm ago"`; `< 24h` → `"Nh ago"`; `< 7d` → `"Nd ago"`; older → `date.toLocaleDateString()`.
- `null` → `"—"` (same as `formatDateTime` today).
- Pure string function; the `title` attribute with the full timestamp is added at call sites (via existing `formatDateTime`).

### 1b. `formatPrice` hardening (R9)
```ts
export function formatPrice(price: number, currency: string | null): string {
  const amount = price.toFixed(2);
  if (!currency) return amount;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(price);
  } catch {
    return `${currency} ${amount}`; // invalid/unknown code fallback (RangeError guard)
  }
}
```
- 3-letter AI-extracted codes (e.g. `"NZD"`) are valid ISO-4217 codes and render as `NZ$` / locale form. The catch covers bogus codes without throwing.

### 1c. Focus rings (R12)
- Add to `Button`, `ButtonSecondary`, `ButtonDanger` class strings: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-1`. Same treatment for nav links in `app-nav.tsx`.

### 1d. `SegmentedControl` (R10)
New dependency-free primitive:
```tsx
export function SegmentedControl<T extends string>({
  options, value, onChange, label,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
})
```
- Renders `<div role="group" aria-label={label}>` of `<button type="button" aria-pressed={active}>` items: container `inline-flex rounded-md border border-slate-300 bg-white p-0.5`; active item `bg-slate-900 text-white`, inactive `text-slate-600 hover:text-slate-900`; shared `rounded-[4px] px-3 py-1 text-sm font-medium transition-colors focus-visible:...`.

## 2. Product list (`components/product-list.tsx`)

### 2a. Per-row pending state (R1)
Replace shared `isPending` gating with local state:
```ts
const [pendingAction, setPendingAction] = useState<{ id: string; kind: "check" | "toggle" } | null>(null);
```
- "Check now": `setPendingAction({ id, kind: "check" })`, then `checkNow.mutate(..., { onSettled: () => setPendingAction(null) })`. Button disabled and shows spinner only when `pendingAction` matches that row+kind.
- Same for Pause/Resume with `kind: "toggle"`. Delete keeps its existing `deletingId` pattern.
- `onSettled` (not `onError`/`onSuccess`) guarantees re-enable on failure too. Errors still surface via `setActionError` in `onError`.

### 2b. Paused badge (R4)
- When `!product.active`: small `<span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500">Paused</span>` next to the name, and muted name/price text (`text-slate-400` instead of `text-slate-900`).

### 2c. Inline delete confirm (R5)
- Single `confirmingDeleteId: string | null` state replaces `window.confirm`.
- Row in confirm mode shows `<ButtonDanger>Confirm delete</ButtonDanger> <ButtonSecondary>Cancel</ButtonSecondary>` in place of the Delete button; Cancel sets `confirmingDeleteId(null)`.
- Clicking Delete on a different row moves the confirm state to that row (single `confirmingDeleteId` handles this naturally).

### 2d. Relative time + auto-refresh (R6)
- Replace `last checked {formatDateTime(...)}` with `checked {formatRelativeTime(...)}` wrapped in `<span title={formatDateTime(...)}>`.
- In `hooks/use-products.ts`, `useProducts()` gains `refetchInterval: 30_000` (query option). This only affects components mounting that query (home page list). Detail page `useProduct` unchanged.

## 3. Product detail page (`app/products/[id]/page.tsx`)

### 3a. Check-now error surface (R2)
```tsx
const [checkError, setCheckError] = useState<string | null>(null);
// onClick: setCheckError(null); checkNow.mutate({ id }, { onError: (err) => setCheckError(err.message) });
// render: {checkError ? <ErrorBox message={checkError} /> : null}
```
- Stale result text (`checkNow.data`) is cleared alongside (`checkNow.reset()` in onClick) so a new run doesn't show the previous run's result.

### 3b. Title fallback (R13)
- `product.name ?? product.url` in the `h1`, with `truncate` class and `title={product.url}`.

### 3c. Relative time (R6)
- "Last checked" line uses `formatRelativeTime` + `title` with the full timestamp, same as the list.

## 4. Settings forms — transient "Saved." (R8)

Shared pattern (applied to `product-edit-form.tsx`, `user-settings-section.tsx`, `admin-settings-section.tsx`). No shared hook needed for three call sites, but a tiny local pattern keeps them consistent:
```ts
const [savedAt, setSavedAt] = useState<number | null>(null);
// on mutateAsync success: setSavedAt(Date.now())
// any field onChange: setSavedAt(null)
// effect: if savedAt != null, const t = setTimeout(() => setSavedAt(null), 3000); return cleanup
// render: {savedAt != null ? <p ...>Saved.</p> : null}
```
- Replaces `updateX.isSuccess` rendering. Field edits reset it immediately, satisfying "clears on next edit or ~3s".

### Alert-rules warning (R3, `product-edit-form.tsx`)
- Derived: `const silentConfig = !anyChange && risePct === "" && fallPct === "" && riseAbs === "" && fallAbs === "";`
- Renders inside the alert-rules box (amber notice, not ErrorBox): `"No alert rules are active — price changes for this product won't send notifications."` Saving unchanged.
- Fix the misleading foot text: replace `"Optional. Leave blank to only alert on any change."` with accurate copy, e.g. `"Thresholds are direction-specific. Blank thresholds + \"any change\" off = no alerts."`

## 5. Channels guidance (R7, `channels-section.tsx`)
Expand the helper text under the chat-id input:
> "Find your chat id by messaging the bot (start the conversation first — the bot can't message you until you do), then send it `/start` and its reply, or use @userinfobot. Example: `123456789`."

Text-only change; the one-paragraph hint already there is extended.

## 6. Price chart (`components/price-chart.tsx`)

- **R10:** range selector becomes `<SegmentedControl options={RANGE_OPTIONS} value={range} onChange={setRange} label="Chart range" />`; nuqs `useQueryState` unchanged.
- **R11:** component gains `currency: string | null` prop (passed from the detail page). Tooltip `formatter` series label: `currency ? \`Price (${currency})\` : "Price"`; Y-axis tick formatter uses `formatPrice(value, currency)` so ticks show the currency symbol/code.
- **R9:** tooltip value formatter routes through `formatPrice`.

## 7. Login page (`app/login/page.tsx`) (R14)
- Copy: `"Price tracking & alerts. Enter your email and we'll send you a sign-in link."`
- Post-send state keeps the email visible and adds: spam-folder hint + `<ButtonSecondary onClick={() => setSent(false)}>Use a different email</ButtonSecondary>` and a "Resend link" path (setting `sent=false` returns to the form with the email prefilled — resubmit re-sends).

## 8. Favicon (R15)
- Add `apps/web/app/icon.svg`: simple "Iris" mark — e.g. slate-900 rounded square with a white eye/lens iris motif, matching the slate-900 brand button color. Next.js App Router serves `app/icon.svg` automatically; no layout change needed.

## Boundaries & compatibility
- No API, schema, or hook-signature changes beyond `useProducts` gaining `refetchInterval` (backward-compatible; only home list mounts it).
- `PriceChart` prop addition (`currency`) is a call-site change in one file.
- All new UI is client-rendered inside existing `AuthGate`-gated pages → no hydration risk from `Date.now()`-based relative times.

## Rollback
Each numbered section is an independent commit-able unit; reverting any one file restores prior behavior. No data migration.

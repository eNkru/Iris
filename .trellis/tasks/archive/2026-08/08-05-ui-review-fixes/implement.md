# Implementation Plan — Frontend UX/UI review fixes

Ordered checklist. Each step maps to PRD requirements; verify before moving on.

## Checklist

1. **`components/ui.tsx` foundations** (R9, R12, R10, R6)
   - [x] `formatPrice`: `Intl.NumberFormat` with try/catch fallback.
   - [x] Add `formatRelativeTime(date: Date | null): string`.
   - [x] Focus-visible ring classes on `Button`, `ButtonSecondary`, `ButtonDanger`.
   - [x] New `SegmentedControl` primitive (role="group", aria-pressed, no deps).

2. **`components/product-list.tsx`** (R1, R4, R5, R6)
   - [x] Per-row `pendingAction` state (`{id, kind}`); clear in `onSettled`; per-row disable + spinner.
   - [x] Paused badge + muted styling for inactive products.
   - [x] Inline delete confirm (`confirmingDeleteId`) replacing `window.confirm`.
   - [x] Relative "last checked" with `title={formatDateTime(...)}`.

3. **`hooks/use-products.ts`** (R6)
   - [x] `useProducts`: add `refetchInterval: 30_000`.

4. **`app/products/[id]/page.tsx`** (R2, R13, R6, R11)
   - [x] Check-now `onError` → inline `ErrorBox`; `checkNow.reset()` + clear stale result on new run.
   - [x] `h1` falls back to truncated URL with `title` attribute.
   - [x] Relative "Last checked" time.
   - [x] Pass `currency={product.currency}` to `PriceChart`.

5. **`components/price-chart.tsx`** (R10, R11, R9)
   - [x] Replace range buttons with `SegmentedControl` (nuqs unchanged).
   - [x] Accept `currency` prop; tooltip label/value + Y-axis ticks use it via `formatPrice`.

6. **`components/product-edit-form.tsx`** (R3, R8)
   - [x] Silent-config warning (derived `silentConfig`) — amber notice, saving still allowed.
   - [x] Fix misleading alert-rules foot text.
   - [x] Transient `Saved.` (savedAt state + 3s timeout + clear on field edit).

7. **`components/user-settings-section.tsx` + `components/admin-settings-section.tsx`** (R8)
   - [x] Same transient `Saved.` pattern in both.

8. **`components/channels-section.tsx`** (R7)
   - [x] Expanded chat-id guidance (how to find it + must message bot first).

9. **`components/app-nav.tsx`** (R12)
   - [x] Focus-visible ring on nav links.

10. **`app/login/page.tsx`** (R14)
    - [x] Copy fix; post-send spam hint + "use a different email / resend" path.

11. **`app/icon.svg`** (R15)
    - [x] Simple Iris mark (slate-900 + white), auto-served by App Router.

12. **Verification**
    - [x] `pnpm --filter @iris/web typecheck`
    - [x] `pnpm --filter @iris/web lint`
    - [ ] Manual pass through AC1–AC15 (see Validation below).

## Validation commands

```bash
pnpm --filter @iris/web typecheck
pnpm --filter @iris/web lint
pnpm dev   # manual AC walkthrough
```

Manual checks (dev server):
- AC1: two products → Check now on one → other row unaffected.
- AC3: product settings → uncheck "any change", clear thresholds → warning appears; save OK.
- AC5: Delete → inline Confirm/Cancel; Cancel restores; Confirm deletes.
- AC6: leave home page open ~35s → list refetches (network tab); hover "last checked" → full timestamp tooltip.
- AC12: Tab through nav + buttons → visible rings.
- AC15: new tab → icon present, no favicon 404.

## Risky files / rollback points

| File | Risk | Rollback |
|---|---|---|
| `components/product-list.tsx` | Most changes in one file (4 requirements) | Independent commit per step 2 sub-item |
| `components/ui.tsx` | `formatPrice` behavior change touches all price renders | try/catch keeps old format as fallback |
| `hooks/use-products.ts` | `refetchInterval` adds background load | Single-line revert |

## Pre-`task.py start` checks

- [ ] prd.md / design.md / implement.md present (done).
- [ ] `implement.jsonl` + `check.jsonl` curated with real spec entries (done).
- [x] User approved final planning summary in a follow-up message (2026-08-05; implementation delegated to another tool).

# Replace Next.js with a lighter web framework

## Goal

Reduce Iris container idle RAM and image size on the NAS by replacing the Next.js runtime with a lighter web stack, **without losing any user-facing functions** (auth, product tracking, price history, alert channels, settings, i18n, theme, admin).

## Background — measured baseline

From the parent backlog (`.trellis/tasks/08-11-nas-footprint-reduction/prd.md`): Next.js contributes **~170 MB idle RAM** and **~550 MB image**. Baseline container is ~823 MB RAM / 1.95 GB image.

## Confirmed facts (from codebase inspection)

The Next.js dependency surface is **small and mostly ceremonial** — Iris is already a client-side React app that happens to be hosted by Next:

- **Routing**: App Router, **4 pages** (`app/page.tsx`, `login`, `products/[id]`, `settings`) + 2 catch-all route handlers (`app/api/rpc/[...path]`, `app/api/auth/[...all]`). No `pages/`, no `loading.tsx`/`error.tsx`/`not-found.tsx`.
- **Server Components**: only `layout.tsx` and `page.tsx` are RSC, and the **only** server-side work is reading the `iris.lang` cookie (`app/lib/get-lang.ts`). **No server-side data fetching, no `fetch` in RSC.**
- **No Server Actions** (`"use server"` absent). **No ISR/revalidation**. **No streaming**. **No WebSockets/SSE**. **No `output: "standalone"`**, no custom server.
- **Data fetching**: 100% client-side via `@tanstack/react-query` over an oRPC client (`apps/web/lib/orpc.ts`, `hooks/use-*.ts`). Framework-agnostic — ports as-is.
- **API**: oRPC `RPCHandler` mounted at `/api/rpc` (`apps/web/app/api/rpc/[...path]/route.ts`); better-auth mounted at `/api/auth` via `toNextJsHandler`. Both are fetch-standard handlers, not Next-specific in essence.
- **Auth**: better-auth magic-link. Middleware (`apps/web/middleware.ts`) uses `getSessionCookie` from `better-auth/cookies` (framework-agnostic). Three-layer gate: middleware cookie presence → client `auth-gate` → oRPC `protectedProcedure`.
- **DB/ORM**: Drizzle + better-sqlite3, imported **directly** by oRPC procedures inside the Next process. No separate backend.
- **Styling**: Tailwind v4 + custom `components/ui.tsx` primitives. No shadcn/Radix. Portable.
- **Other UI deps**: `recharts` (price chart), `nuqs` (URL state via `nuqs/adapters/next/app`).
- **Scheduler bootstrap**: `apps/web/instrumentation.ts` boots `@iris/prices` `startScheduler` on the Node runtime, gated by `NEXT_PHASE`/`NEXT_RUNTIME`. The container is "web server AND worker."
- **Deploy**: single container, `next start` on :3000 via supervisord alongside the Camoufox sidecar on :8000. One volume at `/app/data`.

### Hard coupling points to replace

1. `better-auth/next-js` (`toNextJsHandler`) → better-auth's framework-agnostic handler.
2. `nuqs/adapters/next/app` → React Router `useSearchParams` (or nuqs generic adapter).
3. `next/headers` `cookies()` in `get-lang.ts`/`layout.tsx` → client-side cookie read or server template.
4. `next/navigation` (`useRouter`/`usePathname`/`useParams`/`useSearchParams`) in client components → React Router equivalents.
5. `instrumentation.ts` scheduler bootstrap → server lifecycle hook (start/stop).
6. `generateMetadata` (locale title) → set `<title>` server-side from cookie or client effect.

## Candidate analysis

| Candidate | RAM saved | Rewrite scope | Function loss | Risk |
|---|---|---|---|---|
| **Vite + React (SPA) + Hono Node server** | ~110-130 MB (Next runtime gone; ~40-60 MB Node remains) | Low — keep all components/hooks/Recharts/React Query; swap Next nav→React Router, write ~60-line server | None | Low |
| Astro + React islands | ~100-120 MB | Medium — pages become `.astro` shells with React islands; new adapters for auth/nuqs | None | Medium |
| SvelteKit | ~110-130 MB (marginal vs Vite) | High — rebuild every component/hook in Svelte; replace Recharts/React Query | None (reimplemented) | High |
| Express + HTMX | ~110-130 MB | Very high — replace entire client stack with server-rendered HTML+HTMX; loses React Query/Recharts | Functions change form | Very high |

### Key insight

Iris is **already a client-side React SPA** — Next's SSR/RSC is barely used (one cookie read). The Next.js cost is its **runtime overhead**, not a feature the app relies on. Removing the Next runtime (Vite SPA + a thin Hono server that mounts oRPC + better-auth + serves static assets + boots the scheduler) captures essentially **all** the RAM savings. SvelteKit does **not** save meaningfully more RAM (both leave a ~40-60 MB Node process) — it only shrinks the client JS bundle, which is not the NAS RAM bottleneck. So a non-React re-platform is not justified by the footprint goal.

**Recommended candidate: Vite + React (SPA) + Hono Node server.**

## Requirements

- Replace `next start` with a Vite-built React SPA served by a minimal Hono Node server.
- Mount the existing oRPC `RPCHandler` at `/api/rpc` and better-auth at `/api/auth` on the Hono server (fetch-standard, no Next adapter).
- Reproduce the cookie-based auth middleware gate using `better-auth/cookies` `getSessionCookie`.
- Replace `next/navigation` usage with React Router (`useRouter`/`useParams`/`useSearchParams`).
- Replace `nuqs` with React Router URL search-param state (or nuqs generic adapter).
- Reproduce `generateMetadata` locale title via server-rendered `<title>` from the lang cookie.
- Bootstrap `startScheduler`/`stopScheduler` on server start/shutdown (replacing `instrumentation.ts`).
- Preserve all existing UI, i18n (en/zh), theme toggle, Recharts price chart, admin gating, magic-link auth, alert channels, and the 30s product-list polling.
- Single container still served on :3000 via supervisord; Camoufox sidecar untouched.
- Production image no longer contains the Next.js runtime, `.next`, or Next-only deps.

## Acceptance Criteria

- [ ] App boots in Docker on :3000 and serves the SPA + `/api/rpc/*` + `/api/auth/*` from a Hono server.
- [ ] Magic-link login → session cookie → middleware redirect flow works identically.
- [ ] Product list/add/edit/delete/check-now, price history chart, alert channels, user + admin settings, i18n toggle, theme toggle all behave as before.
- [ ] Price-check scheduler starts on server boot and stops on shutdown.
- [ ] Idle container RAM is measurably lower than the Next.js baseline (target: drop by ≥100 MB).
- [ ] Production image is smaller than the Next.js baseline.
- [ ] No `next`, `@next/*`, `nuqs/adapters/next`, or `better-auth/next-js` imports remain in the app.

## Out of scope

- Camoufox sidecar changes (owned by sibling task `08-11-lazy-camoufox-browser` and backlog item A2).
- Replacing React with Svelte/Vue/etc. (re-platform) — not justified by the RAM goal.
- Changing the oRPC procedure definitions, Drizzle schema, or better-auth config.
- Multi-stage Docker restructuring (backlog item C1/C2 — independent).

## Key decisions

- **Rewrite scope: keep React.** User confirmed Vite + React + Hono. Rationale: Iris is already a client-side React SPA; SvelteKit saves no more NAS RAM (both leave a Node process) but rebuilds the entire UI. Full design in `design.md`; execution plan in `implement.md`.

## Deferred items

- Dev experience: a `dev` script running `vite` + `tsx watch server.ts` concurrently is an execution detail (implement.md §1), not a product decision.
- `router.refresh()` on sign-out has no SPA equivalent — replaced by `queryClient.clear()` + redirect (implement.md §6). Minor behavior change, no function loss.

# Implement — Vite + React + Hono migration

## Validation commands (run after each checkpoint)

```bash
# Typecheck (client)
pnpm --filter @iris/web exec tsc --noEmit
# Build client (Vite)
pnpm --filter @iris/web build
# Build server (server.ts → dist-server/server.js)
pnpm --filter @iris/web server:build
# Lint
pnpm --filter @iris/web lint
# Run client + server in dev concurrently
pnpm --filter @iris/web dev
# Smoke the production server locally
node apps/web/dist-server/server.js   # then curl http://localhost:3000/api/rpc/health/check
```

Docker validation (after checkpoint 5):
```bash
docker compose build iris && docker compose up -d iris
# Verify :3000 loads, login works, scheduler logs a tick, RAM < baseline
docker stats --no-stream iris-iris-1
```

## Ordered checklist

### 1. Add Vite + Hono + React Router deps; remove Next deps
- [ ] Add to `apps/web`: `vite`, `@vitejs/plugin-react`, `vite-plugin-tsconfig-paths` (or manual `resolve.alias`), `hono`, `@hono/node-server`, `react-router`, `tsx` (dev), `esbuild` (server build).
- [ ] Remove from `apps/web`: `next`, `@next/*`, `eslint-config-next`, `nuqs/adapters/next` (keep `nuqs` core).
- [ ] Update `apps/web/package.json` scripts: `dev` (concurrent vite+tsx), `build` (vite build), `server:build` (esbuild server.ts), `start` (`node dist-server/server.js`), `lint` (drop `next lint` → eslint directly).

### 2. Create `apps/web/vite.config.ts`
- [ ] `react()` plugin.
- [ ] `resolve.alias` for `@iris/api`, `@iris/auth`, `@iris/auth/client`, `@iris/database`, `@iris/prices`, `@iris/utils` → respective `packages/*/src/index.ts` (or tsconfig-paths plugin).
- [ ] `server.proxy`: `"/api"` → `http://localhost:3001` (dev Hono).
- [ ] `build.outDir: "dist"`.

### 3. Create `apps/web/server.ts` (Hono production entry)
- [ ] Mount `app.on(["POST","GET"], "/api/auth/*", c => auth.handler(c.req.raw))`.
- [ ] Mount `app.on(["GET","POST"], "/api/rpc/*", ...)` with `RPCHandler` + `prefix: "/api/rpc"` + `context: { headers: c.req.raw.headers }`.
- [ ] `serveStatic` for `/assets/*` and SPA fallback `*` → `index.html` (root resolved via `import.meta.url`).
- [ ] `serve({ fetch: app.fetch, port: 3000 }, () => startSchedulerSafely())`.
- [ ] `SIGTERM`/`SIGINT` → `stopScheduler()` + `server.close(() => process.exit(0))`.
- [ ] `NODE_ENV !== "production"` guard on scheduler (mirror `instrumentation.ts:18-20`).

### 4. Create `apps/web/index.html` + client root entry
- [ ] `index.html` with `<div id="root">`, static `<title>`, script tag → `/src/main.tsx`.
- [ ] `apps/web/src/main.tsx`: mount `QueryClientProvider`, `NuqsAdapter` (from `nuqs/adapters/react`), `SessionProvider`, `LanguageProvider`, `ThemeProvider`, `BrowserRouter`, and `App` (the root layout's content).
- [ ] Port `app/layout.tsx` shell into a client `App` component (`AppShell` + `AppNav` + `AppFooter`).

### 5. Convert routes to React Router
- [ ] Define `routes` (`/`, `/login`, `/products/:id`, `/settings`).
- [ ] `app/page.tsx` → `src/routes/home.tsx`.
- [ ] `app/login/page.tsx` → `src/routes/login.tsx`; `useSearchParams` (RR) replaces `next/navigation`.
- [ ] `app/products/[id]/page.tsx` → `src/routes/product.tsx`; `useParams` (RR).
- [ ] `app/settings/page.tsx` → `src/routes/settings.tsx`.
- [ ] Wrap protected routes in an `AuthGuard` (client redirect, mirrors `auth-gate.tsx`).
- [ ] Server-side auth gate in `server.ts`: for non-`/api`, non-asset GETs, `getSessionCookie(c.req.raw)` absent → redirect to `/login?redirectTo=...` (mirrors `middleware.ts`).

### 6. Swap navigation imports
- [ ] `app-nav.tsx`: `usePathname`→`useLocation().pathname`; `useRouter`→`useNavigate`; `router.refresh()`→`queryClient.clear()`+`navigate`; `next/link`→RR `<Link to>`.
- [ ] `auth-gate.tsx`: `usePathname`/`useRouter` → RR equivalents.
- [ ] `product-list.tsx`: `next/link` → RR `<Link>`.
- [ ] `products/[id]/page.tsx`: `useParams`, `next/link` → RR.
- [ ] `login/page.tsx`: `useSearchParams` → RR.

### 7. Drop Next-specific files
- [ ] Delete `app/lib/get-lang.ts` (client i18n covers it).
- [ ] Delete `apps/web/instrumentation.ts` + `instrumentation-node.ts` (logic moved to `server.ts`).
- [ ] Delete `apps/web/middleware.ts` (replaced by Hono guard in `server.ts`).
- [ ] Delete `apps/web/next.config.ts`, `apps/web/app/api/**` (route handlers), `apps/web/app/**` (pages/layouts — content moved to `src/`).
- [ ] Verify no `next`, `next/headers`, `next/navigation`, `next/link`, `better-auth/next-js` imports remain (`grep -rn "from \"next" apps/web/src apps/web/server.ts`).

### 8. Update Docker build
- [ ] `Dockerfile`: build step → `pnpm --filter @iris/web build` (Vite) + `pnpm --filter @iris/web server:build`.
- [ ] Entrypoint → `node dist-server/server.js` (keep `docker-entrypoint.sh` migrate + camoufox-wait).
- [ ] Remove `next.config.ts`-specific layer concerns; keep `better-sqlite3` native build still needed.

### 9. Verify & measure
- [ ] All acceptance criteria green (see `prd.md`).
- [ ] `docker stats` shows idle RAM ≥100 MB below the ~823 MB baseline.
- [ ] Production image smaller than the ~1.95 GB baseline.
- [ ] Magic-link login, product CRUD, price chart, channels, settings, admin gating, i18n, theme all work.

## Risky files / rollback points

- **`apps/web/server.ts`** — the highest-risk new file (auth + oRPC + scheduler + static). If broken, the app won't boot. Rollback: revert branch.
- **`apps/web/src/main.tsx` + routes** — routing/auth-gate logic. If broken, client renders but redirects fail. Rollback: revert branch.
- **`Dockerfile`** — build/entrypoint change. If broken, image won't run. Rollback: revert Dockerfile.
- **No `packages/*` files are modified** — workspace packages are untouched, so the API/DB/auth layers are a safe rollback floor.

## Follow-up before declaring done
- [ ] Confirm `@iris/auth/client` resolves correctly through Vite alias (client entry, not root).
- [ ] Confirm `better-sqlite3` native addon loads in the `node dist-server/server.js` production runtime.
- [ ] Confirm the 30s `useProducts` polling still fires after the migration.

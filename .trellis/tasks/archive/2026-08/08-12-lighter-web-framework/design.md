# Design — Vite + React (SPA) + Hono

## Architecture

Replace the Next.js runtime with two pieces:

1. **Vite SPA** (`apps/web/`) — builds a static React app to `dist/`. Keeps all existing components, hooks, React Query, Recharts, Tailwind. Routing switches from Next App Router to **React Router v7**.
2. **Hono Node server** (`apps/web/server.ts`) — production entry served on :3000. Mounts oRPC + better-auth, serves static `dist/` assets with SPA fallback, and boots/stops the price-check scheduler.

Dev runs two processes: `vite` (client, :5173) proxies `/api` → `tsx watch server.ts` (Hono, :3001). Production runs one Node process.

```
                  ┌─────────────────────────────────────┐
   browser ─────► │  Hono server (server.ts)  :3000     │
                  │  ┌──────────────────────────────┐   │
                  │  │ /api/auth/*  → auth.handler  │   │   ┌──────────────────┐
                  │  │ /api/rpc/*   → RPCHandler    │──►│   │ @iris/api (oRPC)  │
                  │  │ /assets/*    → serveStatic   │   │   │ @iris/auth        │
                  │  │ /*           → index.html SPA │   │   │ @iris/database    │
                  │  └──────────────────────────────┘   │   │ @iris/prices sched │
                  │  serve() callback → startScheduler  │   └──────────────────┘
                  │  SIGTERM/SIGINT  → stopScheduler    │
                  └─────────────────────────────────────┘
```

## Data flow & contracts

- **Client → oRPC**: unchanged. `apps/web/lib/orpc.ts` resolves `url: () => window.location.origin + "/api/rpc"` at call time — already browser-only, ports as-is. React Query hooks in `apps/web/hooks/use-*.ts` are framework-agnostic.
- **Client → better-auth**: unchanged. `packages/auth/src/client.ts` (`createAuthClient` from `better-auth/react`) is a fetch client with no Next dependency. `authClient.signIn.magicLink` works verbatim.
- **oRPC context**: `RPCHandler.handle(c.req.raw, { prefix: "/api/rpc", context: { headers: c.req.raw.headers } })` — identical to the current Next route handler (`apps/web/app/api/rpc/[...path]/route.ts:14-20`), just mounted on Hono instead of exported as GET/POST.
- **Auth handler**: `auth.handler(c.req.raw)` — `auth.handler` is a framework-agnostic fetch handler (replaces `toNextJsHandler`).

## Coupling-point replacements (all verified)

| # | Current | Replacement | Files affected |
|---|---|---|---|
| 1 | `toNextJsHandler(auth)` (`better-auth/next-js`) | `auth.handler(c.req.raw)` on Hono | new `server.ts` |
| 2 | `getSessionCookie` in `middleware.ts` (works with plain `Request`) | Hono guard `getSessionCookie(c.req.raw)` | new `server.ts` (auth-protected SPA routes) |
| 3 | `nuqs/adapters/next/app` (`providers.tsx:4`) | `nuqs/adapters/react` (keep nuqs) | `providers.tsx` |
| 4 | `next/navigation` hooks | React Router v7 (`useNavigate`/`useLocation`/`useSearchParams`/`useParams`) | `products/[id]/page.tsx`, `login/page.tsx`, `app-nav.tsx`, `auth-gate.tsx` |
| 5 | `next/link` `<Link href>` | React Router `<Link to>` | `products/[id]/page.tsx`, `app-nav.tsx`, `product-list.tsx` |
| 6 | `cookies()` from `next/headers` (`get-lang.ts`) | Drop — client `LanguageProvider` (`lib/i18n.tsx`) already syncs lang; `<title>` set client-side or static in `index.html` | delete `get-lang.ts`; `layout.tsx` → `index.html` + client root |
| 7 | `instrumentation.ts` + `instrumentation-node.ts` | `serve()` callback → `startScheduler`; `SIGTERM`/`SIGINT` → `stopScheduler` | new `server.ts`; delete both instrumentation files |
| 8 | `transpilePackages` + `serverExternalPackages` (next.config.ts) | Vite `resolve.alias` for 5 `@iris/*` packages; Node natively loads `better-sqlite3` | new `vite.config.ts`; delete `next.config.ts` |
| 9 | `generateMetadata` locale title (`layout.tsx:13-19`) | Static `<title>` in `index.html` + client effect from lang context | `index.html`, client root |

### `router.refresh()` note
`app-nav.tsx:27` calls `router.refresh()` after sign-out. No SPA equivalent — replace with React Query `queryClient.clear()` (drops cached session/user data) then `navigate("/login", { replace: true })`.

## Server/client package split

`@iris/auth`, `@iris/api`, `@iris/database`, `@iris/prices` are Node-only (better-sqlite3, drizzle, nodemailer, AI SDK). They must never enter the Vite client bundle. Import discipline already enforces this: client files import `@iris/auth/client` (the React client), never `@iris/auth` root. The Hono `server.ts` is the only importer of the root entries. Vite's `resolve.alias` maps package names → source `index.ts`; the client graph naturally excludes server-only packages as long as no client file imports them.

## Compatibility & migration

- **oRPC procedures, Drizzle schema, better-auth config**: unchanged. No `packages/*` edits.
- **Docker**: `Dockerfile` build step `pnpm --filter @iris/web build` (Next) → `pnpm --filter @iris/web build` (Vite) + `pnpm --filter @iris/web server:build` (tsx→esbuild for server.ts). Entrypoint `exec pnpm --filter @iris/web start` → `exec node dist-server/server.js` (or `pnpm --filter @iris/web start` mapped to `node`). Supervisord/Camoufox/:3000/:8000 unchanged.
- **Env**: `next.config.ts:10` `loadEnvConfig` (repo-root `.env`) → Vite loads `.env` via `loadEnv` or the Hono server uses `dotenv`. The root `.env` is the single source.
- **Middleware matcher**: the Next middleware excludes `/api`, `/_next/*`, and dotted paths. The Hono auth guard only protects non-`/api`, non-asset GET routes returning `index.html` — a smaller, simpler surface.

## Tradeoffs

- **Loss of RSC**: only one cookie read used it; client i18n already exists. Net effect ~nil.
- **SPA no SSR**: first paint requires JS. Acceptable for a NAS admin app (already client-rendered in practice — 3 of 4 pages are `"use client"`).
- **Dev complexity**: two processes (vite + tsx) vs one `next dev`. Mitigated by a `dev` script running both concurrently.
- **`router.refresh()`**: replaced by query-cache clear. Minor behavior change in sign-out flow.

## Rollback

- Keep `apps/web/next.config.ts` and `app/` in git history; the migration is a branch. If the Vite/Hono build misbehaves, revert the branch — `next start` still works from the prior commit.
- No DB schema changes → no data rollback needed.
- No `packages/*` changes → workspace packages are untouched.

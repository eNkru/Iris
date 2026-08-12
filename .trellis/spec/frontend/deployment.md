# Deployment & Background Scheduler Wiring

Covers running the Vite SPA + Hono server as a single production container with
an in-process background worker (price-check scheduler), Docker deployment, and
the `server.ts` lifecycle hooks that replace the former Next.js
`instrumentation.ts`.

## Architecture (Vite + Hono)

The web app is a **Vite-built SPA** served by a **Hono production server**
(`apps/web/server.ts`). There is no Next.js runtime, no edge runtime, and no
`instrumentation.ts`. The Hono server is the single entry point that:

1. Mounts the better-auth handler at `/api/auth/*`.
2. Mounts the oRPC `RPCHandler` at `/api/rpc/*` with `prefix: "/api/rpc"` and
   `context: { headers: c.req.raw.headers }`.
3. Serves Vite-built static assets from `dist/` (`/assets/*` + SPA fallback).
4. Enforces a server-side auth gate (cookie-presence check) for non-API GETs.
5. Starts the price-check scheduler on boot (production only).
6. Shuts down the scheduler + HTTP server on `SIGTERM`/`SIGINT`.

### server.ts lifecycle

```typescript
const server = serve(
  { fetch: app.fetch, port: 3000 },
  () => {
    logger.info("Server started", { port: 3000 });
    startSchedulerSafely();
  },
);

function shutdown(): void {
  stopScheduler();
  server.close(() => {
    logger.info("Server stopped");
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
```

Rules (verified on Vite 6 + Hono 4):

- The scheduler is gated by `NODE_ENV !== "production"` to avoid double-starts
  during dev (Vite HMR re-evaluates modules but `server.ts` is run by `tsx
  watch`, which restarts on save).
- Wrap scheduler startup in try/catch: the app must still boot if the DB is
  down; the loop logs per-tick failures instead of crashing the process.
- `import.meta.url` is **not** available in the esbuild CJS production bundle.
  Use `typeof __dirname !== "undefined"` as a guard to resolve the static root
  in both ESM (dev/tsx) and CJS (production) modes.

## Docker single-container (web + worker + Camoufox)

- One app container runs the Hono web server, the in-process scheduler, and
  Camoufox (via supervisord) — all on one volume-backed container.
- The entrypoint runs `db:migrate` (idempotent, Drizzle) on every start so a
  fresh deployment needs only `docker compose up --build -d`.
- `pnpm install --frozen-lockfile` in the Dockerfile requires the lockfile to
  be committed and consistent; run `pnpm install` locally to keep it in sync.
- Pin the pnpm version via corepack matching `packageManager` in package.json:
  `RUN corepack enable && corepack prepare pnpm@<version> --activate`.
- `DATABASE_PATH` and `CAMOUFOX_SIDECAR_URL` build args may be required even
  though the connection is lazy: module-level env validation (`getEnv()`) can
  run during `esbuild` bundling. Compose passes them via `build.args`; no real
  connection happens at build time.
- Healthcheck: expose a public health procedure on the oRPC router and point the
  container healthcheck at its real path
  (`wget -qO- http://localhost:3000/api/rpc/health/check`).
- Build steps: `pnpm --filter @iris/web build` (Vite) +
  `pnpm --filter @iris/web server:build` (esbuild → `dist-server/server.cjs`).
- Entrypoint: `node dist-server/server.cjs` (via `docker-entrypoint.sh`).

### Critical: do NOT `rm -rf apps packages` mid-build

> **Warning**: The Camoufox install step previously ended with
> `rm -rf apps packages` to "keep the layer lean". This **destroys pnpm
> package-level `node_modules` symlinks** (e.g.
> `packages/auth/node_modules/better-auth`). After `COPY . .`, the
> `.dockerignore` excludes `node_modules`, so the symlinks are gone. Vite's
> `resolve.alias` maps `@iris/auth/client` → `packages/auth/src/client.ts`, and
> Rollup then resolves `better-auth/react` from `packages/auth/` — which has no
> `node_modules`. The build fails with:
> `Rollup failed to resolve import "better-auth/react"`.
>
> **Fix**: Do NOT `rm -rf apps packages` in any layer before `COPY . .`. The
> few extra `package.json` stubs add negligible size; the symlinks must survive.

## Compose topology

- `app` (build `.`), one `iris-data` volume mounted at `/app/data`.
- `supervisord` runs Camoufox on `127.0.0.1:8000` and the Hono app/scheduler
  on port 3000.
- The entrypoint applies SQLite migrations, waits for Camoufox `/health`, then
  starts `node dist-server/server.cjs`.
- `DATABASE_PATH=/app/data/iris.db` and
  `CAMOUFOX_SIDECAR_URL=http://127.0.0.1:8000` are internal container contracts.

## Single-image SQLite deployment

Native `better-sqlite3` is a direct server dependency and is externalized from
the esbuild bundle (`--external:better-sqlite3`). Docker includes the native
build toolchain as a fallback for architectures without a prebuilt addon.
Validate the image with both health endpoints, `supervisorctl status`, a
supervised Camoufox restart, and a full container restart.

### Measured footprint (2026-08-13)

| Metric | Next.js baseline | Vite + Hono | Delta |
|---------|-----------------|-------------|-------|
| Idle container RAM | ~823 MB | **187 MB** | -636 MB (77%) |
| Image size | ~1.95 GB | ~1.96 GB | +10 MB (negligible) |

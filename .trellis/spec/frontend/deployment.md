# Next.js Deployment & Background Scheduler Wiring

Covers running a Next.js app as a single production container with an in-process
background worker (e.g. a price-check scheduler), Docker deployment, and the
`instrumentation.ts` edge-runtime gotcha.

## Instrumentation: Node-only code and the edge runtime

Next.js compiles `apps/web/instrumentation.ts` into **both** the Node server and
the edge runtime when middleware exists. Node-only dependencies (`pg`,
`ioredis`, `drizzle-orm`, ...) must NEVER be statically reachable from the edge
compilation or the build fails with `Can't resolve 'fs'` / `Can't resolve
'net'`.

Rules that work (verified on Next.js 15.5):

- Keep Node-only side effects in a separate module (`instrumentation-node.ts`)
  and import it with `await import()` **inside** a
  `process.env.NEXT_RUNTIME === "nodejs"` branch. Next statically replaces
  `NEXT_RUNTIME` per compilation, so webpack drops the dead branch and never
  bundles the Node-only deps into the edge bundle.
- A dynamic import after an early `return` is NOT enough — the branch must be
  syntactically inside the runtime guard.
- `register()` does **not** run during `next build` (guard with
  `process.env.NEXT_PHASE === "phase-production-build"` if needed).
- `register()` runs in dev too. Start long-running loops only in production
  (`NODE_ENV === "production"`), otherwise `next dev` double-starts them.
- Wrap scheduler startup in try/catch: the app must still boot if Redis/DB are
  down; the loop logs per-tick failures instead of crashing the process.

```typescript
// apps/web/instrumentation.ts
export async function register(): Promise<void> {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.NODE_ENV === "production" && process.env.NEXT_RUNTIME === "nodejs") {
    const { start } = await import("./instrumentation-node");
    start();
  }
}
```

## Docker single-container (web + worker)

- One app container runs both the Next.js web server and the in-process worker
  (design decision for a private NAS; no separate worker service).
- The entrypoint runs `db:migrate` (idempotent, Drizzle) on every start so a
  fresh deployment needs only `docker compose up --build -d`. Retry the migrate
  until Postgres is healthy (depends_on healthchecks are not enough on first
  boot — the app may start before Postgres accepts connections).
- `pnpm install --frozen-lockfile` in the Dockerfile requires the lockfile to be
  committed and consistent; run `pnpm install` locally to keep it in sync.
- Pin the pnpm version via corepack matching `packageManager` in package.json:
  `RUN corepack enable && corepack prepare pnpm@<version> --activate`.
- A `DATABASE_URL` build arg may be required even though the connection is lazy:
  module-level env validation (`getEnv()`) can run during `next build`. Compose
  passes it via `build.args`; no real connection happens at build time.
- Healthcheck: expose a public health procedure on the oRPC router and point the
  container healthcheck at its real path (e.g. `wget -qO- http://localhost:3000/api/rpc/health/check`).
  The `health` module on a router prefixed `/api` mounted at `/api/rpc/[...path]`
  resolves to `/api/rpc/health/check`.

## Compose topology

- `app` (build `.`), `postgres` (16-alpine, `pg_isready` healthcheck), `redis`
  (7-alpine, `redis-cli ping` healthcheck). `app` uses
  `depends_on: { postgres: { condition: service_healthy }, redis: ... }`.
- Wire `DATABASE_URL`/`REDIS_URL` to the Compose service names
  (`postgres:5432`, `redis:6379`) inside the app service environment — the
  repo-root `.env` holds local-dev values and must be overridden by Compose.

# Design — Single all-in-one container (SQLite + no Redis + app/camoufox merged)

## Goal restated

One Docker image, one container, no external stateful services. For a
single-user (or near-single-user) self-hosted deployment, Postgres + Redis
are unjustifiable operational weight. Replace them: SQLite (file DB, volume-
mounted) for all data, remove Redis (in-process guards replace its two roles),
and fold the Camoufox sidecar into the same image under a process supervisor.

## Architecture (before → after)

```
BEFORE (4 compose services, 2 custom images)            AFTER (1 compose service, 1 custom image)
┌────────┐ ┌────────┐ ┌───────────┐ ┌───────┐          ┌─────────────────────────────────────────┐
│  app   │ │camoufox│ │ postgres  │ │ redis │   ──►    │            single container              │
│ (Node) │ │(Python)│ │           │ │       │          │  supervisord (PID 1)                     │
│ web +  │ │  fetch │ │ app data  │ │session│          │   ├─ camoufox  (uvicorn, 127.0.0.1:8000) │
│ sched  │ │ sidecar│ │ + auth    │ │ + lock│          │   └─ iris-app  (next start + scheduler)  │
└────────┘ └────────┘ └───────────┘ └───────┘          │      └─ SQLite file at /app/data/iris.db  │
                                                        └─────────────────────────────────────────┘
                                                                + named volume → /app/data
```

The Next.js process keeps doing two jobs (web + in-process scheduler, R14
unchanged). Camoufox becomes a supervised sibling process in the same
container, reached over loopback instead of the Compose network.

## Component 1 — Postgres → SQLite

### Driver: `better-sqlite3` (synchronous, native)

- `better-sqlite3` is the better-auth-recommended SQLite driver and ships
  prebuilt binaries for `linux/x64` and `linux/arm64` (the only target archs —
  Camoufox already constrains us to these). The image will also carry
  `build-essential` + `python3` (needed for the Camoufox Python runtime
  anyway), so a source build fallback exists if a prebuild is ever absent.
- Drizzle driver: `drizzle-orm/better-sqlite3` replaces `drizzle-orm/node-postgres`;
  the `db` client in `packages/database/src/drizzle/client.ts` is constructed
  from a `Database` (better-sqlite3) instance, not a `pg` Pool.

### Config / env

- `DATABASE_URL` (Postgres URL) is replaced by `DATABASE_PATH`, a filesystem
  path, default `./data/iris.db` (dev) / `/app/data/iris.db` (container).
  Optional `:memory:` for tests. The env schema (`packages/utils/src/lib/env.ts`)
  swaps the field; `getEnv().DATABASE_PATH` is the single source of truth.
- WAL journal mode enabled at client init (`PRAGMA journal_mode=WAL`) so
  reads never block the (single) writer and the scheduler tick + web requests
  can coexist. `PRAGMA foreign_keys=ON` (SQLite disables FKs by default; the
  schema relies on `ON DELETE cascade`).
- Parent directory is created at init if missing.

### Schema conversion (`pg-core` → `sqlite-core`)

`packages/database/src/drizzle/schema/postgres.ts` → renamed/conceptually
rewritten to `sqlite.ts` (keep the export name `products`, `priceReadings`,
etc. so query imports are stable). `auth.ts` likewise. Conversions:

| Postgres (now) | SQLite (target) | Notes |
| --- | --- | --- |
| `pgTable(...)` | `sqliteTable(...)` | |
| `uuid().primaryKey().defaultRandom()` | `text().primaryKey().$defaultFn(() => crypto.randomUUID())` | SQLite has no native UUID; generate in JS. FK columns referencing `user.id` are already `text`. |
| `pgEnum("channel_type", ...)` | `text()` + CHECK constraint | SQLite has no enum. App already validates against `CHANNEL_TYPE_VALUES` (utils source of truth); add a CHECK for defense-in-depth. |
| `jsonb().$type<T>()` | `text().$type<T>()` + (app) `JSON.stringify`/parse | Drizzle sqlite stores JSON as text; `$type` keeps TS typing. Query layers already pass plain objects — need to JSON-encode on write / parse on read at the query boundary (see below). |
| `numeric(14,2)` | `text()` (store `.toFixed(2)`) | Preserve precision; existing code already writes `newPrice.toFixed(2)`. Read path uses `Number(...)` on the string — unchanged. |
| `timestamp({ withTimezone:true }).defaultNow()` | `integer({ mode:"timestamp" }).default(sql\`(unixepoch())\`)` | Unix-epoch seconds. better-auth sqlite expects integer timestamps. |
| `gen_random_uuid()` (migration SQL) | app-generated UUID via `$defaultFn` | No DB-side generation. |
| `now()` / `make_interval(mins => ...)` (scheduler SQL) | `unixepoch()` / datetime arithmetic in SQL or app | See scheduler section. |

### better-auth schema compatibility (the riskiest part)

better-auth's Drizzle adapter accepts `provider: "sqlite"` (confirmed in
better-auth docs). The hand-written auth tables (`user`, `session`,
`account`, `verification`) must match the column names/types better-auth
expects for SQLite. Process:

1. Run `npx @better-auth/cli generate --output /tmp/ba-sqlite.ts` against
   the converted (sqlite) schema + `provider:"sqlite"` config.
2. Diff the generated canonical SQLite auth schema against our `auth.ts`.
   Reconcile any type differences (better-auth may use `integer` for
   timestamps, specific column nullability).
3. Keep table/column NAMES identical (better-auth relies on them).

### Migrations

- Regenerate from the converted schema: `pnpm --filter @iris/database
  db:generate` produces a fresh SQLite `0000_initial.sql` under a new
  migrations dir. The old Postgres migration is discarded (see Data migration).
- `drizzle.config.ts`: `dialect: "sqlite"`, `dbCredentials: { url:
  DATABASE_PATH }`.
- `db:migrate` (`drizzle-kit migrate`) runs against the file DB — local,
  instant, no retry loop.

### JSON column handling at the query boundary

Two JSON columns: `products.alertRules` (typed `AlertRules`) and
`alert_channels.config` (typed per-channel), plus `user_settings.aiModelOverride`
and `global_settings` has none. With `pg`'s `jsonb`, Drizzle auto-
serializes objects ↔ `jsonb`. With sqlite `text`, we must serialize
explicitly. Approach: keep the schema column as `text().$type<T>()` and add a
small query-layer helper (`jsonText<T>(v: T) => JSON.stringify(v)` on write,
parse on read) OR rely on Drizzle's sqlite JSON mode — Drizzle's
`sqliteTable` supports `text({ mode: "json" }).$type<T>()` which auto-
stringifies/parses. **Use `text({ mode: "json" }).$type<T>()`** — this is
the cleanest, no query-layer change. Verify the generated migration emits
`TEXT` columns (it will).

### `check-price.ts` transactionality — `FOR UPDATE` → in-process mutex

- Postgres `SELECT ... FOR UPDATE` (`tx.select().for("update")`) serializes
  concurrent checks of the same product. SQLite has no row-level locks.
- In a single container there is exactly **one** scheduler process and the
  app's RPC `checkNow` runs in that same process. The realistic concurrency
  is: a scheduler tick and a manual `checkNow` for the same product racing.
- Replace the DB row lock with an **in-process per-product mutex** — a
  `Map<string, Promise<CheckPriceResult>>` keyed by `productId` inside
  `checkPrice`: if a check for `productId` is in flight, await it and return
  its result instead of starting a second. Drop `.for("update")`. This
  preserves the no-duplicate-reading guarantee for in-process concurrency
  without any DB-level locking or Redis.
- `db.transaction(...)` stays (atomic read-modify-write); better-sqlite3 +
  WAL handles it. The transaction is short and local.

### Scheduler — remove the Redis lock

- `runSchedulerTick` currently acquires a Redis `SET NX EX` lock so multiple
  app replicas don't double-process. With one container there is one
  process; the lock is dead weight.
- Remove the Redis lock acquire/release. Keep the existing in-process
  `tickInProgress` guard (prevents overlapping ticks within the process).
- `findDueProducts` SQL: replace `now() - make_interval(mins => COALESCE(...))`
  with SQLite: `lastCheckedAt IS NULL OR lastCheckedAt < unixepoch() - COALESCE(pollIntervalMinutes, ?) * 60`
  (pass `defaultIntervalMinutes` as a param). Cursor (`gt(products.id, cursorId)`)
  is unchanged.
- `SCHEDULER_LOCK_TTL_SECONDS` env removed.

## Component 2 — Remove Redis

### Session cache (`packages/auth/src/lib/session-cache.ts`)

- Cache-aside over Redis becomes unnecessary for a single-user SQLite setup:
  `auth.api.getSession` against SQLite is cheap and local.
- Simplify: `getSessionWithCache(headers)` → a thin `getSession(headers)`
  that calls `auth.api.getSession` directly and returns `{ session, fromCache:
  false }` (keep the return shape so `procedures.ts` barely changes — just a
  rename/inline). Remove `invalidateSessionCache` and its (single) call site.
  Remove the `ioredis` dependency from `@iris/auth`.
- No in-memory cache layer is added; better-auth + SQLite is fast enough for
  one user. (A process-scoped `Map` LRU is a trivial later add if needed.)

### `packages/utils/src/lib/redis.ts`

- Delete the file. Remove `getRedis`/`closeRedis` exports from
  `packages/utils/src/index.ts`. Remove `ioredis` from `@iris/utils` deps.
- `env.ts`: remove `REDIS_URL` (and `SCHEDULER_LOCK_TTL_SECONDS`, above).
- Call sites: `scheduler.ts` (lock removal, above) and `session-cache.ts`
  (above). No other callers (confirmed by grep).

## Component 3 — Merge app + Camoufox into one supervised image

### Dockerfile (single, multi-stage)

Base choice: `node:22-bookworm-slim` as the runtime base (Node is primary;
Debian gives apt access to Python + the GTK/NSS stack Camoufox needs).
Python is the auxiliary runtime.

Stages:

1. **`deps`** — `node:22-bookworm-slim`. Install pnpm (corepack, pinned).
   Copy workspace manifests, `pnpm install --frozen-lockfile` (fetches
   `better-sqlite3` prebuild). `COPY camoufox/ ./camoufox/` and
   `pip install --no-cache-dir camoufox fastapi uvicorn` then `camoufox fetch`
   (Firefox baked into the layer, offline at runtime — unchanged from today's
   sidecar build). Install the GTK/NSS/X11/font apt packages (the existing
   list from `camoufox/Dockerfile`) here so they're present for the browser.
2. **`build`** — from `deps`. `COPY . .`, pass build-arg placeholders
   (`DATABASE_PATH=/app/data/iris.db`, `CAMOUFOX_SIDECAR_URL=http://127.0.0.1:8000`),
   `RUN pnpm --filter @iris/web build`.
3. **`runtime`** — `node:22-bookworm-slim`. Re-install the GTK/NSS apt
   packages (runtime libs), Python 3 (for uvicorn + camoufox runtime),
   `wget` (healthcheck), `supervisord` (`apt-get install supervisor` or
   `pip install supervisor`). Copy from `deps`: `node_modules`, camoufox
   browser cache + `server.py` + python packages. Copy from `build`: the
   built `.next` + `public` + package sources needed at runtime (transpiled
   workspace packages). Copy `supervisord.conf`, entrypoint, migrations.
   `VOLUME /app/data`. `EXPOSE 3000`. `CMD ["supervisord","-c",
   "/etc/supervisord.conf"]`.

   (A fully multi-stage prune of the Python *build* toolchain is a later
   optimization; keeping `python3` in the runtime is required for uvicorn
   + camoufox anyway, so the image is intentionally not minimal.)

### Process supervision — `supervisord`

`/etc/supervisord.conf`:

```ini
[supervisord]
nodaemon=true
logfile=/dev/stdout
logfile_maxbytes=0
pidfile=/tmp/supervisord.pid

[program:camoufox]
command=uvicorn server:app --host 127.0.0.1 --port 8000
directory=/app/camoufox
autostart=true
autorestart=true
startsecs=10
priority=10
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:iris-app]
command=/usr/local/bin/iris-app-start
directory=/app
autostart=true
autorestart=true
startsecs=5
priority=20
stopsignal=TERM
stopasgroup=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
```

- **`iris-app-start`** wrapper (replaces `docker-entrypoint.sh`): creates
  `/app/data`, runs `pnpm db:migrate` (local, instant, idempotent), then
  `exec pnpm --filter @iris/web start`. No DB-wait loop (SQLite is a file).
- **Ordering**: camoufox `priority=10` starts first; the app `priority=20`.
  The app already tolerates a sidecar that isn't ready yet (soft dependency —
  fetches fail loudly via logging until the browser is up), so strict
  blocking isn't required. The wrapper additionally waits for
  `http://127.0.0.1:8000/health` to return 200 before `next start` so first
  boot is clean (a 1-line `wget --spider` retry loop).
- **Crash isolation**: supervisord restarts a crashed program independently.
  A Camoufox browser-process crash (the original reason for the sidecar
  split) no longer risks the app process beyond the `fetch_failed` the app
  already handles — and `server.py`'s existing self-heal (browser recreation
  after 3 consecutive failures) is preserved unchanged.
- **Logs**: both programs log to stdout/stderr → `docker logs iris` shows
  prefixed lines (`iris-app:` / `camoufox:`). supervisord's own logs go to
  stdout.

### `CAMOUFOX_SIDECAR_URL`

- Runtime value: `http://127.0.0.1:8000` (loopback, not published). Set in
  the container env / `iris-app-start` wrapper. The app's HTTP client
  (`fetch-page.ts`) is unchanged — it just POSTs to this URL.

### `docker-compose.yml` (collapsed)

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    environment:
      NODE_ENV: production
      APP_URL: ${APP_URL:-http://localhost:3000}
      DATABASE_PATH: /app/data/iris.db
      CAMOUFOX_SIDECAR_URL: http://127.0.0.1:8000
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:-dev-secret-change-me}
      SMTP_*: ...
      AI_*: ...
      TELEGRAM_BOT_TOKEN: ...
      SCHEDULER_TICK_MS: ...
    ports: ["3000:3000"]
    volumes: ["iris-data:/app/data"]
    healthcheck:
      test: ["CMD-SHELL","wget -qO- http://localhost:3000/api/rpc/health/check >/dev/null || exit 1"]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 40s
volumes:
  iris-data:
```

Postgres + Redis + camoufox services + their volumes are deleted. One
`iris-data` volume holds the SQLite file (and only that).

### `.dockerignore` / `.env.example` / README

- `.dockerignore`: add `data/` (local dev sqlite) so it isn't copied into
  the build context; keep existing ignores.
- `.env.example`: remove `DATABASE_URL`, `REDIS_URL`, `POSTGRES_*`,
  `SCHEDULER_LOCK_TTL_SECONDS`, `CAMOUFOX_SIDECAR_URL` (now internal); add
  `DATABASE_PATH=./data/iris.db`. Keep SMTP/AI/Telegram/APP_URL/
  BETTER_AUTH_SECRET/SCHEDULER_TICK_MS.
- README "Quick start" + "Local development" + config table rewritten to
  the single-container shape (`docker compose up --build -d` → one service;
  dev still uses `pnpm dev` against a local SQLite file + a local camoufox
  process or `docker compose up app` for the sidecar-only path — see Local
  dev below).

## Local development

- `pnpm dev` now uses a local SQLite file (`./data/iris.db`, gitignored) —
  no Postgres to start. `pnpm db:migrate` creates it.
- Camoufox still needs to run for fetches. Two options, both kept:
  1. `docker compose up app` (builds the single image, runs supervisord) —
     full stack locally.
  2. Run `uvicorn server:app` in a local venv under `camoufox/` (existing
     dev pattern) with `CAMOUFOX_SIDECAR_URL=http://localhost:8000`.
- The old `docker compose up postgres redis camoufox` dev incantation is
  removed from README.

## Data migration (existing Postgres data)

- **Out of scope for automation.** The SQLite migration is a fresh schema
  generation, not a row-level dump-and-load. If the operator has existing
  tracked products in Postgres they want to keep, they export manually
  (e.g. `pg_dump --data-insert` → transform → SQLite insert) or simply re-add
  the handful of products. The user confirmed single-user scale, so re-adding
  is the expected path. Documented as a known limitation.

## Compatibility / rollback

- **No API/auth/scheduler-contract changes.** oRPC procedures, better-auth
  magic-link flow, the fetch transport contract, alert dispatch — all
  unchanged. The only external behavior change is the deployment shape.
- **Rollback shape**: revert the PR (restores Postgres + Redis + 2-image
  compose). SQLite file is independent and can be discarded. No schema
  migration is shared between the two (different DBs), so rollback is
  "rebuild old images + point at old Postgres data" — data continuity
  across a rollback is not automatic (same as the forward migration).
- `better-sqlite3` native binary: if a prebuild is missing for the target,
  the image's `build-essential`+`python3` let `pnpm install` compile from
  source. Fallback path exists; not expected on linux x64/arm64.

## Risks

| Risk | Mitigation |
| --- | --- |
| better-auth SQLite schema type mismatch (timestamps, nullability) | `@better-auth/cli generate` against sqlite, diff, reconcile before migrate |
| `better-sqlite3` prebuild missing on target arch | image carries build toolchain; compiles from source as fallback |
| Image size grows (Node+Python+Firefox+GTK in one image) | Accepted tradeoff for single-container ops; multi-stage prunes build-only layers where safe |
| Memory: Next.js + scheduler + Firefox in one process group | Fine at single-user scale; supervisord gives restart-on-OOM |
| Duplicate concurrent price reading without `FOR UPDATE` | In-process per-product mutex in `checkPrice` covers the only realistic (in-process) concurrency |
| SQLite write contention under scheduler + web writes | WAL mode + short transactions; single-user load is far below SQLite's ceiling |
| `jsonb` → `text({mode:"json"})` silent breakage | Use Drizzle's json text mode (auto serde); covered by typecheck + a seed/round-trip check |

## Deferred / out of scope

- Automated Postgres→SQLite data migration (see Data migration).
- Shrinking the image further (distroless, multi-arch beyond x64/arm64).
- Embedded Postgres/Redis (rejected — the whole point is to remove them).
- Re-implementing Camoufox in Node to drop Python (rejected — high effort,
  loses engine-level anti-detect Firefox).
- Multi-replica horizontal scaling (Redis lock was for this; single
  container makes it moot; if ever needed, re-introduce an external lock).

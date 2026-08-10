# Implement — Single all-in-one container

## Execution status (2026-08-08)

Completed: SQLite/better-sqlite3 conversion, Redis removal, in-process scheduler and price-check guards, supervised single-image Docker runtime, collapsed Compose topology, generated/applied SQLite migration, documentation, full typecheck/lint, Compose validation, image build, healthy container boot, app/Camoufox health checks, supervisor recovery, and container restart validation.

Environment-dependent follow-up: magic-link SMTP delivery and live retailer/AI price extraction were not exercised because this validation environment does not provide credentials. The standalone Next build still reproduces the pre-existing base-branch `/404`/`/500` `<Html>` prerender error; the Docker production image build and runtime validation pass.

## Ordered checklist

> Work proceeds top-to-bottom. Each section is independently verifiable; the
> sections are ordered so earlier layers unblock later ones. Validate after
> every section with the listed command.

### 1. Env schema — swap Postgres URL for SQLite path, drop Redis vars

- [ ] `packages/utils/src/lib/env.ts`: replace `DATABASE_URL: z.string().min(1, "…")`
      with `DATABASE_PATH: z.string().min(1, "DATABASE_PATH is required").default("./data/iris.db")`.
- [ ] Remove `REDIS_URL` and `SCHEDULER_LOCK_TTL_SECONDS` from `envSchema`.
- [ ] Keep `CAMOUFOX_SIDECAR_URL` (required) — runtime default points at
      loopback inside the container; dev points at `http://localhost:8000`.
- [ ] `packages/database/src/env.ts` (seed dotenv loader): unchanged (it
      loads repo-root `.env`; no schema reference).
- [ ] Update `.env.example`: remove `DATABASE_URL`, `REDIS_URL`, `POSTGRES_*`,
      `SCHEDULER_LOCK_TTL_SECONDS`; add `DATABASE_PATH=./data/iris.db`.
- [ ] **Validate:** `pnpm --filter @iris/utils typecheck` (will fail
      downstream until DB package is converted — that's expected; fix in §2).

### 2. Database package — Drizzle `pg` → `better-sqlite3`

- [ ] `packages/database/package.json`: deps — remove `pg`, `@types/pg`;
      add `better-sqlite3`, `@types/better-sqlite3`. Keep `drizzle-orm`.
- [ ] `packages/database/src/drizzle/client.ts`: rewrite from `pg` Pool +
      `drizzle-orm/node-postgres` to `better-sqlite3` `Database` +
      `drizzle-orm/better-sqlite3`. Init: `new Database(getEnv().DATABASE_PATH)`,
      `PRAGMA journal_mode=WAL`, `PRAGMA foreign_keys=ON`, `mkdir` parent dir.
- [ ] `packages/database/src/drizzle/schema/auth.ts`: `pgTable` →
      `sqliteTable`, `pg-core` → `sqlite-core`. `timestamp` →
      `integer({ mode: "timestamp" })` with `default(sql\`(unixepoch())\`)`.
      Keep table/column NAMES identical (better-auth depends on them).
- [ ] `packages/database/src/drizzle/schema/postgres.ts` → rewrite as the
      SQLite schema (rename file to `sqlite.ts`; update `schema/index.ts`).
      Conversions per design §Schema conversion:
      - `uuid().primaryKey().defaultRandom()` →
        `text().primaryKey().$defaultFn(() => crypto.randomUUID())`.
      - `pgEnum` → `text()` + `.check(sql\`channelType IN ('telegram','email')\`)`
        (use `CHANNEL_TYPE_VALUES` via a joined string).
      - `jsonb().$type<T>()` → `text({ mode: "json" }).$type<T>()`.
      - `numeric(14,2)` → `text()` (write `.toFixed(2)`; read via `Number()`
        — already the case).
      - `timestamp({ withTimezone:true }).defaultNow()` →
        `integer({ mode: "timestamp" }).default(sql\`(unixepoch())\`)`.
      - `uniqueIndex` / `index` → sqlite equivalents (same API).
- [ ] `packages/database/src/drizzle/schema/index.ts`: export from `./sqlite`
      + `./auth` (rename re-exports so call sites importing
      `@iris/database/drizzle/schema/postgres` are updated to `./sqlite`,
      OR keep a `postgres.ts` re-export for minimal churn — prefer rename +
      update call sites for clarity).
- [ ] `packages/database/src/drizzle/queries/*`: type imports from the new
      schema path. No query-logic change for `settings.ts`
      (`onConflictDoUpdate` works on sqlite). `users.ts` (`count`) works.
- [ ] `packages/auth/src/auth.ts`: `drizzleAdapter(db, { provider: "pg" })`
      → `{ provider: "sqlite" }`.
- [ ] **Verify better-auth schema fit:** `npx @better-auth/cli generate`
      against the converted schema + `provider:"sqlite"`, diff the generated
      auth tables against our `auth.ts`, reconcile type differences (esp.
      timestamp integer mode + nullability). Repeat until clean.
- [ ] Regenerate migrations: delete `packages/database/drizzle/migrations/`
      (old Postgres SQL), run `pnpm --filter @iris/database db:generate`
      (produces fresh SQLite `0000_initial.sql`). Update `meta/_journal.json`
      `dialect` → `"sqlite"` (drizzle-kit writes this).
- [ ] `packages/database/drizzle.config.ts`: `dialect: "sqlite"`,
      `dbCredentials: { url: getEnv().DATABASE_PATH }` (or read `DATABASE_PATH`
      from env).
- [ ] **Validate:** `pnpm --filter @iris/database typecheck`;
      `pnpm --filter @iris/database lint`; `pnpm --filter @iris/database
      db:generate` (regenerates migration); manual `db:migrate` against a
      scratch `:memory:` or temp file DB to confirm schema applies.

### 3. Remove Redis

- [ ] `packages/utils/src/lib/redis.ts`: delete file.
- [ ] `packages/utils/src/index.ts`: remove `export * from "./lib/redis"`.
- [ ] `packages/utils/package.json`: remove `ioredis` dep.
- [ ] `packages/auth/package.json`: remove `ioredis` dep.
- [ ] `packages/auth/src/lib/session-cache.ts`: rewrite — drop the Redis
      cache-aside; `getSessionWithCache` becomes a thin wrapper calling
      `auth.api.getSession({ headers })` and returning `{ session, fromCache:
      false }`. Keep the export name + return shape so `procedures.ts` import
      is unchanged (or rename to `getSession` and update the one import —
      prefer minimal: keep the name, simplify the body). Remove
      `invalidateSessionCache` and its export from `index.ts`.
- [ ] **Validate:** `pnpm --filter @iris/auth typecheck`;
      `pnpm --filter @iris/auth lint`; `pnpm --filter @iris/utils typecheck`.

### 4. Scheduler — drop Redis lock, fix due-query SQL

- [ ] `packages/prices/src/scheduler/scheduler.ts`:
  - [ ] Remove `getRedis` import. Remove the `redis.set(LOCK_KEY,...NX...)`
        acquire + the `redis.eval(releaseScript...)` release + `LOCK_KEY`.
  - [ ] Keep the `tickInProgress` in-process guard.
  - [ ] Remove `lockTtlSeconds` from `SchedulerOptions` + the
        `getEnv().SCHEDULER_LOCK_TTL_SECONDS` read.
  - [ ] `findDueProducts`: replace the Postgres `make_interval` SQL with
        SQLite: `sql\`${products.lastCheckedAt} IS NULL OR
        ${products.lastCheckedAt} < unixepoch() -
        COALESCE(${products.pollIntervalMinutes}, ${defaultIntervalMinutes})
        * 60\``. Keep the keyset cursor (`gt(products.id, cursorId)`).
- [ ] **Validate:** `pnpm --filter @iris/prices typecheck`;
      `pnpm --filter @iris/prices lint`.

### 5. checkPrice — per-product in-process mutex (replace `FOR UPDATE`)

- [ ] `packages/prices/src/pipeline/check-price.ts`:
  - [ ] Add module-level `const inflight = new Map<string, Promise<CheckPriceResult>>()`.
  - [ ] At the top of `checkPrice(productId)`: if `inflight.has(productId)`,
        `return inflight.get(productId)!`. Otherwise create the promise, store
        it, run the existing body in a `try/finally` that deletes the map
        entry. (Single-flight, same result.)
  - [ ] Remove `.for("update")` from the `tx.select()` (SQLite has no row
        lock; the mutex + transaction cover it).
- [ ] **Validate:** `pnpm --filter @iris/prices typecheck`;
      `pnpm --filter @iris/prices lint`.

### 6. Next config / instrumentation — minor

- [ ] `apps/web/next.config.ts`: in `serverExternalPackages`, add
      `better-sqlite3` (native module — must stay external, not bundled).
      Remove any `pg` reference (none currently). `ioredis` already absent
      after §3 — confirm it's not listed.
- [ ] `apps/web/instrumentation.ts` / `instrumentation-node.ts`: no change
      (scheduler start path unchanged; it just no longer touches Redis).
- [ ] **Validate:** `pnpm --filter @iris/web typecheck`.

### 7. Root scripts

- [ ] `package.json`: `db:generate`/`db:migrate`/`db:seed`/`db:studio` already
      filter `@iris/database` — unchanged. Confirm `lint`/`typecheck`/`build`
      still cover all packages (they do).

### 8. Dockerfile + supervision + compose

- [ ] Rewrite root `Dockerfile` per design §Dockerfile (multi-stage: `deps`,
      `build`, `runtime`). Install Node deps + Python camoufox (pip + `camoufox
      fetch`) in `deps`; build Next in `build`; runtime installs GTK/NSS apt
      libs + `python3` + `supervisor` + `wget`, copies built artifacts +
      camoufox browser + `server.py`, `VOLUME /app/data`, `CMD supervisord`.
- [ ] Write `supervisord.conf` (design §Process supervision): `camoufox`
      program (uvicorn 127.0.0.1:8000, priority 10) + `iris-app` program
      (priority 20). Logs → stdout/stderr.
- [ ] Rewrite `docker-entrypoint.sh` → `iris-app-start` wrapper: ensure
      `/app/data`, run `pnpm db:migrate` (local), wait for
      `http://127.0.0.1:8000/health` 200 (loop), then `exec pnpm --filter
      @iris/web start`. No DB-wait loop (SQLite is a file).
- [ ] Collapse `docker-compose.yml` to the single `app` service (design
      §docker-compose collapsed): one `iris-data` volume → `/app/data`,
      `DATABASE_PATH=/app/data/iris.db`, `CAMOUFOX_SIDECAR_URL=http://127.0.0.1:8000`,
      healthcheck on `/api/rpc/health/check`. Delete `postgres`/`redis`/
      `camoufox` services + their volumes.
- [ ] Update `.dockerignore`: add `data/`; keep existing ignores. Remove
      now-irrelevant entries if any.
- [ ] Remove `camoufox/Dockerfile` + `camoufox/.dockerignore` (the sidecar
      no longer builds standalone; its `server.py` is COPYed into the root
      build). **Keep** `camoufox/server.py` (source).
- [ ] **Validate:** `docker compose build app` succeeds (no build-arg
      placeholders missing); `docker compose up -d` brings the container up;
      `docker compose exec app wget -qO- http://localhost:8000/health` → ok;
      `curl localhost:3000/api/rpc/health/check` → ok.

### 9. Docs

- [ ] `README.md` + `README.zh-CN.md`: rewrite Quick start (single
      `docker compose up --build -d`), Local development (SQLite file + local
      camoufox or `docker compose up app`), Stack table (Postgres → SQLite,
      remove Redis row), Repository layout (camoufox now in-image), Config
      table (remove DATABASE_URL/REDIS_URL/POSTGRES_*/SCHEDULER_LOCK_TTL_*/
      CAMOUFOX_SIDECAR_URL from user-facing table — it's internal now; add
      DATABASE_PATH).
- [ ] `.env.example`: finalized in §1; re-check it matches README config table.
- [ ] **Validate:** re-read both READMEs top-to-bottom for consistency.

### 10. End-to-end smoke

- [ ] Fresh `docker compose up --build -d` from clean state (no `iris-data`
      volume) → container healthy.
- [ ] Sign in (magic link) → session created in SQLite.
- [ ] Add a product (e.g. a kogan/noelleeming URL) → Camoufox fetches via
      loopback → AI extracts → price stored in SQLite, reading inserted.
- [ ] Scheduler tick fires (or admin "Run checks") → re-check works; no
      duplicate readings.
- [ ] Restart container (`docker compose restart`) → SQLite data persists
      via volume; scheduler resumes.
- [ ] Kill the camoufox process inside the container (`docker compose exec
      app pkill -f uvicorn`) → supervisord restarts it; next fetch succeeds.

## Validation commands (cumulative)

```bash
# Per-package, after each section
pnpm --filter @iris/utils typecheck
pnpm --filter @iris/database typecheck && pnpm --filter @iris/database lint
pnpm --filter @iris/auth typecheck && pnpm --filter @iris/auth lint
pnpm --filter @iris/prices typecheck && pnpm --filter @iris/prices lint
pnpm --filter @iris/web typecheck && pnpm --filter @iris/web lint
# Monorepo
pnpm typecheck && pnpm lint && pnpm build
# DB regenerate + apply against scratch file
pnpm --filter @iris/database db:generate
DATABASE_PATH=./data/scratch.db pnpm --filter @iris/database db:migrate
DATABASE_PATH=./data/scratch.db pnpm db:seed
# Container
docker compose build app
docker compose up -d
```

## Risky files / rollback points

| File / area | Risk | Rollback note |
| --- | --- | --- |
| `packages/database/src/drizzle/schema/*` | Dialect rewrite; better-auth type fit | Generate + diff better-auth schema before migrate; revert file if migrate fails |
| `packages/database/src/drizzle/client.ts` | Driver swap; WAL/FK pragmas | Test against `:memory:` first |
| `packages/auth/src/auth.ts` (`provider:"sqlite"`) + auth schema | better-auth sqlite mismatch | `@better-auth/cli generate` diff gate |
| `check-price.ts` mutex | Lost `FOR UPDATE` semantics | Mutex is in-process only; fine for single container; revisit if multi-replica |
| `scheduler.ts` SQL | Postgres `make_interval` → sqlite `unixepoch()` | Test `findDueProducts` against a seeded scratch DB |
| root `Dockerfile` | Multi-stage + 2 runtimes + GTK apt set | Build early in §8; iterate on build errors; keep `camoufox/Dockerfile` until the new image builds |
| `docker-compose.yml` | Drops 3 services | Keep the old file in git history; revert is a `git revert` |

## Follow-up before `task.py start`

- [ ] PRD converged (no open blocking questions).
- [ ] `design.md` + this `implement.md` written.
- [ ] Curate `implement.jsonl` + `check.jsonl` with real spec entries
      (database.md / authentication.md / deployment.md / performance.md).
- [ ] User explicitly approves this planning summary.

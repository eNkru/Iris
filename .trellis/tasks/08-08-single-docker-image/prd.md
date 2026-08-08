# Single all-in-one Docker image

## Goal

Collapse Iris's deployment into **one Docker image, one container, no
external stateful services**, sized for a single-user (or near-single-user)
self-hosted deployment. Postgres and Redis are unjustifiable operational
weight at that scale; SQLite (file DB) and in-process guards replace them,
and the Camoufox fetch sidecar folds into the same image under a process
supervisor.

End state: `docker compose up --build -d` brings up the whole app — web
server, in-process scheduler, anti-detect browser fetch transport, and file
database — in a single container with a single data volume.

## Background — current architecture (4 Compose services, 2 custom images)

Confirmed from `docker-compose.yml`, `Dockerfile`, `camoufox/Dockerfile`,
`camoufox/server.py`, `apps/web/instrumentation.ts`, `fetch-page.ts`,
`packages/database/src/drizzle/*`, `packages/auth/src/*`,
`packages/prices/src/scheduler/*`, and archived design docs
(`07-31-price-tracker`, `08-04-anti-bot-hard-challenge-bypass`,
`08-06-camoufox-sidecar-self-heal`):

| Service | Base | Built from source? | Role |
| --- | --- | --- | --- |
| `app` | `node:22-bookworm-slim` | yes (`./Dockerfile`) | Next.js web server + **in-process scheduler** (instrumentation.ts, R14). Single-stage; keeps dev tooling (drizzle-kit, tsc). Needs Node + wget. |
| `camoufox` | `python:3.12-slim` | yes (`./camoufox/Dockerfile`) | FastAPI holding ONE shared `AsyncCamoufox` anti-detect Firefox — the single fetch transport. Bundles a full Firefox fork + GTK/NSS/X11/GL/font libs. `POST /v1/fetch`, `GET /health`. Self-heals by recreating the browser after 3 consecutive failures. |
| `postgres` | `postgres:16-alpine` | no (official) | app data + better-auth tables. Migrations run on app start. |
| `redis` | `redis:7-alpine` | no (official) | session cache + scheduler distributed lock. |

Confirmed facts:

- `app` (Node/Next.js) and `camoufox` (Python/FastAPI) are **different
  language runtimes**. The app reaches the sidecar over HTTP
  (`CAMOUFOX_SIDECAR_URL`, required + validated by `envSchema` at build and
  runtime — AC5). Today `http://camoufox:8000` on the Compose network.
- The scheduler already runs **in-process** in the Next.js node process
  (instrumentation.ts). The app process already does two jobs (web + worker).
- The sidecar split was deliberate (`08-04` design): (1) crash isolation —
  a browser crash can't kill the app; (2) smaller app image; (3) Camoufox is
  Python, the app is Node. `server.py` is self-contained (one file, stdlib
  logging, no DB/Redis access) — a pure HTTP fetch service.
- DB: Drizzle `node-postgres` + `pg`; schema in `pgTable` with
  `pgEnum`/`jsonb`/`numeric(14,2)`/`uuid().defaultRandom()`/`timestamp({withTimezone:true})`.
  better-auth uses `drizzleAdapter(db, { provider: "pg" })`.
- Redis serves exactly two roles, both non-essential at single-user scale:
  (1) **scheduler distributed lock** (`SET NX EX` + Lua compare-and-delete)
  — only matters with multiple app replicas; (2) **session cache-aside**
  (`session-cache.ts`) — already falls back to the DB on any Redis failure.
- `check-price.ts` uses `SELECT ... FOR UPDATE` inside a short transaction to
  prevent duplicate readings when a scheduler tick and a manual `checkNow`
  race on the same product. Network/AI calls run outside the transaction.

## Requirements

### R1 — Single image, single container

- Produce ONE Docker image (one Dockerfile) containing the app (Node/Next.js)
  and the Camoufox fetch transport (Python/FastAPI). A process supervisor
  starts and monitors both. Deployment is one container + one data volume;
  Postgres and Redis are gone.

### R2 — SQLite replaces Postgres

- All app + better-auth data lives in a single SQLite file on a volume.
  Driver: `better-sqlite3` (better-auth-recommended; prebuilt for
  linux/x64 and arm64 — the only target archs, constrained by Camoufox).
  Drizzle `better-sqlite3` driver replaces `node-postgres`.

### R3 — Redis removed

- The scheduler distributed lock is removed (single process → no replicas →
  the lock is dead weight; the existing in-process `tickInProgress` guard
  remains). The session cache-aside is removed (`auth.api.getSession` against
  SQLite is cheap and local). `ioredis` dependency deleted.

### R4 — No contract / behaviour change

- The fetch transport contract (`POST /v1/fetch`, `GET /health`), the app's
  oRPC API surface, better-auth magic-link auth, the scheduler tick cadence,
  alert dispatch, and all product workflows are unchanged. The app's HTTP
  client (`fetch-page.ts`) is untouched — `CAMOUFOX_SIDECAR_URL` just points
  at loopback.

### R5 — Concurrency correctness preserved without DB row locks

- SQLite has no `SELECT ... FOR UPDATE`. The duplicate-reading guarantee
  (no two checks of the same product record a reading twice) is preserved
  via an in-process per-product mutex in `checkPrice`, covering the only
  realistic concurrency (a scheduler tick + a manual `checkNow` in the same
  process).

### R6 — Deployment simplicity

- A user brings up a working Iris with `docker compose up --build -d`
  (one service, one volume). README + `.env.example` reflect the new shape.

### R7 — Operational parity

- Healthchecks, restart-on-failure, logs, and data persistence are
  preserved or improved. A crashed child process (browser/sidecar) restarts
  without taking down the app; the existing Camoufox self-heal is preserved.

## Acceptance Criteria

- [ ] AC1: A single Docker image builds from one Dockerfile.
- [ ] AC2: `docker compose up --build -d` brings up Iris in one container
      with one data volume; no Postgres or Redis service is started.
- [ ] AC3: App data + better-auth tables live in a SQLite file under the
      volume; data survives `docker compose restart` / `docker compose down`.
- [ ] AC4: All product workflows work end-to-end (add product → Camoufox
      fetches via loopback → AI extracts → price stored, reading inserted →
      alert dispatched) with no contract change.
- [ ] AC5: A scheduler tick + a concurrent manual `checkNow` on the same
      product produce no duplicate `price_readings` row (in-process mutex).
- [ ] AC6: Killing the camoufox/uvicorn process inside the container causes
      supervisord to restart it; the next fetch succeeds without restarting
      the app process.
- [ ] AC7: Healthcheck on `/api/rpc/health/check` reflects real app
      readiness; logs from both processes are distinguishable in
      `docker logs`.
- [ ] AC8: `pnpm typecheck && pnpm lint && pnpm build` pass across the
      monorepo; `better-sqlite3` is in `serverExternalPackages`.
- [ ] AC9: `@better-auth/cli generate` against the converted SQLite schema
      reconciles with our auth tables (no better-auth schema mismatch).
- [ ] AC10: README + `.env.example` reflect the single-container, SQLite,
      no-Redis deployment shape.

## Out of scope

- Automated row-level Postgres → SQLite data migration (fresh schema
  generation; existing tracked products are re-added — single-user scale).
- Embedded Postgres/Redis inside the image (rejected — the goal is to remove
  them).
- Re-implementing Camoufox in Node to drop Python (rejected — high effort,
  loses engine-level anti-detect Firefox).
- Multi-arch beyond linux x64/arm64 (Camoufox constrains this already).
- Kubernetes / non-Compose orchestration.
- Multi-replica horizontal scaling (Redis lock existed for this; single
  container makes it moot; an external lock could be re-introduced later).
- Changing the fetch transport contract, AI pipeline, auth flow, alert
  rules, or product business logic.

## Key decisions

| Decision | Choice | Date |
| --- | --- | --- |
| DB | SQLite (`better-sqlite3` driver) replaces Postgres | 2026-08-08 |
| Cache/lock | Redis removed entirely | 2026-08-08 |
| Image scope | App + Camoufox in one supervised image (Postgres/Redis gone, not embedded) | 2026-08-08 |
| Process supervisor | `supervisord` (simple, good logs, apt-installable) | 2026-08-08 |
| Concurrency | In-process per-product mutex replaces `FOR UPDATE` | 2026-08-08 |
| Data migration | Fresh SQLite schema; no automated row migration | 2026-08-08 |

## Technical notes (non-design detail)

- Env swap: `DATABASE_URL` (pg URL) → `DATABASE_PATH` (file path, default
  `./data/iris.db`); remove `REDIS_URL` + `SCHEDULER_LOCK_TTL_SECONDS`;
  `CAMOUFOX_SIDECAR_URL` runtime default → `http://127.0.0.1:8000`.
- SQLite pragmas at client init: `journal_mode=WAL` (readers don't block the
  writer) + `foreign_keys=ON` (schema relies on `ON DELETE cascade`).
- Schema conversions (pg → sqlite) are detailed in `design.md` §Schema
  conversion: `uuid().defaultRandom()` → `text().$defaultFn(crypto.randomUUID)`,
  `pgEnum` → `text()` + CHECK, `jsonb.$type<T>` → `text({mode:"json"}).$type<T>`
  (Drizzle auto-serdes), `numeric(14,2)` → `text()` (write `.toFixed(2)`),
  `timestamp` → `integer({mode:"timestamp"}).default(sql\`(unixepoch())\`)`.
- better-auth schema fit is the riskiest step — gate it with
  `@better-auth/cli generate` + diff before migrating.
- Scheduler due-query SQL: Postgres `make_interval(mins=>…)` → SQLite
  `unixepoch() - COALESCE(pollIntervalMinutes, ?) * 60`.
- Single image carries Node + Python + Firefox + GTK lib stack; larger than
  today's app image but only one image to pull. Multi-stage build prunes
  build-only layers where safe; runtime keeps `python3` (uvicorn/camoufox).
- Supervisord logs both programs to stdout/stderr with program-name prefixes.

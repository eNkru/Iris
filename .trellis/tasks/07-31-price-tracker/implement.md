# Price tracking & alert app — Implementation Plan

## Order of Implementation

1. **Scaffold monorepo**
   - pnpm workspace: `apps/web` (Next.js 15), `packages/database` (Drizzle), `packages/auth`, `packages/api` (oRPC router), `packages/utils`.
   - TypeScript strict, TailwindCSS 4, ESLint, env validation (`zod` on `process.env`).
   - Validation: `pnpm build` + `pnpm typecheck`.

2. **Database schema + migrations**
   - better-auth tables (Drizzle adapter) + app tables per design.md (`products`, `price_readings`, `alert_channels`, `user_settings`, `global_settings`).
   - Seed `global_settings` singleton row.
   - Validation: `pnpm db:migrate` against local Postgres (docker compose `postgres`).

3. **Auth (magic link)**
   - better-auth config with `magicLink` plugin + SMTP send; `getSession`; first-user-becomes-admin bootstrap.
   - Validation: manual login flow returns session cookie; user row has `role=admin` on first sign-in.

4. **Price-check pipeline service**
   - `fetchPage` (timeout, UA, p-limit, retry/backoff), `aiExtractPrice` (generateObject + Zod + telemetry), `checkPrice(productId)` orchestration per design.md.
   - Validation: unit test on fixtures + local run against one URL returns a price reading.

5. **Scheduler**
   - In-process loop + Redis lock + due-query + chunked concurrency.
   - Validation: two app instances don't double-process (lock); interval respected.

6. **Notification channels**
   - Channel interface + telegram adapter (`sendMessage` via Bot API); CRUD for `alert_channels`; threshold evaluation in `checkPrice`.
   - Validation: price change triggers a Telegram message to bound chatId.

7. **oRPC API layer**
   - Procedures per design.md surface (`products.*`, `channels.*`, `settings.*`, `admin.*`, `history.*`), protected/admin middleware, Zod input/output schemas.
   - Validation: `pnpm typecheck` + API smoke tests.

8. **Frontend**
   - Login page (magic link), product list + add-URL form, product detail with Recharts trend chart + time-range selector (nuqs), settings pages (channels, user, admin global config).
   - Validation: full user flow through UI against dev backend.

9. **Docker Compose + deployment**
   - `Dockerfile` (single stage for web+scheduler), `docker-compose.yml` (app/postgres/redis), `.env.example`, healthchecks.
   - Validation: `docker compose up` on NAS-style env; scheduler runs; alerts deliver.

10. **Hardening**
    - Structured logging (no console.log), error handling, session caching, pre-commit checklist per `backend/quality.md`.

## Validation Commands

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm db:migrate
pnpm test          # unit tests for pipeline + scheduler logic
docker compose up  # end-to-end validation
```

## Review Gates

- After step 3: auth flow verified manually → mark gate 1 passed.
- After step 6: full alert path (check → change → telegram) verified → gate 2.
- After step 8: UI end-to-end → gate 3.
- After step 9: compose up clean on target NAS → gate 4.

## Rollback Points

- Steps 1–3: reversible by reverting scaffold; no production data.
- Steps 4–6: feature-flag or disable scheduler loop via env; existing data unaffected.
- Steps 7–9: compose down + previous image tag; migrations additive/nullable.

## Follow-up Checks Before `task.py start`

- [ ] PRD convergence pass done (blocking open questions empty).
- [ ] Spec files loaded per package before implementation (`trellis-before-dev`).
- [ ] `implement.jsonl` / `check.jsonl` curated with real spec entries (sub-agent manifest).

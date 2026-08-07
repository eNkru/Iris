# Iris

Self-hosted price tracking & alert app. Add products, let Iris watch their prices, and get notified when something changes.

![Iris dashboard](docs/screenshot.png)

## Features

- **Product dashboard** — track products with current price, price history charts, and per-product status (OK / needs attention / blocked)
- **Price-drop alerts** — configurable alert rules evaluated on every price check
- **Alert channels** — Email and Telegram notifications, plus periodic summaries
- **AI-powered extraction** — prices are extracted from product pages by any OpenAI-compatible model (OpenAI, OpenRouter, a local Ollama server, …); instance-level AI settings are admin-editable at runtime
- **Anti-bot fetching** — pages are fetched through a [Camoufox](https://camoufox.com) sidecar (anti-detect Firefox), the single fetch transport, so pages behind DataDome / Cloudflare / Akamai challenges still work
- **Magic-link auth** — email magic-link login via better-auth, with a bootstrapped admin user
- **Scheduler** — in-process scheduler loop with a Redis distributed lock, so multiple app replicas never double-process the same product

## Stack

| Layer | Tech |
| --- | --- |
| Web app | Next.js 15, React 19, Tailwind CSS v4, TanStack Query, Recharts |
| API | oRPC + Zod |
| Auth | better-auth (magic link, SMTP) |
| Database | PostgreSQL 16 + Drizzle ORM |
| Cache / locks | Redis 7 (session cache, scheduler lock) |
| Price pipeline | Camoufox fetch sidecar + AI SDK (OpenAI-compatible) |
| Notifications | SMTP (nodemailer), Telegram Bot API |

## Repository layout

pnpm monorepo (pnpm ≥ 11, Node ≥ 20):

```
apps/
  web/            Next.js app — UI, oRPC client, in-process scheduler entrypoint
packages/
  api/            oRPC router, procedures, middleware
  auth/           better-auth setup, SMTP magic-link mailer, session cache, admin bootstrap
  database/       Drizzle schema, migrations, queries, seed script
  prices/         price pipeline (fetch → AI extract → alert rules), scheduler, notifications
  utils/          shared helpers, env validation, redis client
camoufox/         Camoufox fetch sidecar (Python service, runs as its own container)
```

## Quick start (Docker)

The fastest way to run Iris — one command brings up the app, the Camoufox sidecar, Postgres, and Redis. Migrations run automatically on app start.

```bash
cp .env.example .env   # adjust secrets (BETTER_AUTH_SECRET, SMTP, AI_API_KEY, …)
docker compose up --build -d
```

Then open <http://localhost:3000>.

> The Camoufox sidecar is a required dependency: the app reads `CAMOUFOX_SIDECAR_URL` and fails fast with a logged error if the sidecar is down rather than silently misbehaving.

## Local development

```bash
pnpm install

# start Postgres + Redis + the Camoufox sidecar (reusable standalone)
docker compose up postgres redis camoufox

# copy and adjust your environment
cp .env.example .env

# run migrations (idempotent) and optional seed data
pnpm db:migrate
pnpm db:seed

# start the Next.js dev server (http://localhost:3000)
pnpm dev
```

### Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start the web app in dev mode |
| `pnpm build` | Build all packages |
| `pnpm typecheck` | Typecheck all packages |
| `pnpm lint` | Lint all packages |
| `pnpm db:generate` | Generate Drizzle migrations from the schema |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:seed` | Seed the database |
| `pnpm db:studio` | Open Drizzle Studio |

## Configuration

Copy `.env.example` to `.env` and adjust. The important ones:

| Variable | Description |
| --- | --- |
| `APP_URL` | Public URL of the app (used in magic-link emails) |
| `BETTER_AUTH_SECRET` | Session signing secret — always override in production (`openssl rand -base64 32`) |
| `DATABASE_URL` | Postgres connection string |
| `REDIS_URL` | Redis connection string (session cache + scheduler lock) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | SMTP server for magic-link login emails |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | Any OpenAI-compatible endpoint; build-time fallbacks — instance-level settings are admin-editable at runtime |
| `TELEGRAM_BOT_TOKEN` | Telegram bot for the alert channel |
| `SCHEDULER_TICK_MS` | How often the scheduler looks for due products (default 30 s) |
| `SCHEDULER_LOCK_TTL_SECONDS` | Redis lock TTL so concurrent replicas don't double-process (default 60 s) |
| `CAMOUFOX_SIDECAR_URL` | Camoufox sidecar URL (required). `http://localhost:8000` for `pnpm dev`, `http://camoufox:8000` inside Compose |

## Special Thanks

Special thanks to [LINUX DO](https://linux.do).

## License

[GPL-3.0](LICENSE)

# Iris

Self-hosted price tracking & alert app. Add products, let Iris watch their prices, and get notified when something changes.

![Iris dashboard](docs/screenshot.png)

## Features

- **Product dashboard** — track products with current price, price history charts, and per-product status (OK / needs attention / blocked)
- **Price-drop alerts** — configurable alert rules evaluated on every price check
- **Alert channels** — Email and Telegram notifications, plus periodic summaries
- **AI-powered extraction** — prices are extracted from product pages by any OpenAI-compatible model (OpenAI, OpenRouter, a local Ollama server, …); instance-level AI settings are admin-editable at runtime
- **Anti-bot fetching** — pages are fetched through [Camoufox](https://camoufox.com), supervised inside the same container as the app, so pages behind DataDome / Cloudflare / Akamai challenges still work
- **Magic-link auth** — email magic-link login via better-auth, with a bootstrapped admin user
- **Scheduler** — an in-process scheduler loop with a per-product single-flight guard

## Stack

| Layer | Tech |
| --- | --- |
| Web app | Next.js 15, React 19, Tailwind CSS v4, TanStack Query, Recharts |
| API | oRPC + Zod |
| Auth | better-auth (magic link, SMTP) |
| Database | SQLite + Drizzle ORM + better-sqlite3 |
| Runtime | One Node/Python image supervised by supervisord |
| Price pipeline | Camoufox fetch service + AI SDK (OpenAI-compatible) |
| Notifications | SMTP (nodemailer), Telegram Bot API |

## Repository layout

pnpm monorepo (pnpm ≥ 11, Node ≥ 20):

```
apps/
  web/            Next.js app — UI, oRPC client, in-process scheduler entrypoint
packages/
  api/            oRPC router, procedures, middleware
  auth/           better-auth setup, SMTP magic-link mailer, admin bootstrap
  database/       SQLite Drizzle schema, migrations, queries, seed script
  prices/         price pipeline (fetch → AI extract → alert rules), scheduler, notifications
  utils/          shared helpers and environment validation
camoufox/         Camoufox HTTP fetch service source (runs inside the image)
Dockerfile        Single image for Node, Python, and Camoufox
supervisord.conf  Supervises the web app and Camoufox processes
```

## Quick start (Docker)

The recommended deployment is one container with one persistent SQLite volume. The image runs the Next.js app, scheduler, and Camoufox fetch service under supervisord; migrations run automatically on startup.

```bash
cp .env.example .env   # adjust secrets (BETTER_AUTH_SECRET, SMTP, AI_API_KEY, …)
docker compose up --build -d
```

Then open <http://localhost:3000>. All application data is stored in the `iris-data` Docker volume.

## Local development

```bash
pnpm install
cp .env.example .env

# create/update ./data/iris.db
pnpm db:migrate
pnpm db:seed

# run the Camoufox service separately in a Python environment
# (or use `docker compose up --build -d` for the complete stack)
cd camoufox
python -m pip install camoufox fastapi uvicorn
camoufox fetch
uvicorn server:app --host 127.0.0.1 --port 8000

# in another terminal, from the repository root
pnpm dev
```

For a production-like local run, use `docker compose up --build -d`; no Postgres, Redis, or standalone sidecar containers are required.

### Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start the web app in dev mode |
| `pnpm build` | Build all packages |
| `pnpm typecheck` | Typecheck all packages |
| `pnpm lint` | Lint all packages |
| `pnpm db:generate` | Generate SQLite Drizzle migrations |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:seed` | Seed the database |
| `pnpm db:studio` | Open Drizzle Studio |

## Configuration

Copy `.env.example` to `.env` and adjust. The important ones:

| Variable | Description |
| --- | --- |
| `APP_URL` | Public URL of the app (used in magic-link emails) |
| `BETTER_AUTH_SECRET` | Session signing secret — always override in production (`openssl rand -base64 32`) |
| `DATABASE_PATH` | SQLite database path (default `./data/iris.db`; Docker uses `/app/data/iris.db`) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | SMTP server for magic-link login emails |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | Any OpenAI-compatible endpoint; instance-level settings are admin-editable at runtime |
| `TELEGRAM_BOT_TOKEN` | Telegram bot for the alert channel |
| `SCHEDULER_TICK_MS` | How often the scheduler looks for due products (default 30 s) |
| `CAMOUFOX_SIDECAR_URL` | Fetch service URL for local development; Docker sets this internally to `http://127.0.0.1:8000` |

Existing Postgres data is not migrated automatically. Re-add tracked products or perform a deliberate manual export/import before switching deployments.

## Special Thanks

Special thanks to [LINUX DO](https://linux.do).

## License

[GPL-3.0](LICENSE)

# Price tracking & alert app — Design

## Architecture Overview

Next.js 15 full-stack monolith in one container (satisfies "Node.js backend + React frontend" per the existing Trellis spec stack). Two runtime modes in the same process:

- **Web**: Next.js server handling UI + oRPC API routes + better-auth.
- **Scheduler**: a long-running in-process loop (started when the app boots) that picks due products and runs the price-check pipeline.

```
+-------------------------------------------------------------+
|              Single Next.js container (mode: web+scheduler)   |
|  Frontend (React + React Query + charts)                     |
|  oRPC procedures (protected)                                 |
|  price-check pipeline service                                |
|  scheduler loop (due products -> checkPrice)                 |
|  notification channel registry (telegram)                    |
|  better-auth (magic link)                                    |
+----------+---------------------+-----------------------------+
           |                     |
      PostgreSQL                Redis
   (app tables + auth)   (session cache, scheduler locks)
```

Deployment: Docker Compose with three services — `app` (the Next.js container, runs web + scheduler), `postgres`, `redis`.

## Data Model (Drizzle + PostgreSQL)

### `products`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| userId | uuid FK → user | per-user isolation |
| url | text | the shop product URL |
| name | text | filled from first successful AI visit |
| currency | text | from AI extraction (e.g. CNY, USD) |
| currentPrice | numeric | latest known price |
| lastCheckedAt | timestamptz | drives scheduler due-ness (R7) |
| pollIntervalMinutes | int | per-product override; null = use global default (R7) |
| alertRules | jsonb | `{ anyChange?: true, risePct?: n, fallPct?: n, riseAbs?: n, fallAbs?: n }` (R10) |
| active | boolean | user can pause tracking |
| createdAt / updatedAt | timestamptz | |

### `price_readings`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| productId | uuid FK → products | |
| price | numeric | |
| currency | text | snapshot of currency at reading |
| checkedAt | timestamptz | when the reading was captured |

Insert **only on price change** (R9). `products.currentPrice` = most recent `price_readings` row; trend chart reads this table as a change-point series.

### `alert_channels`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| userId | uuid FK → user | |
| channelType | enum `telegram` \| `email` | registry enum (R11) |
| config | jsonb | per-channel config, e.g. `{ chatId }` for telegram |
| enabled | boolean | |
| createdAt / updatedAt | timestamptz | |

`(userId, channelType)` unique. Adding email later = new enum value + row (R12).

### `user_settings`
| Column | Type | Notes |
|---|---|---|
| userId | uuid PK → user | |
| aiModelOverride | jsonb nullable | reserved per-user model override; null = global (R6) |
| pollIntervalDefaultMinutes | int | global default interval override |

### `global_settings`
Singleton row (id=1).
| Column | Notes |
|---|---|
| aiProvider | `openai` \| `gemini` \| `anthropic` |
| aiModel | model id string |
| pollIntervalDefaultMinutes | default interval for all users |
| telegramBotToken | used server-side; masked on read |

Auth tables (`user`, `session`, `account`, `verification`) managed by better-auth's Drizzle adapter.

## Price-Check Pipeline (`checkPrice(productId)`)

Synchronous, single unit called by both sync RPC and scheduler (R8):

1. `fetchPage(url)` — plain fetch with a realistic User-Agent, timeout, `p-limit` shared limiter, exponential backoff (spec: performance.md).
2. `aiExtractPrice(html, url)` — `generateObject` + Zod schema `{ price: number, currency: string, name?: string, available: boolean }` via the resolved model (global → user override). Telemetry enabled, functionId `prices.extract`.
3. Compare with `products.currentPrice`:
   - If extraction fails → log, record nothing, leave `lastCheckedAt` updated (retry next cycle). Optionally a per-product error counter for visibility.
   - If same price → update `lastCheckedAt` only (R9).
   - If changed → insert `price_readings`, update `products.currentPrice` + `lastCheckedAt` + `name`/`currency` if improved.
4. If changed → evaluate `alertRules` threshold (anyChange, rise/fall pct/abs). If threshold met → dispatch notification to each enabled `alert_channels` via the channel interface.

## Scheduler

- In-process loop: every N seconds (configurable, default 30s) query due products: `lastCheckedAt < now - pollIntervalMinutes` AND `active = true`.
- Guard with a Redis distributed lock (`prices:scheduler:lock`, TTL) so multiple replicas of the app container don't double-process (spec: performance.md).
- Process products in chunks, `p-limit` concurrency (default 5) against the AI/network limiter.
- No external cron dependency — self-contained in the app process (R14).

## Notification Channel Interface

```ts
interface NotificationChannel {
  channelType: "telegram" | "email";
  send(notification: PriceAlertNotification, config: Record<string, unknown>): Promise<void>;
}
```

Registry keyed by `channelType`; MVP implements `telegram` (Bot API `sendMessage`). SMTP/nodemailer is set up in MVP because magic-link requires it, so `email` adapter is a thin add later (R12).

## Auth

- better-auth `magicLink` plugin + Drizzle adapter. SMTP transport required for sending login links (outbound from NAS, so LAN-only is fine).
- `protectedProcedure` for all product/price/channel endpoints; `adminProcedure` for `global_settings` (R2).
- First user bootstrapping: on first successful login, if user table is empty → assign admin role.

## API Surface (oRPC)

| Procedure | Method | Auth | Purpose |
|---|---|---|---|
| `products.create` | POST | protected | Add URL; runs first synchronous check; returns current price |
| `products.list` | GET | protected | User's products + current prices |
| `products.get` | GET | protected | Product detail incl. history series |
| `products.update` | PATCH | protected | Poll interval, alert rules, pause |
| `products.delete` | DELETE | protected | |
| `products.checkNow` | POST | protected | Manual sync re-check |
| `channels.list/create/update/delete` | | protected | Alert channel CRUD |
| `settings.get/update` | | protected | User settings |
| `admin.globalSettings.get/update` | | admin | Global AI config + defaults |
| `history.byProduct` | GET | protected | Price readings for chart |

Frontend: React Query + oRPC client, chart via Recharts (line chart of `price_readings`). nuqs for time-range selector in URL (7d/30d/all).

## Trade-offs & Decisions

- **AI-driven price extraction over site scrapers** (R5): robust across arbitrary shops; cost/latency per check. Sync first-check UX trades a longer request for immediate feedback.
- **Insert-on-change history** (R9): compact storage, change-point chart semantics; requires `lastCheckedAt` on product (accepted).
- **Global → per-user AI config** (R6): simplest ops now, schema ready for per-user later.
- **Magic link over OAuth** (R1): LAN-only deployment; needs SMTP which is also the future email-alert transport.
- **In-process scheduler** (R14): one container, no extra service; Redis lock makes it safe if scaled later.
- **Telegram first, email later** (R12): channel registry keeps this an additive change.

## Compatibility & Rollback

- All changes land via Drizzle migrations; additive columns (alertRules, aiModelOverride) are backwards compatible.
- Rollback shape: compose down + restore previous image tag; schema is forward/backward tolerant because new columns are nullable/defaulted.
- `.env` holds secrets (AI key, Telegram bot token, SMTP creds, `APP_URL`, `DATABASE_URL`, `REDIS_URL`); not committed.

## Deferred / Out of Scope

- Headless-browser fallback for JS-heavy pages (prd Out of Scope).
- Email alert adapter implementation (SMTP transport exists; registry ready).
- Multi-currency conversion.
- OAuth.

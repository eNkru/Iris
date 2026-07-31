# Price tracking & alert app

## Goal

Build a full-stack app (Node.js backend + React frontend) that lets users track prices of products from online shops. The backend periodically visits each tracked product page, uses a configured AI model to extract the current price, stores readings in a database for trend history, and alerts the user when the price changes. Deployed on a private NAS.

## Background / Confirmed Facts

- Greenfield build; repository currently contains only Trellis scaffolding.
- Existing Trellis specs define the stack: Next.js 15 + React 19 + TypeScript (strict) + TailwindCSS 4 + oRPC + React Query + Drizzle ORM + PostgreSQL + better-auth + Vercel AI SDK (`.trellis/spec/backend/index.md`, `.trellis/spec/frontend/index.md`). This satisfies "Node.js backend + React frontend" as a Next.js full-stack monolith.
- AI SDK spec covers `generateObject` + Zod for structured extraction, providers OpenAI / Gemini / Anthropic, and telemetry (`.trellis/spec/backend/ai-sdk-integration.md`).
- better-auth spec covers email + magic link (passwordless) auth and admin roles (`.trellis/spec/backend/authentication.md`).

## Requirements

### Auth & users
- R1. Multi-user via email + magic link (passwordless) login using better-auth. NAS is LAN-only (no public URL), so OAuth is out of scope.
- R2. First user to sign in becomes admin.
- R3. All data (products, price history, alert channels, settings) isolated per user.

### Products & pricing
- R4. User can add a product by URL from an online shop.
- R5. Backend periodically visits each product page and extracts the current price using the configured AI model (URL-driven; no hardcoded site scrapers).
- R6. Instance-level global AI config (provider + API key) managed by admin. Resolution: global default → per-user override (per-user override reserved for later, schema-ready).
- R7. Polling interval configurable per product, with a configurable global default.
- R8. Price-check pipeline is synchronous: visit page → AI extract price → store → compare with last price → alert if changed.
- R9. Price history kept forever; a new reading is inserted only when the price changed from the previous check. Product stores `last_checked_at` separately to drive scheduling.

### Alerts
- R10. Per-product alert rules: default alert on any change; optional thresholds with rise and fall configured separately (percent and/or absolute amount).
- R11. Notification channels are a registry + adapters (`channel_type` enum + config JSONB in an `alert_channels` table); sending dispatches through a channel interface.
- R12. MVP notification channel: Telegram. Email infrastructure (SMTP) is set up in MVP because magic-link login needs it, so an email alert adapter can be added later without schema/API changes.

### Frontend
- R13. Frontend shows a price trend diagram from stored history (change-point curve, with a time-range selector).

### Deployment
- R14. Docker Compose on a private NAS: single application container (web server + background scheduler in one process) plus Postgres and Redis as separate Compose services.

## Acceptance Criteria

- [ ] AC1. A user can sign in via email magic link on a LAN-only deployment; the first user is marked admin.
- [ ] AC2. A signed-in user can add a product URL and sees the current price returned immediately (synchronous first check).
- [ ] AC3. The background scheduler checks each product at its configured interval and does not re-check before `last_checked_at + interval` elapses.
- [ ] AC4. A price reading is inserted into history only when the price differs from the previous reading; unchanged checks update `last_checked_at` only.
- [ ] AC5. When a tracked price changes, the user receives a Telegram notification; threshold rules (rise/fall, percent/absolute) are respected when configured.
- [ ] AC6. The product detail page renders a price trend chart whose data matches the stored history.
- [ ] AC7. Global AI config (provider + API key) is editable by admin and used by all users; a per-user override field exists in the schema (even if unused in UI).
- [ ] AC8. `docker compose up` brings up app + postgres + redis; price checks run without external services other than the configured AI provider and Telegram API.

## Out of Scope

- Google/GitHub OAuth (blocked by LAN-only deployment).
- Email as a price-alert channel in MVP (adapter architecture ready, SMTP present).
- Per-user AI model selection UI in MVP (schema field reserved).
- Headless-browser-based scraping fallback for JS-heavy pages that the AI cannot read from plain HTML.
- Multi-currency conversion.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.

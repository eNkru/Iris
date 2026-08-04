# Design — Camoufox-only fetch transport (sidecar)

## Problem

Plain Playwright Chromium cannot pass DataDome (kogan), Cloudflare managed
(noelleeming), or Akamai (farmers) product pages. `fetchPage` returns null →
`checkPrice` reports the generic "Page fetch failed", and `create` rolls the
product back. The prior Akamai verdict proved free/local JS-stealth fails; the
2026-08-04 Camoufox spike proved an engine-level anti-detect Firefox passes
all three.

Strategy decision (user, 2026-08-04): **Camoufox is the single fetch transport.**
Playwright/Chromium is removed from the app. The sidecar is required in all
environments.

## Goals

- AC1/AC2: kogan (DataDome), noelleeming (Cloudflare) add successfully.
- AC3: unsolvable sites report a specific anti-bot reason, never "Page fetch failed".
- AC4: currently-passing sites keep working.
- AC5: app boots only with `CAMOUFOX_SIDECAR_URL` set and sidecar reachable.
- Single transport: no dual-path orchestration anywhere.

## Architecture

```
┌───────────────────────── app container (Node/Next) ─────────────────────────┐
│  checkPrice → fetchPage(url)                                                  │
│    │ retry/backoff/pLimit/logging envelope (unchanged)                        │
│    │ → POST /v1/fetch {url}  ─────────────► sidecar (Python + Camoufox)       │
│    │ response {ok, html, url} | {ok:false, reason}                            │
│    │ detectBlockedPage(html) → ok | blocked | null                            │
│  ai-extract tool also calls fetchPage → same sidecar path                     │
└───────────────────────────────────────────────────────────────────────────────┘
```

`fetch-page.ts` stays the single global transport entry point. It no longer
imports Playwright; it is a thin HTTP client for the sidecar. No per-retailer
branch, no dual transport.

## Contracts

### `fetchPage` return type

```ts
type FetchPageResult =
  | { kind: "ok"; html: string; url: string }
  | { kind: "blocked"; signature: string } // challenge/deny page, no real content
  | null;                                  // transport failed after retries
```

`checkPrice` maps: `null` → "Page fetch failed"; `blocked` → specific anti-bot
message using `signature`.

Callers updated: `check-price.ts` (reads `.html` via ok branch) and
`ai-extract.ts` `buildFetchPageTool` (returns page text, a BLOCKED marker, or an
ERROR string).

### Camoufox sidecar HTTP API

- `POST /v1/fetch`, body `{ "url": string }`
- 200 → `{ "ok": true, "html": string, "url": string }`
- 200 → `{ "ok": false, "reason": "blocked" | "fetch_failed" }` (never throws)
- `GET /health` → 200 when the browser is ready

Sidecar holds ONE shared `AsyncCamoufox` browser launched at startup, fresh page
per request, concurrency bounded by an asyncio semaphore (default 5, matching the
old Playwright concurrency). Timeout ~45 s per request.

### Node sidecar client (`fetch-page.ts`, rewritten)

- Reads `CAMOUFOX_SIDECAR_URL` (required — see Config).
- `attemptSidecarFetch(url)`: `fetch` POST with `AbortSignal.timeout(45_000)`;
  on non-JSON / network error → `{ kind: "error", message }`.
- Keeps the existing retry / exponential-backoff / jitter envelope
  (`MAX_RETRIES = 3`) and the shared `pLimit(5)`.
- After an `ok` result, runs `detectBlockedPage(html)`; non-null → `blocked`.
- Structured logging preserved (`logger.warn/error` with url, productId).

### `fetchPage` orchestration

```
1. for attempt in 1..MAX_RETRIES:
     result = await attemptSidecarFetch(url)
     if result.kind === "ok":
        sig = detectBlockedPage(result.html)
        if sig === null → return { kind: "ok", html, url }
        else            → return { kind: "blocked", signature: sig }
     // status/network error → backoff and retry
2. return null   // transport failed
```

No challenge-detection-triggered fallback (there is no second transport).
`blocked-signatures.ts` still classifies returned HTML so AC3 holds.

### `blocked-signatures.ts` additions

DataDome and Cloudflare signature pages (confirmed live 2026-08-04; the real
kogan PDP contains none of these markers, so no false positives):

- `datadome-captcha`: HTML contains `captcha-delivery.com` (iframe src
  `geo.captcha-delivery.com` / script `ct.captcha-delivery.com`).
- `cloudflare-challenge`: HTML contains `_cf_chl_opt` or `cf-chl` or
  `challenges.cloudflare.com`, or title matches `/just a moment/i` with small
  HTML (< 5 KB).

## Config

- `env.ts`: `CAMOUFOX_SIDECAR_URL` **required** (`.url()`). This is the single
  transport, so a missing value is a hard config error at first use — matching
  `DATABASE_URL`'s behavior (AC5).
- `.env.example`: required, with comment explaining the sidecar must be running.
- `docker-compose.yml`: app gets `CAMOUFOX_SIDECAR_URL=http://camoufox:8000`;
  new `camoufox` service.

## Docker / deployment

New `camoufox/` sidecar service:

- `camoufox/Dockerfile`: `python:3.12-slim`, pip install `camoufox` + `fastapi`
  + `uvicorn`, run `camoufox fetch` at build (browser cached into the image,
  offline at runtime), copy `server.py`, CMD uvicorn. Architecture: Camoufox
  ships `linux/arm64` builds (confirmed in `pkgman.py` ARCH_MAP), so ARM NAS
  deployments work.
- `camoufox/server.py`: FastAPI app; lazy single `AsyncCamoufox`; semaphore;
  per-request fresh page + goto (`domcontentloaded`, 45 s) + `content()` +
  `page.url()`; returns JSON; logs via stdlib logging (sidecar is Python).
- `docker-compose.yml`: `camoufox` service (internal network only,
  `restart: unless-stopped`). App `depends_on: camoufox` (soft — app still boots
  if the sidecar is down, but fetches then fail loudly via logging).

### App image cleanup (Playwright removal)

- Remove `playwright`, `playwright-core`, `chromium-bidi` from `@iris/prices`
  and `@iris/web` package.json.
- Remove `playwright`, `playwright-core` from `apps/web/next.config.ts`
  `serverExternalPackages`.
- Remove `RUN pnpm --filter @iris/prices exec playwright install --with-deps
  chromium` from the app `Dockerfile` (browser deps now live in the sidecar
  image). App image gets smaller.
- `fetch-page.ts` rewritten to the sidecar client; Playwright import deleted.

## Local dev

`pnpm dev` requires the sidecar. Document in `.env.example` and add a
`docker-compose.yml` `camoufox` service usable standalone (`docker compose up
camoufox`). The README/dev docs note: run the sidecar before starting the app.

## Risks / rollback

- Single transport = single point of failure (accepted strategy decision).
  Detection still surfaces a specific reason on regression.
- Sidecar adds a second browser image + Python runtime; app image shrinks.
- Interactive-steering headroom is deferred; the sidecar API is designed to grow
  a click/navigate endpoint if a retailer requires interaction.
- Rollback: revert the PR to restore Playwright. No DB schema change.

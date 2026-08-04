# Implementation — Camoufox-only fetch transport (sidecar)

## Checklist

1. **Env config**
   - [ ] `packages/utils/src/lib/env.ts`: `CAMOUFOX_SIDECAR_URL` required
       (`z.string().url()`, like `DATABASE_URL`).
   - [ ] `.env.example`: add required `CAMOUFOX_SIDECAR_URL` with a comment
       (sidecar must be running; `docker compose up camoufox`).

2. **`blocked-signatures.ts`** — add DataDome + Cloudflare entries
   - [ ] Add `datadome-captcha`: `html.includes("captcha-delivery.com")`.
   - [ ] Add `cloudflare-challenge`: `_cf_chl_opt` / `cf-chl` /
       `challenges.cloudflare.com`, or title `/just a moment/i` + small HTML.
   - [ ] Keep the generic registry shape (id + predicate), no per-retailer code.

3. **`fetch-page.ts`** — rewrite as the sidecar client
   - [ ] Delete the Playwright import, `getBrowser`, `attemptPlaywrightFetch`,
       `pageFetchLimiter`-wrapped Chromium logic.
   - [ ] New `FetchPageResult` discriminated union
       (`ok` | `blocked` | null) from design.md.
   - [ ] `attemptSidecarFetch(url)`: POST `CAMOUFOX_SIDECAR_URL + /v1/fetch`
       with `AbortSignal.timeout(45_000)`; map JSON to ok/error; never throw.
   - [ ] Keep retry / exponential-backoff / jitter (`MAX_RETRIES = 3`,
       backoff helpers unchanged) and the shared `pLimit(5)`.
   - [ ] Run `detectBlockedPage` on ok HTML → `blocked` variant; else `ok`.
   - [ ] Structured logging preserved (`logger.warn/error` with url, productId).

4. **`check-price.ts`** — map new result
   - [ ] Handle `kind === "blocked"` → existing specific anti-bot failure
       message with `signature`; `null` → "Page fetch failed".
   - [ ] Keep the existing `detectBlockedPage` call on the final HTML (harmless
       double check, also covers future sidecar HTML edge cases).

5. **`ai-extract.ts`** — adapt `buildFetchPageTool`
   - [ ] Handle the `FetchPageResult` union: `ok` → `reducePageHtml`,
       `blocked` → "BLOCKED: <signature>", null → "ERROR: failed to fetch".

6. **Playwright removal from the app**
   - [ ] `packages/prices/package.json`: drop `playwright`, `playwright-core`,
       `chromium-bidi` (keep p-limit, zod, etc.).
   - [ ] `apps/web/package.json`: drop `playwright`, `playwright-core`.
   - [ ] `apps/web/next.config.ts`: remove `playwright`, `playwright-core`
       from `serverExternalPackages`.
   - [ ] `Dockerfile` (app): remove the `playwright install --with-deps
       chromium` step and the comment block referencing it.
   - [ ] `pnpm install` to refresh the lockfile.

7. **Camoufox sidecar**
   - [ ] `camoufox/server.py`: FastAPI app; lazy single `AsyncCamoufox`
       (headless); asyncio semaphore (5); `POST /v1/fetch`; `GET /health`;
       fresh page per request; goto `domcontentloaded`, 45 s timeout;
       `content()` + `page.url()`; stdlib logging.
   - [ ] `camoufox/Dockerfile`: `python:3.12-slim`, pip install `camoufox`
       `fastapi` `uvicorn`, `camoufox fetch` at build, copy `server.py`,
       CMD uvicorn.
   - [ ] `camoufox/.dockerignore` (no venv / __pycache__).
   - [ ] `docker-compose.yml`: add `camoufox` service (build context
       `./camoufox`, internal-only, `restart: unless-stopped`); add
       `CAMOUFOX_SIDECAR_URL=http://camoufox:8000` to the app env.

8. **Docs/spec**
   - [ ] `docker-compose.yml` header comment mentions the sidecar.
   - [ ] Update `performance.md` page-fetch section: replace the Playwright
       transport + "Akamai needs paid" notes with the Camoufox-only design and
       the spike result.
   - [ ] Note in `.env.example` / README that local dev needs the sidecar.

## Validation commands

- [ ] `pnpm --filter @iris/utils typecheck && pnpm --filter @iris/prices
      typecheck && pnpm --filter @iris/api typecheck && pnpm --filter @iris/web
      typecheck`
- [ ] `pnpm --filter @iris/prices lint && pnpm --filter @iris/api lint`
- [ ] Sidecar smoke: `docker compose up --build camoufox` then
      `curl -X POST http://localhost:8000/v1/fetch -d '{"url":"https://www.kogan.com/nz/buy/..."}'`
      → 200 with real HTML + price.
- [ ] End-to-end via app: add kogan URL → price returned, product added (AC1);
      add noelleeming URL → added (AC2).
- [ ] Regression: add bunnings / pbtech / warehouse / 99bikes URLs → still add
      (AC4).
- [ ] Config: unset `CAMOUFOX_SIDECAR_URL` → app fails fast with a clear error
      (AC5). Sidecar down → fetch fails with a logged error, not a silent hang.
- [ ] Confirm `rg playwright` returns no hits in `apps/` and `packages/`
      sources (only the lockfile/deps removed).

## Risky files / rollback points

- `packages/prices/src/pipeline/fetch-page.ts` — complete rewrite; the
  discriminated union touches every caller. Rollback point: before step 3.
- `check-price.ts` and `ai-extract.ts` — compile break if the union isn't
  handled everywhere; fix immediately after step 3.
- `apps/web/next.config.ts` + both package.json files — removing Playwright from
  `serverExternalPackages` and deps; must land together or the web build breaks.
- `docker-compose.yml` — additive `camoufox` service; app env var required.
- Full rollback: revert the PR (Playwright path restored); no DB schema change.

## Review gates

- After step 3–5: typecheck all four packages.
- After step 7: `docker compose up --build camoufox` + sidecar smoke test.
- Final: full validation command list above before reporting completion.

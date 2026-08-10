# Add-URL acceptance tests: plain + akamai-protected via local Docker

## Goal

A **manually-run acceptance test suite** (deliberately *not* unit tests, and deliberately kept **out of the build pipeline** — not invoked by `docker build`, CI, or any automated gate) that exercises the Camoufox sidecar's fetch layer directly over HTTP against the local all-in-one Docker image. It covers the two retailer classes that "adding a URL" ultimately depends on:

1. **Plain website** — `POST /v1/fetch` returns `{ ok: true, html, url }` with a real, content-bearing product page (large HTML, no anti-bot markers).
2. **Akamai-protected website** — `POST /v1/fetch` returns the WAF/challenge HTML that the app's `detectBlockedPage` registry classifies as a block (e.g. `/WAF_Deny_Page/`, `Access Denied`, `sec-if-cpt-container`, empty shell).

This validates the fetch + blocked-detection layer that the add-URL flow relies on. The full `create → rollback → list` flow is out of scope (it needs an authenticated session; magic-link auth is deferred).

## Background — evidence from the codebase

- **Sidecar HTTP API** (`camoufox/server.py`):
  - `POST /v1/fetch` accepts `{ url }` (must be absolute http(s), else 422). Returns:
    - `200 { ok: true, html, url }` when navigation produced a response (including non-2xx challenge/deny pages — the HTML is always returned so the app classifies it).
    - `200 { ok: false, reason: "fetch_failed" }` for transport/timeout/no-response failures.
    - `reason: "blocked"` is reserved for a future in-sidecar classifier; today the app's `detectBlockedPage` is the source of truth for the signature id.
  - `GET /health` → `200 { status: "ok" }` when the browser is ready, `503 { status: "starting" }` before.
  - **No auth** on any sidecar endpoint — it is a fetch-only internal service.
- **Sidecar is not host-reachable by default.** `supervisord.conf` binds uvicorn to `--host 127.0.0.1 --port 8000`, and `docker-compose.yml` only publishes `3000:3000`. The host cannot reach `:8000` today. Reaching the sidecar from the host requires publishing `8000:8000` **in dev only** (the image/production config is untouched).
- **Blocked-detection registry** (`packages/prices/src/pipeline/blocked-signatures.ts`): `detectBlockedPage(html)` returns the first matched signature id or `null`. Signatures: `akamai-waf` (`/WAF_Deny_Page/`), `akamai-access-denied` (tiny HTML, title "Access Denied"), `akamai-behavioral-challenge` (`sec-if-cpt-container`), `akamai-empty-shell` (tiny, no `<title>`/`<body>`), plus DataDome and Cloudflare. The tests can assert that returned akamai HTML matches one of these — equivalently, that `detectBlockedPage` would classify it as blocked.
- **Akamai is probabilistic on farmers.co.nz** (confirmed 2026-08-08: ~55% of fresh attempts pass; the rest serve a challenge/deny shell). The akamai scenario must tolerate this: assert the response is *either* a classified block *or* a real page — and document that both outcomes are valid until the pass rate is 100%. A real-page outcome is not a test failure.
- **No test runner is installed** anywhere in the workspace (no vitest/jest/playwright in any `package.json` devDependencies; zero first-party test files). Installing + wiring a runner is part of this task.
- **Local run:** `docker compose up --build -d` → app on `:3000`, sidecar internal on `:8000` (`README.md:53-56`).

## Requirements

- R1 — An acceptance-test runner is installed as a workspace devDependency with a dedicated manual-only script (e.g. `pnpm test:acceptance`). It is **not** invoked by `docker build`, the image's CMD, CI, or any build/pipeline hook.
- R2 — A dev-only way to reach the sidecar from the host is added (publish `8000:8000` in `docker-compose.yml` only — never in the image's `EXPOSE`/production config), with a comment marking it dev-only.
- R3 — Tests target the live sidecar at `http://localhost:8000` over HTTP, asserting the real `/v1/fetch` contract — no module imports, no mocks.
- R4 — **Plain-site scenario:** `POST /v1/fetch` with a plain-website URL returns `{ ok: true }`, a non-empty `html` of plausible page size, and HTML that `detectBlockedPage` does **not** classify as blocked.
- R5 — **Akamai-protected scenario:** `POST /v1/fetch` with an Akamai-protected URL returns HTML that `detectBlockedPage` **either** classifies as a known akamai signature *or* (when Akamai let the request pass this attempt) a real product page. Both outcomes are asserted as valid and documented — the test fails only if the response is a transport failure (`ok: false`) or an unrecognized tiny shell.
- R6 — Tests assert the HTTP-level contract (status, response shape, `ok`/`html`/`url` fields, signature classification), not internal logs.
- R7 — The suite fails loudly (not silently skips) if the sidecar is not reachable on `:8000` or `/health` reports `starting`/`503` after a bounded wait.

## Acceptance Criteria

- [ ] A dedicated `pnpm test:acceptance` (or equivalent) script exists and is documented as **manual-only**; it is not called by `docker build`, the image CMD, or any CI/build hook.
- [ ] `docker-compose.yml` publishes `8000:8000` for dev reachability, clearly commented as dev-only (production deployments in `docs/qnap-deployment.md` are not changed to expose `:8000`).
- [ ] Plain-site scenario: `POST /v1/fetch { url: <plain> }` → `200`, `{ ok: true }`, `html.length` above a plain-page threshold, and the returned HTML is **not** a blocked signature.
- [ ] Akamai scenario: `POST /v1/fetch { url: <akamai> }` → `200` with HTML that is either a real product page (`detectBlockedPage → null`) or a classified akamai block (`detectBlockedPage → akamai-*`); a `fetch_failed` / transport-failure outcome fails the test.
- [ ] Suite fails loudly if `:8000` is unreachable or `/health` stays `503` past a bounded startup wait.
- [ ] Production code (the sidecar, the app) is not changed to make tests pass. The only repo changes are: the test files, the test runner devDependency + script, and the dev-only compose port publish.

## Out of Scope

- The full `POST /api/rpc/products → create → rollback → list` flow (needs authenticated session via magic-link — deferred).
- Auth / session seeding / SMTP sinks.
- Browser/Playwright DOM rendering tests.
- AI extraction, scheduler, alert dispatch, and cross-retailer pass-rate matrices.
- Running in CI or gating `docker build`.
- Publishing `:8000` in production/QNAP deployment configs.

## Notes

- Complex task: `design.md` + `implement.md` are present (test runner = Vitest;
  default URLs = kogan.co.nz plain + farmers.co.nz akamai; dev-only
  `8000:8000` compose publish; `detectBlockedPage` reused from
  `@iris/prices/pipeline` with no source change).

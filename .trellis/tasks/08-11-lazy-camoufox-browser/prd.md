# On-demand camoufox browser lifecycle

## Goal

Eliminate the always-resident Firefox browser in the camoufox sidecar so the container's idle footprint drops dramatically on resource-constrained hosts (e.g. a NAS), without sacrificing the anti-detect scraping capability that camoufox provides.

Today the browser is launched eagerly at FastAPI `lifespan` startup and held resident for the entire process lifetime (`camoufox/server.py:321-346`). On a NAS this shows up as ~823 MB RAM / ~5% CPU at rest, of which ~500 MB is the Firefox process tree that sits idle doing nothing between scrapes.

## Requirements

### Functional
- The browser MUST be launched lazily — only when a fetch is actually requested, not at process startup.
- The browser MUST be torn down after a configurable idle period (no fetch requests for N minutes).
- The next fetch after teardown MUST re-launch the browser transparently; callers see no API change (`POST /v1/fetch` contract unchanged).
- Anti-detect capability MUST be unchanged: same `AsyncCamoufox(headless=True, os="linux")` configuration, same pinned `camoufox==0.5.4` build. No downgrade to plain Playwright.
- The `/health` endpoint semantics MUST be preserved or refined for the lazy model: it reports whether the service is ready to accept a fetch, and does NOT block on launching the browser.

### Non-functional
- Idle footprint (no fetch in flight, idle timeout elapsed) MUST drop by the browser's resident cost (~350-500 MB RAM) while the app/uvicorn process remains.
- First fetch after idle MUST succeed within the existing 45s app-side envelope; the browser cold-start (~3-5s) fits well inside it.
- Concurrency semantics unchanged: `SIDECAR_CONCURRENCY = 5` in-flight requests; a launch-in-progress must serialize correctly so only one launch happens at a time, not five.
- No new external dependencies. No Docker socket, no host-side orchestration, no second container — purely in-process lifecycle management.

### Constraints
- Keep the change localized to `camoufox/server.py`. The app-side `fetchPage` client (`packages/prices/src/pipeline/fetch-page.ts`) must not need changes.
- Preserve existing diagnostic logging (consecutive-failure counter, degraded-browser summary) — the browser coming and going must not produce false degradation warnings.
- The `docker-entrypoint.sh` wait-for-Camoufox health gate (`/health` returning 200) must still pass at container boot — `/health` must report `ok` once the *service* is ready to accept a fetch, which for the lazy model means the FastAPI app is up (the browser launches on first fetch, not on boot).

## Acceptance Criteria

- [ ] With no fetch requests for the idle timeout, the Firefox process tree (`camoufox-bin` + contentproc children) is absent from the container's process list; RAM returns to ~uvicorn baseline (~270 MB container total).
- [ ] A fetch request launches the browser if absent; the response is `ok:true` with HTML (or a normal `fetch_failed`/`blocked` reason on a bad URL) — same contract as before.
- [ ] Two concurrent fetches when the browser is absent launch it exactly once (serialized), not twice.
- [ ] After the idle timeout with no requests, the browser is closed and its processes are reaped.
- [ ] `/health` returns `200 {status:"ok"}` once FastAPI has started (browser may or may not be up); it does not block or hang.
- [ ] `docker-entrypoint.sh` boot gate passes — the container starts successfully on `docker compose up`.
- [ ] Consecutive-failure logging still resets on success and counts on failure; launching/tearing down the browser does not itself increment the failure counter.
- [ ] `packages/prices/src/pipeline/fetch-page.ts` is unmodified.

## Scope (non-goals)

- Not splitting camoufox into a separate Docker service.
- Not replacing camoufox with plain Playwright or a scraping API.
- Not changing the scheduler, the app-side retry/backoff envelope, or `fetchPage`.
- Not adding a second browser or persistent contexts — still one shared browser at a time.
- Not changing image size (browser binary stays in the image; this is a runtime lifecycle change, not a build change).

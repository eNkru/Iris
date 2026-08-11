# Implement — On-demand camoufox browser lifecycle

Execution checklist. Validation command where applicable. Single file change: `camoufox/server.py`.

## Pre-flight
- [ ] `trellis-before-dev` skill loaded the backend spec for the sidecar/camoufox area (`.trellis/spec/backend/performance.md` is the closest; `server.py` lives outside the monorepo packages, under `camoufox/`).
- [ ] On branch `feat/lazy-camoufox-browser`. Task `08-11-lazy-camoufox-browser` active.

## Step 1 — Add lifecycle constants and state
File: `camoufox/server.py`
- [ ] Add `import os` and `import time` to imports (time already imported lazily in `_wait_for_render`; hoist to top).
- [ ] Add config constants near `SIDECAR_CONCURRENCY`:
  ```python
  BROWSER_IDLE_TIMEOUT_SECONDS = float(os.environ.get("CAMOUFOX_IDLE_TIMEOUT_SECONDS", "300"))
  IDLE_POLL_SECONDS = 30.0
  ```
- [ ] Replace the eager `_camoufox_ctx`/`_browser` module globals with a state model:
  - `_camoufox_ctx`, `_browser` (still the browser handle; None = ABSENT)
  - `_launch_lock: asyncio.Lock` (created in lifespan)
  - `_active_fetches: int = 0`
  - `_last_activity_at: float` (monotonic stamp, set on fetch entry)
  - `_idle_task: asyncio.Task | None` (the watcher)
- [ ] Keep `_semaphore` (created in lifespan, unchanged).
- [ ] Keep `_consecutive_failures` / `_record_success` / `_record_failure` — unchanged.

## Step 2 — Lazy launch helper
- [ ] Add `async def _ensure_browser() -> Browser`:
  - If `_browser is not None` → return it (fast path).
  - Acquire `_launch_lock`; re-check (double-checked). If still None:
    - Log `Launching shared Camoufox browser (lazy)`.
    - `_camoufox_ctx = AsyncCamoufox(headless=True, os="linux")`.
    - `_browser = await _camoufox_ctx.__aenter__()`.
    - Log `Camoufox browser ready`.
  - Return `_browser`.
  - On any exception: null out `_camoufox_ctx`/`_browser` (best-effort), release lock, re-raise so the caller's handler records the failure. The lock is released in a `finally`.
  - Validation: import compiles; no eager launch at import.

## Step 3 — Idle teardown helper
- [ ] Add `async def _teardown_browser_if_idle()`:
  - Compute idle = `time.monotonic() - _last_activity_at`.
  - If `idle < BROWSER_IDLE_TIMEOUT_SECONDS` or `_browser is None` or `_active_fetches > 0` → return.
  - Acquire `_launch_lock`; re-check `_active_fetches == 0` and `_browser is not None`.
  - Log `Idle timeout reached, closing Camoufox browser`.
  - `await _camoufox_ctx.__aexit__(None, None, None)` (guard `if _camoufox_ctx is not None`).
  - Null `_camoufox_ctx`/`_browser`.
  - Release lock in `finally`.
  - Never call `_record_failure` (teardown is not a failure).
  - Validation: after teardown, `ps` shows no `camoufox-bin`.

## Step 4 — Idle watcher task
- [ ] Add `async def _idle_watcher()`:
  - `while True: await asyncio.sleep(IDLE_POLL_SECONDS); await _teardown_browser_if_idle()`.
- [ ] In `lifespan`: after `_semaphore = asyncio.Semaphore(...)` and lock init, **do not** launch the browser eagerly. Instead `global _idle_task; _idle_task = asyncio.create_task(_idle_watcher())`.
- [ ] In `lifespan` `finally`: cancel `_idle_task` and await it (suppress `CancelledError`), then teardown browser if still up (the existing shutdown cleanup).

## Step 5 — Wire the fetch handler
File: `camoufox/server.py`, `fetch` (line 364).
- [ ] Remove the `assert _semaphore is not None and _browser is not None` (browser no longer guaranteed at call time).
- [ ] `async with _semaphore:` — keep.
- [ ] Immediately after acquiring the semaphore: `_last_activity_at = time.monotonic()`; increment `_active_fetches` in a try/finally (decrement in finally).
- [ ] `browser = await _ensure_browser()` — this is where the lazy launch happens. Wrap so a launch failure flows to the existing `except Exception` handler (which calls `_record_failure` and returns `fetch_failed`).
- [ ] Replace `_browser.new_page()` with `browser.new_page()`.
- [ ] Rest of the handler (`goto`, `_wait_for_render`, `_snapshot_content`, `page.close`, success/failure recording) unchanged.
- [ ] Validation: the existing per-request flow is byte-identical except the browser handle comes from `_ensure_browser()`.

## Step 6 — `/health` revision
- [ ] Change `health()` to return `200 {"status":"ok","browser":"ready" if _browser is not None else "absent"}`.
- [ ] Remove the `503 {starting}` branch (the service is ready as soon as FastAPI is up; the browser is no longer a boot prerequisite).
- [ ] Keep `response_model=None` (the Union-with-JSONResponse rationale still applies, or simplify now that the 503 branch is gone — keep `response_model=None` to be safe).
- [ ] Validation: `/health` returns 200 on a freshly started container before any fetch.

## Step 7 — Boot gate check (no code change; behavioral)
- [ ] `docker-entrypoint.sh` line 11 (`wget /health`) now passes immediately because `/health` is 200 at boot. Confirm no hang, no timeout. **No edit to the script.**

## Step 8 — Lint / type
- [ ] `python3 -m py_compile camoufox/server.py` (syntax).
- [ ] `ruff` not configured for `camoufox/` per sub-agent report; if `ruff` is available at repo root, run it ad-hoc on the file, else skip and rely on `py_compile`.

## Step 9 — Behavioral validation (container)
Requires `docker compose up`. Run each, confirm, record result:
- [ ] `docker compose up -d` → container healthy. `docker exec <c> wget -qO- http://127.0.0.1:8000/health` → `{"status":"ok","browser":"absent"}`.
- [ ] `docker exec <c> ps -ef | grep camoufox-bin` → **no match** immediately after boot (no resident browser). ✓ idle footprint goal.
- [ ] `docker stats --no-stream <c>` → RAM ~270 MB range (no Firefox).
- [ ] Trigger a fetch (via the app: create a product / force a price check) → returns HTML. After: `ps -ef | grep camoufox-bin` → **matches present** (browser launched).
- [ ] After the fetch, wait > `BROWSER_IDLE_TIMEOUT_SECONDS` (or temporarily set `CAMOUFOX_IDLE_TIMEOUT_SECONDS=30` for the test) → `ps -ef | grep camoufox-bin` → **no match** again (torn down).
- [ ] `docker stats --no-stream <c>` → RAM back to ~270 MB.
- [ ] Concurrency: issue two fetches at once when browser is absent → only one `AsyncCamoufox` launch in the logs (one "Launching shared Camoufox browser (lazy)" line). ✓ single-flight.
- [ ] `/health` after boot and before any fetch → 200 (boot gate passes). ✓ entrypoint.

## Step 10 — Spec touch-up (Phase 3.3)
- [ ] Note the lazy lifecycle in `.trellis/spec/backend/performance.md` (the file already documents the "Shared Limiter Pattern"; add a "Lazy browser lifecycle" note). Keep it short and contract-focused.

## Rollback
- Revert the single file (`git checkout camoufox/server.py`) and `docker compose up -d` — the eager-lifespan model is restored. No data/DB changes, no image rebuild needed (the image already contains the current `server.py`; a `docker compose build` is only needed to bake the new file in, and reverting is symmetric).

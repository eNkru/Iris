# Design — On-demand camoufox browser lifecycle

## Context

`camoufox/server.py` is a FastAPI service holding ONE shared `AsyncCamoufox` (anti-detect Firefox) browser. Today the browser is launched eagerly in the FastAPI `lifespan` context manager (`server.py:321-346`) and held in module globals (`_camoufox_ctx`, `_browser`) for the entire process lifetime. Per-request work only does `new_page()` → `goto` → snapshot → `page.close()` on the shared browser.

Problem: on a NAS, the resident Firefox process tree (~350-500 MB RSS across the main `camoufox-bin` + contentproc children) sits idle between scrapes, which are gated to a 60-min default product interval. The browser is almost always doing nothing.

## Approach

Replace the eager lifespan launch with a **lazy-launch + idle-teardown** lifecycle, internal to the sidecar process. The browser is launched on first fetch (and on first fetch after a teardown), reused for subsequent fetches, and torn down after a configurable idle period with no fetch activity.

This is a runtime lifecycle change only — no build, image, or app-client changes.

## Lifecycle state machine

A single `_browser_state` governs the shared browser. Conceptual states:

```
ABSENT  --(fetch request)-->  LAUNCHING  --(launch done)-->  READY
  ^                                  |                          |
  |                                  | (launch fails)           | (idle timeout, no fetches)
  |                                  v                          v
  +---------------------------- ABSENT <----------------------- (teardown)
  :                       (launch failure -> FetchResponseFail,
  :                        browser stays ABSENT, next fetch retries)
```

States:
- **ABSENT** — `_browser is None`. No Firefox process.
- **LAUNCHING** — launch in progress; the launch lock is held. `_browser` still `None` until launch resolves.
- **READY** — `_browser` is a live `Browser`. Idle timer tracks last-activity time.

### Lazy launch with single-flight serialization

The critical correctness invariant: when the browser is ABSENT and N requests arrive concurrently, **exactly one** launch happens. The old eager launch had no concurrency at launch time (lifespan runs once before requests). Lazy launch introduces it.

Mechanism: an `asyncio.Lock` (`_launch_lock`) guards the launch path. On a fetch:

1. Acquire `_browser` under the semaphore (unchanged concurrency bound of 5).
2. If `_browser` is not None → use it (fast path).
3. If `_browser is None` → acquire `_launch_lock`. Re-check `_browser` after acquiring (double-checked locking — another waiter may have launched it). If still None, launch `AsyncCamoufox` → `__aenter__()`, store into `_browser`. Release `_launch_lock`.
4. Proceed with `new_page()` → `goto` → snapshot → `page.close()`.

If launch raises, record a failure (`kind="error"`, the existing `_record_failure`), leave `_browser = None`, return `FetchResponseFail(reason="fetch_failed")`. The next request will attempt launch again. The failure counter increments on a launch failure (consistent with the existing semantics: a launch failure is a fetch failure).

### Idle teardown

A background `asyncio.Task` (`_idle_watcher`) started in `lifespan` polls every `IDLE_POLL_SECONDS`. It compares `monotonic()` against `_last_activity_at` (updated on every fetch *entry*, not completion, so a long-running fetch can't be torn down mid-flight). When the idle threshold (`BROWSER_IDLE_TIMEOUT_SECONDS`) is exceeded AND no fetch is currently in flight (`_active_fetches == 0`), it tears down:

1. Acquire `_launch_lock` (so it does not race a concurrent lazy launch).
2. Re-check in-flight count (a fetch may have entered between the check and the lock).
3. If still 0 in-flight and idle threshold exceeded: `await _camoufox_ctx.__aexit__(None, None, None)`, null out `_browser` and `_camoufox_ctx`.
4. Release lock.

The idle watcher must not increment the failure counter on teardown — teardown is normal operation, not a fetch failure.

### In-flight accounting

`_active_fetches: int`, incremented in a `try` around the fetch body and decremented in `finally`. This is what the idle watcher checks so it never tears down a browser mid-navigation. The semaphore (`SIDECAR_CONCURRENCY`) still bounds concurrency; the in-flight counter is strictly for the teardown gate.

## `/health` semantics

Today `/health` returns `503 {status:"starting"}` while `_browser is None`, else `200 {status:"ok"}`. Under the lazy model `_browser` is `None` at boot (by design), so the old check would return 503 forever and `docker-entrypoint.sh`'s boot gate (line 11) would fail/timeout.

New semantics: `/health` returns `200 {status:"ok"}` once the FastAPI app is up and the idle watcher is running — i.e. the *service* is ready to accept a fetch. Whether the browser is currently up is reported as an informational field, not a readiness gate:

```
200 {status:"ok", browser:"ready"|"absent"}
```

This lets `docker-entrypoint.sh` pass its boot gate immediately (the service is up), and lets an operator/healthcheck see whether the browser is resident. The existing compose healthcheck (`/api/rpc/health/check` on the *app*, port 3000) is unaffected — that's a different endpoint on a different process.

## Configuration

New module constants (env-overridable for tuning without image rebuild):

```python
BROWSER_IDLE_TIMEOUT_SECONDS = float(os.environ.get("CAMOUFOX_IDLE_TIMEOUT_SECONDS", "300"))
IDLE_POLL_SECONDS = 30.0
```

Default 300s (5 min) idle → teardown. Tunable via env. The scheduler's default 60-min product interval means most idle windows will exceed 5 min on a NAS with few products, so the browser will be torn down between scrapes. For a user with many products scraping constantly, the browser stays resident (correct — it's actively in use).

## What does NOT change

- `AsyncCamoufox(headless=True, os="linux")` configuration — identical fingerprint.
- `camoufox==0.5.4` pin and the fetched binary — no rebuild.
- Per-request page lifecycle (`new_page` / `goto(wait_until="domcontentloaded", timeout=35s)` / `_wait_for_render` / `_snapshot_content` / `page.close()`).
- `SIDECAR_CONCURRENCY = 5` semaphore.
- The app-side client `fetch-page.ts` — the `POST /v1/fetch` request/response contract is identical.
- `_record_success` / `_record_failure` / `DIAGNOSE_THRESHOLD` degradation logging — a successful fetch resets, a failed fetch counts. Launch/teardown are not fetches and do not touch the counter (teardown never does; a launch failure that prevents a fetch does count, as it would have under the eager model if the browser had been broken).
- `docker-entrypoint.sh`, `supervisord.conf`, `Dockerfile`, `docker-compose.yml` — unchanged. (Optionally document `CAMOUFOX_IDLE_TIMEOUT_SECONDS` in compose, but no behavioral change required.)

## Edge cases & tradeoffs

- **Cold-start latency on first fetch after idle**: ~3-5s for `AsyncCamoufox.__aenter__()` + Playwright driver + Firefox process spawn. This is well inside the app-side 45s timeout envelope (`fetch-page.ts`) and the sidecar's own 35s navigation timeout. The first scrape after idle is slower; subsequent scrapes in the active window are instant as today. Acceptable — a NAS scraping once/hour pays 5s once/hour, saving ~500MB for the other 59min.
- **Launch failure** is reported as a normal `fetch_failed` to the caller; the app's existing retry/backoff (`fetch-page.ts`, 3 retries with jitter) handles transient launch failures. The failure counter increments, so sustained launch failures still surface the "browser degraded" diagnostic at threshold.
- **Teardown racing a fetch**: guarded by the in-flight counter and the launch lock. A fetch entering between the watcher's check and lock acquisition re-checks under the lock and aborts teardown if `_active_fetches > 0`.
- **`monotonic()` not available** — Python's `time.monotonic()` is available and already used in `_wait_for_render` (`server.py:225-227`). Reused for idle timing.
- **Crash recovery**: if the browser process dies out from under us (Firefox crash), `new_page()` or `goto` raises, the fetch records a failure and returns `fetch_failed`. The browser object is left in place (a zombie `Browser` reference). A future enhancement could detect a dead browser and null it for relaunch; for this task, the existing failure path + the app's retry will surface it. (The `_consecutive_failures` counter will climb and emit the degraded diagnostic — same behavior as today.)
- **Idle watcher lifecycle**: started in `lifespan` after the app yields, cancelled in the `finally` before process shutdown. Standard `asyncio.create_task` + cancel-on-shutdown pattern.

## Files touched

| File | Change |
|---|---|
| `camoufox/server.py` | Lazy launch + idle teardown + in-flight accounting + revised `/health`. The only code change. |

No other files change. No tests currently exist for `server.py` (the sub-agent report confirms no test file for the sidecar); validation is via manual/behavioral checks per the acceptance criteria.

## Validation approach (summary — full checklist in implement.md)

1. Unit-level: confirm the module imports and `lifespan` enters/exits without a resident browser.
2. Behavioral (container): `docker compose up`, confirm `/health` 200 on boot, confirm no `camoufox-bin` process after idle, confirm a fetch launches it, confirm a second concurrent fetch during launch reuses (one launch), confirm teardown after idle, confirm `docker stats` RAM drop.
3. Boot gate: `docker-entrypoint.sh` waits pass on first boot.

# Camoufox sidecar self-heal — design

## Problem summary

The sidecar keeps ONE `AsyncCamoufox` browser for its lifetime. After hours of
uptime the browser enters a state where every `page.goto` raises; without
intervention every fetch fails forever. `server.py` already maps those
exceptions to `{ok:false, reason:"fetch_failed"}` (never throws), which is
correct contract behavior but gives no recovery.

## Approach

Detect a run of consecutive fetch failures and replace the browser in place.
No new dependencies; no API contract change.

## Components (all in `camoufox/server.py`)

### 1. Failure counter + threshold

```python
HEAL_THRESHOLD = 3          # consecutive failures that trigger a recycle
_consecutive_failures = 0   # module-level, reset to 0 on every success
```

### 2. `_record_fetch_failure()` / `_record_fetch_success()`

- Success path (returning `FetchResponseOk`): set counter to 0.
- Any failure branch (timeout, generic exception, `goto` returning `None`,
  `new_page()` raising — all currently funnel to `fetch_failed`): increment;
  when it reaches `HEAL_THRESHOLD`, call `_recreate_browser()` and reset the
  counter. Do this *outside* the per-request `finally: page.close()` so a bad
  page is always closed first.

### 3. `_recreate_browser()` — guarded by a lock

```python
_heal_lock = asyncio.Lock()   # created in lifespan alongside _semaphore

async def _recreate_browser() -> None:
    global _camoufox_ctx, _browser
    async with _heal_lock:
        if _browser is None:      # another coroutine already recreated
            return
        logger.warning("Camoufox browser degraded — recreating (self-heal)")
        try:
            if _camoufox_ctx is not None:
                await _camoufox_ctx.__aexit__(None, None, None)
        except Exception as exc:
            logger.warning("Error closing old browser", extra={"error": str(exc)})
        _camoufox_ctx = AsyncCamoufox(headless=True)
        _browser = await _camoufox_ctx.__aenter__()
        logger.info("Camoufox browser recreated")
```

- Mirrors the `lifespan` startup/shutdown code exactly (same
  `AsyncCamoufox(headless=True)` / `__aenter__` / `__aexit__` calls).
- Lock prevents double-recreation when several concurrent requests fail at
  once; the `_browser is None` check makes the recreation idempotent.
- During recreation `_browser` is briefly `None` → `/health` already returns
  503 (existing behavior). Compose healthcheck may flap; acceptable, and the
  sidecar recovers in ~seconds.
- In-flight requests that were holding a reference to the old browser fail
  with "browser closed" → caught by the existing generic handler → clean
  `fetch_failed`. The app-side retry loop absorbs this.

### 4. Wiring into `/v1/fetch`

The failure branches are exactly where `FetchResponseFail(reason="fetch_failed")`
is returned today:

```python
except asyncio.TimeoutError:
    await _record_fetch_failure()
    return FetchResponseFail(reason="fetch_failed")
except Exception as exc:
    await _record_fetch_failure()
    return FetchResponseFail(reason="fetch_failed")
```

and `goto` returning `None` (currently an immediate early return):

```python
if response is None:
    await _record_fetch_failure()
    return FetchResponseFail(reason="fetch_failed")
```

Success path (before `return FetchResponseOk(...)`):
`_record_fetch_success()`.

## Edge cases

- **User typo / dead host**: 3 bad fetches recycle the browser once. Harmless,
  rare, and bounded — a fresh browser does not fix the URL, so the next 3 bad
  fetches recycle again. No infinite loop within a request.
- **Recreation failure**: if `__aenter__` raises, the exception propagates out
  of `_recreate_browser` into `_record_fetch_failure` → must be caught so the
  current request still returns `fetch_failed` and the next failure can retry
  the recycle. Wrap the `_recreate_browser()` call defensively.
- **Site-specific WAF**: a single-site block (page returns HTML, no raise) is
  NOT counted — only transport-level failures count. A WAF that hard-errors
  the navigation would count; the logged url/error (R6) distinguishes this.

## Rollout / rollback

- Deploy by rebuilding the sidecar image (`docker compose up -d --build
  camoufox`).
- Rollback: revert the single-file change and rebuild. No schema or contract
  migration.

## Open questions

- Threshold value (3) — revisit if false-positive recycles (e.g. slow flaky
  network causing 3 consecutive timeouts on distinct products) become noisy.
- Whether `goto` timeouts should count: yes for now (degraded browser often
  manifests as hang-to-timeout), revisit if timeouts prove to be a per-site
  property rather than browser health.

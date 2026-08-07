# Camoufox sidecar self-heal: auto-recreate degraded browser

## Goal

The Camoufox sidecar (`camoufox/server.py`) holds ONE shared `AsyncCamoufox`
browser for all page fetches. Observed 2026-08-06: after ~3 hours of uptime the
shared browser silently degraded — every `page.goto` started raising, so *every*
fetch (any retailer, including paknsave.co.nz) returned `{ok:false,
reason:"fetch_failed"}`. The app maps that to "Page fetch failed" and product
creates roll back (`packages/api/src/modules/products/procedures/create.ts`).
A container restart fixed it immediately; a fresh browser loads the same pages
fine (paknsave confirmed HTTP 200, price in embedded JSON).

Goal: the sidecar detects a degraded shared browser and automatically replaces
it (self-heal), without a container restart and without manual intervention.

## Requirements

- R1. Count consecutive fetch failures (goto exception, goto timeout, goto
  returning `None`, `new_page()` failure) as one signal.
- R2. When the consecutive-failure count reaches a threshold (`HEAL_THRESHOLD`,
  default 3), tear down the shared browser and launch a fresh `AsyncCamoufox`
  browser using the same lifecycle as the startup path in `lifespan`.
- R3. Any successful fetch resets the failure counter to 0.
- R4. Recreation must be concurrency-safe: parallel in-flight fetches must not
  trigger overlapping recreations (guard with an `asyncio.Lock`); only one
  recreation runs at a time.
- R5. The health endpoint must reflect the brief unready window during
  recreation (it already returns 503 when `_browser is None`; keep that).
- R6. Log the trigger reason (url + error) and the recreation at INFO/WARNING
  so future occurrences are diagnosable. Reuse the existing `extra`-field
  logging style.
- R7. Keep the change small and contained: `camoufox/server.py` only, no new
  dependencies, no API contract changes (`/v1/fetch` and `/health` unchanged).
- R8. Must not change the per-request behavior on healthy browsers: fresh page
  per request, page closed in `finally`, `FETCH_TIMEOUT_SECONDS` and
  `SIDECAR_CONCURRENCY` unchanged.

## Acceptance Criteria

- [ ] With the sidecar up, N consecutive failing fetches (e.g. unreachable
      host) trigger a single browser recreation, visible in logs as
      "degraded — recreating (self-heal)" then "Camoufox browser recreated".
- [ ] Immediately after recreation, a fetch of a healthy URL (paknsave PDP)
      succeeds with `{ok:true, html, url}`.
- [ ] A successful fetch resets the counter: one failure then a success does
      NOT trigger recreation.
- [ ] No overlapping recreation: a burst of concurrent failing requests results
      in exactly one recreation pass (lock held; in-flight requests on the old
      browser just return `fetch_failed`, never raise).
- [ ] `/health` returns 200 when the browser is ready and 503 during the
      startup/recreation window.
- [ ] `git diff` touches only `camoufox/server.py`; no dependency changes.

## Notes

- The exact root cause of the degradation is unconfirmed (was a transport-level
  `goto` error; see the improved logging added in the same session). Self-heal
  is the chosen robustness fix regardless of root cause; if the real cause is a
  single-site WAF, the per-request failure logging (R6) will surface it while
  the browser is never falsely replaced for a site-specific block.
- Threshold of 3 is a heuristic; site-specific hard failures (typo'd URL,
  unresolvable host) also count toward the threshold by design (R1). Acceptable
  cost: an occasional pointless browser recycle at most every 3 bad fetches.
- App side needs no change: `fetchPage` already retries transport errors up to
  `MAX_RETRIES` with backoff, so a single mid-heal `fetch_failed` is absorbed.

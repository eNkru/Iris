# Investigate camoufox sidecar browser degradation: add diagnostic logging

## Goal

Add structured diagnostic logging to the camoufox sidecar so that when the
shared `AsyncCamoufox` browser silently degrades after hours of uptime (every
`page.goto` starts raising → every fetch returns
`{ok:false, reason:"fetch_failed"}` → app maps to "Page fetch failed"), the real
failure is captured in logs. This confirms root cause *before* committing to a
fix (self-heal vs deterministic recycle). No behavior change to `/v1/fetch` or
`/health`.

## Background

- Observed 2026-08-06: after ~3 h of uptime the shared browser degraded; every
  retailer (incl. paknsave.co.nz) returned `fetch_failed`. A container restart
  fixed it; a fresh browser loads the same pages fine.
- Current `camoufox/server.py` `/v1/fetch` handler:
  - Catches `asyncio.TimeoutError` (server.py:177) and a bare `Exception`
    (server.py:182), logging only `str(exc)` under `extra={"error": str(exc)}`.
    The exception **class/type is not logged**, so a Playwright-level
    `page.goto` failure surfaces as a bare message with no category.
  - The `response is None` path (server.py:150) returns `fetch_failed`
    **silently** — no log line at all.
  - A `new_page()` failure (raised inside the `try`) is folded into the generic
    `Exception` branch, indistinguishable from a `goto` failure.
- The archived sibling task `08-06-camoufox-sidecar-self-heal` chose self-heal
  as the robustness fix but notes the root cause is **unconfirmed**; its R1
  depends on a consecutive-failure signal this task produces, and its notes
  explicitly defer to "the improved logging added in the same session."
  This task is that logging. The self-heal **action** (browser recreation,
  `asyncio.Lock`, threshold-triggered teardown) stays out of scope here.

## Requirements

- R1. Log the **exception class** (qualified name, e.g.
  `playwright.async_api.TimeoutError` / `Error` / `asyncio.TimeoutError`) in
  addition to the message on every failure path in `/v1/fetch`. Reuse the
  existing `extra`-field style; add an `error_type` field alongside the
  existing `error` (message) field.
- R2. Keep `asyncio.TimeoutError` as its own branch (already separate) and
  ensure non-timeout exceptions are categorized by class so a Playwright
  transport error is distinguishable from an unexpected `Exception`.
- R3. Add a `response is None` log line (WARNING, with `url`) so the silent
  no-response path is no longer invisible.
- R4. Add **failure accounting**: a module-level consecutive-fetch-failure
  counter for the shared browser, incremented on any failure (`goto`
  exception, `goto` timeout, `response is None`, `new_page()` failure) and
  reset to 0 on any successful fetch. Log the running count on each failure
  so degradation reads as a trend, not isolated per-request warnings.
- R5. When the consecutive-failure count crosses a diagnostic threshold
  (`DIAGNOSE_THRESHOLD`, default 3 — matches the self-heal task's intended
  trigger), emit one richer INFO/WARNING "browser degraded" line that
  summarizes the accumulated failure (count + last error type/message + a
  `repr(exc)` / short traceback) so the rare multi-hour degradation is
  captured with enough detail to confirm root cause. Do **not** spam a full
  traceback on every transient single failure.
- R6. No behavior change: `/v1/fetch` still returns the identical
  `FetchResponseOk` / `FetchResponseFail` bodies and status codes; `/health`
  unchanged. The counter and threshold are **logging-only** — no browser
  recreation, no `asyncio.Lock`, no teardown. (That is the self-heal task.)
- R7. Contained change: `camoufox/server.py` only, no new dependencies, no
  API contract changes, no app-side change (`fetchPage` already retries
  transport errors with backoff).
- R8. Must not change per-request behavior on a healthy browser: fresh page
  per request, page closed in `finally`, `FETCH_TIMEOUT_SECONDS` and
  `SIDECAR_CONCURRENCY` unchanged.

## Acceptance Criteria

- [ ] A failing fetch logs an `error_type` field carrying the exception's
      qualified class name (not just the message), for both the timeout
      branch and the generic-exception branch.
- [ ] A `response is None` fetch emits a WARNING log line with the `url`
      (previously silent).
- [ ] The consecutive-failure counter increments on each failure and resets
      to 0 on a success; the current count appears in each failure log line.
- [ ] After `DIAGNOSE_THRESHOLD` (3) consecutive failures, exactly one
      "browser degraded" summary line is emitted with `repr`/traceback
      detail; subsequent failures do not re-emit the rich summary until the
      counter resets.
- [ ] `/v1/fetch` and `/health` responses are byte-for-byte identical to
      the pre-change behavior for ok, non-2xx, timeout, and error cases.
- [ ] `git diff` touches only `camoufox/server.py`; no dependency changes.

## Out of Scope

- Browser self-heal / recreation, the `asyncio.Lock`, and threshold-triggered
  teardown — owned by `08-06-camoufox-sidecar-self-heal`.
- Deciding between self-heal and deterministic recycle — this task only
  gathers the evidence; the decision follows once root cause is confirmed.
- App-side (`fetchPage`) changes — the retry/backoff envelope already absorbs
  single mid-degradation failures.

## Technical Notes

- Sidecar is Python stdlib `logging` (not the app's TS `@iris/logs`); the
  backend `logging.md` spec's `console.log` ban does not apply. Match the
  existing `logger.warning(..., extra={...})` style already in `server.py`.
- `AsyncCamoufox.__aenter__` yields a Playwright `Browser`; `page.goto`
  failures raise `playwright.async_api.Error` subclasses. Logging
  `type(exc).__module__ + "." + type(exc).__qualname__` captures this.
- `DIAGNOSE_THRESHOLD = 3` is chosen to align with the self-heal task's
  intended `HEAL_THRESHOLD` so the diagnostic line fires at the same point a
  future self-heal would trigger — making the logs directly comparable.

## Open Questions

- None blocking. One design choice is flagged for approval in the final
  planning summary: logging verbosity (type+message on every failure; full
  `repr`/traceback only at the threshold — to avoid traceback spam on
  transient timeouts).

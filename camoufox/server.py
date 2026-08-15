"""Camoufox sidecar — the single fetch transport for the Iris app.

A tiny FastAPI service that holds ONE shared `AsyncCamoufox` browser (an
engine-level anti-detect Firefox fork) and exposes a fetch-only HTTP API.
The app's `fetchPage` (`packages/prices/src/pipeline/fetch-page.ts`) is a thin
client for this service; the retry / backoff / pLimit / logging envelope lives
in the app, not here.

Why a sidecar (not in-process): Camoufox is a Python package driving a Firefox
fork; the app is Node/Next.js. Keeping the browser in a separate container also
shrinks the app image (browser deps move here) and isolates browser crashes.

Contracts (design.md §Camoufox sidecar HTTP API):
  POST /v1/fetch  {url}  -> 200 {ok:true, html, url}
                            | 200 {ok:false, reason:"blocked"|"fetch_failed"}
  GET  /health           -> 200 when the browser is ready
                            | 503 {status:"starting"} before the browser is up

The service never throws to the caller: navigation/timeout errors are mapped to
`{ok:false, reason:"fetch_failed"}`. When navigation produces a response
(including non-2xx challenge/deny pages), the HTML is always returned so the
app-side `detectBlockedPage` can classify a specific anti-bot signature (AC3).
The `reason:"blocked"` variant is reserved for a future in-sidecar classifier;
today the app is the source of truth for the signature id.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from pydantic import BaseModel, field_validator

# `AsyncCamoufox` is the async context-manager client that launches the
# anti-detect Firefox. Entering it (`__aenter__`) yields a Playwright
# `Browser` (or `BrowserContext` under persistent mode) exposing
# `new_page()` / `new_context()`. The context manager itself does not expose
# `new_page()`, so the lifespan stores both the context (for orderly
# shutdown) and the yielded browser (for per-request pages).
#
# Note: camoufox.async_api does NOT export an `AsyncBrowser` type — the
# yielded object is Playwright's `Browser` (see AsyncCamoufox.__aenter__).
from camoufox.async_api import AsyncCamoufox
from playwright.async_api import Browser
from playwright.async_api import Error as PlaywrightError
from playwright.async_api import TimeoutError as PlaywrightTimeoutError

logger = logging.getLogger("camoufox-sidecar")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

# Concurrency bound by an asyncio semaphore matching the app-side pLimit (5, the
# old Playwright concurrency — performance.md Shared Limiter Pattern). Each
# request gets a fresh page off the shared browser; pages are closed per-call.
SIDECAR_CONCURRENCY = 5
# Per-request navigation timeout. Keep the navigation timeout below the app-
# side AbortSignal.timeout (45 s), leaving room for the bounded SPA render wait
# and response serialization before the client aborts the request.
FETCH_TIMEOUT_SECONDS = 35.0
# Cap for the post-domcontentloaded SPA render wait (design.md §Chosen
# approach). Polls body.innerText until the length stabilizes for ~1 s (or
# this cap elapses). Bounded well under FETCH_TIMEOUT_SECONDS so a page that
# never renders still fails inside the existing 45 s envelope. Experiment
# (Angular SPA PDP): price rendered at ~5.8 s; 8 s is a safe ceiling.
RENDER_WAIT_SECONDS = 8.0
# Minimum body.innerText length before the stability clock starts. SPA shells
# often render a tiny partial (e.g. 9 chars of chrome) for ~2 s before the
# real content hydrates; without this floor the wait would "stabilize" on the
# empty stub and miss the price. 200 is well above chrome stubs and well
# below a real PDP (experiment: real content was 1930+ chars).
RENDER_MIN_TEXT_LEN = 200
# How long body.innerText.length must stay unchanged (once above the floor)
# before we treat the page as rendered. 1 s is long enough to ride past a
# mid-hydration flicker without waiting for the full cap on a static page.
RENDER_STABLE_SECONDS = 1.0
# `page.content()` snapshot retries when the page is mid-navigation. The
# navigation settles within a few hundred ms; 3 attempts at 400 ms covers a
# slow rewrite without approaching the per-request 35 s navigation timeout.
CONTENT_RETRY_ATTEMPTS = 3
CONTENT_RETRY_DELAY_SECONDS = 0.4

# Idle teardown: the browser is torn down after this many seconds with no fetch
# activity, so the resident Firefox process tree (~350-500 MB) is absent
# between scrapes on resource-constrained hosts (e.g. a NAS). The default
# 300 s (5 min) sits well below the scheduler's 60-min product poll interval,
# so on a lightly-loaded host the browser launches for a scrape, sits idle for
# 5 min, tears down, and relaunches ~an hour later — paying ~3-5 s cold-start
# once per hour to keep ~500 MB free the other ~55 min. Tunable via env so a
# host with many back-to-back scrapes can keep the browser warm (raise it) or
# a host with sparse scrapes can reclaim faster (lower it).
BROWSER_IDLE_TIMEOUT_SECONDS = float(
    os.environ.get("CAMOUFOX_IDLE_TIMEOUT_SECONDS", "300")
)
# How often the idle watcher polls. 30 s balances teardown promptness against
# trivial per-poll cost.
IDLE_POLL_SECONDS = 30.0

# Diagnostic threshold for shared-browser degradation (R5). Aligned with the
# self-heal task's intended `HEAL_THRESHOLD` (3) so the rich "browser degraded"
# summary fires at the same point a future self-heal would trigger — making the
# logs directly comparable. This is LOGGING-ONLY here: no recreation, no lock,
# no teardown (that is the self-heal task's scope).
DIAGNOSE_THRESHOLD = 3

_semaphore: asyncio.Semaphore | None = None
# `AsyncCamoufox` is the async context-manager client. Entering it yields a
# Playwright `Browser` which exposes `new_page()` / `new_context()`; the
# context manager itself does not. We hold both so the lifespan can
# exit/enter the context and the handler can call `new_page()` on the
# yielded browser. Under the lazy lifecycle both are None until the first
# fetch; torn back to None after the idle timeout.
_camoufox_ctx: AsyncCamoufox | None = None
_browser: Browser | None = None
# Single-flight lock for the lazy launch: when the browser is ABSENT and N
# requests arrive concurrently, exactly one does the launch; the rest wait on
# this lock and reuse the just-launched browser (double-checked locking).
_launch_lock: asyncio.Lock | None = None
# In-flight fetch counter so the idle watcher never tears down a browser while
# a navigation is mid-flight. Incremented on fetch entry, decremented in a
# finally. The semaphore bounds concurrency (5); this counter gates teardown.
_active_fetches: int = 0
# Monotonic timestamp of the last fetch entry, updated on every request. The
# idle watcher tears down when `monotonic() - _last_activity_at` exceeds
# BROWSER_IDLE_TIMEOUT_SECONDS and no fetch is in flight. Initialized to the
# process start time so a freshly-started container with zero requests is
# eligible for teardown-of-nothing (a no-op) rather than never running.
_last_activity_at: float = time.monotonic()
# Background task that polls for idle and tears the browser down. Created in
# lifespan, cancelled on shutdown.
_idle_task: asyncio.Task[None] | None = None
# Consecutive-fetch-failure counter for the shared browser (R4). Incremented on
# any failure (`goto` exception, `goto` timeout, `response is None`,
# `new_page()` failure) and reset to 0 on any successful fetch. Surfaced in
# each failure log line so degradation reads as a trend, not isolated
# per-request warnings. Logging-only: it never drives a browser action.
_consecutive_failures: int = 0


def _record_success() -> None:
    """Reset the consecutive-failure counter on a successful fetch (R4).

    A single success clears the degradation trend — the same reset semantics
    the future self-heal task will use for its trigger.
    """
    global _consecutive_failures
    _consecutive_failures = 0


def _record_failure(url: str, exc: BaseException | None, *, kind: str) -> None:
    """Count and log a fetch failure with diagnostic detail (R1, R3–R5).

    `kind` is a short category label ("timeout" | "error" | "no_response")
    so the no-response path (which has no exception object) is still
    accounted. Emits the per-request type+message line on every failure and,
    exactly once when the count crosses `DIAGNOSE_THRESHOLD`, a richer
    "browser degraded" summary with `repr`/traceback to capture root cause.
    The rich line is not re-emitted until the counter resets (R5).
    """
    global _consecutive_failures
    _consecutive_failures += 1
    count = _consecutive_failures
    error_type = _exc_type_name(exc) if exc is not None else kind
    message = str(exc) if exc is not None else "page.goto returned no response"
    # Include the diagnostic fields in the message as well as `extra`: the
    # container's default Supervisor log format does not render logging extras.
    # Without this, the operator only sees the unhelpful phrase
    # "sidecar fetch error" and cannot distinguish a timeout from a browser or
    # network failure from the container logs.
    logger.warning(
        "sidecar fetch %s url=%s error_type=%s error=%s consecutive_failures=%d",
        kind,
        url,
        error_type,
        message,
        count,
        extra={
            "url": url,
            "error": message,
            "error_type": error_type,
            "consecutive_failures": count,
        },
    )
    if count == DIAGNOSE_THRESHOLD and exc is not None:
        traceback_text = _traceback_repr(exc)
        logger.warning(
            "sidecar browser degraded — %d consecutive failures url=%s "
            "error_type=%s error=%s traceback=%s",
            count,
            url,
            error_type,
            message,
            traceback_text,
            extra={
                "url": url,
                "error_type": error_type,
                "error": message,
                "traceback": traceback_text,
            },
        )


def _exc_type_name(exc: BaseException) -> str:
    """Qualified exception class name for diagnostic logging (R1).

    Playwright failures raise `playwright.async_api.Error` subclasses; logging
    only `str(exc)` (the pre-change behavior) loses the category. The qualified
    name makes a transport-level `page.goto` failure distinguishable from an
    unexpected `Exception` when the shared browser degrades after hours of
    uptime.
    """
    cls = type(exc)
    module = getattr(cls, "__module__", "") or ""
    qualname = getattr(cls, "__qualname__", cls.__name__)
    return f"{module}.{qualname}" if module else qualname


def _traceback_repr(exc: BaseException) -> str:
    """Compact `repr(exc)` + traceback for the threshold diagnostic line (R5).

    Kept off the per-request path to avoid traceback spam on routine transient
    timeouts; emitted only when consecutive failures cross the diagnostic
    threshold.
    """
    import traceback

    return repr(exc) + "\n" + "".join(traceback.format_exception(exc))


async def _ensure_browser() -> Browser:
    """Lazily launch the shared Camoufox browser, or return the live one.

    Fast path: if `_browser` is already up, return it. Otherwise acquire the
    launch lock (single-flight) and, after re-checking under the lock, enter a
    fresh `AsyncCamoufox` context and store the yielded `Browser`. Concurrent
    callers block on the lock and reuse the one launch — only one Firefox
    process is ever spawned across simultaneous requests.

    The `AsyncCamoufox(headless=True, os="linux")` config is identical to the
    pre-change eager lifespan launch — same anti-detect fingerprint, same
    pinned binary build. This changes *when* the browser comes up, not *what*
    it is.

    On any exception, the partial state is cleared (`_browser`/`_camoufox_ctx`
    nulled) so the next request retries from a clean ABSENT state, and the
    exception propagates to the caller's handler (which records a failure and
    returns `fetch_failed`). The lock is released in a `finally` so an
    abandoned waiter still gets to try.

    Raises whatever `AsyncCamoufox.__aenter__` raises on launch failure.
    """
    global _camoufox_ctx, _browser
    if _browser is not None:
        return _browser
    assert _launch_lock is not None, "sidecar not started — lifespan must run"
    async with _launch_lock:
        # Double-checked locking: another waiter may have launched the browser
        # while we waited for the lock.
        if _browser is not None:
            return _browser
        logger.info("Launching shared Camoufox browser (lazy, linux fingerprint)")
        # The single deployed browser runs in a Linux container with only the
        # Linux font set physically present; pin the fingerprint OS to linux so
        # navigator.platform / fonts / fontconfig are always self-consistent (a
        # mac/win fingerprint that names fonts which can't resolve locally is a
        # fingerprinting tell). The image also prunes the macos/windows font dirs.
        ctx = AsyncCamoufox(headless=True, os="linux")
        try:
            browser = await ctx.__aenter__()
        except BaseException:
            # Clear any half-set state so the next attempt starts clean. Do not
            # call __aexit__ here: __aenter__ failed, so there is nothing to
            # exit (the context manager was not entered).
            _camoufox_ctx = None
            _browser = None
            raise
        _camoufox_ctx = ctx
        _browser = browser
        logger.info("Camoufox browser ready")
        return _browser


async def _teardown_browser_if_idle() -> None:
    """Tear the browser down after the idle timeout with no fetches in flight.

    Called periodically by the idle watcher. No-op when the browser is already
    absent, when the idle threshold has not elapsed, or when a fetch is
    in-flight (so a long navigation is never killed mid-flight). Acquires the
    launch lock so it cannot race a concurrent lazy launch: a fetch entering
    between the idle check and the lock re-checks `_active_fetches` under the
    lock and aborts the teardown.

    Teardown is normal operation, never a fetch failure: it must not touch the
    `_consecutive_failures` counter.
    """
    global _camoufox_ctx, _browser
    if _browser is None:
        return
    if time.monotonic() - _last_activity_at < BROWSER_IDLE_TIMEOUT_SECONDS:
        return
    if _active_fetches > 0:
        return
    assert _launch_lock is not None, "sidecar not started — lifespan must run"
    async with _launch_lock:
        # Re-check under the lock: a fetch may have entered between the
        # unlocked `_active_fetches` check above and acquiring the lock, and a
        # launch may have raced.
        if _browser is None or _active_fetches > 0:
            return
        if time.monotonic() - _last_activity_at < BROWSER_IDLE_TIMEOUT_SECONDS:
            return
        logger.info(
            "Idle timeout reached (%.0fs), closing Camoufox browser",
            BROWSER_IDLE_TIMEOUT_SECONDS,
        )
        ctx = _camoufox_ctx
        # Null the handles first so a fetch arriving while __aexit__ runs sees
        # ABSENT and launches fresh, rather than reusing a browser being torn
        # down.
        _browser = None
        _camoufox_ctx = None
    if ctx is not None:
        try:
            await ctx.__aexit__(None, None, None)
        except Exception as exc:  # noqa: BLE001 — teardown failure must not crash the watcher
            logger.warning(
                "Camoufox browser teardown error error_type=%s error=%s",
                _exc_type_name(exc),
                str(exc),
            )
    logger.info("Camoufox browser closed (idle teardown)")


async def _idle_watcher() -> None:
    """Background loop that tears the browser down after the idle timeout.

    Started in `lifespan`, cancelled on shutdown. Polls every
    `IDLE_POLL_SECONDS`; the actual teardown decision and teardown work live in
    `_teardown_browser_if_idle`.
    """
    while True:
        await asyncio.sleep(IDLE_POLL_SECONDS)
        await _teardown_browser_if_idle()


async def _wait_for_render(page: object) -> None:
    """Best-effort wait for SPA content to render after `domcontentloaded`.

    Client-rendered SPAs (Angular/React/Next.js) inject their price via JS
    *after* `domcontentloaded`. Snapshotting `page.content()` at that event
    yields an empty shell — `reducePageHtml` produces empty content, the AI
    reports `available:false`, and product create rolls back. Experiment
    (Angular SPA PDP, 2026-08-07): `domcontentloaded` → 0 body text;
    `networkidle` → still 0; content-stabilization wait → price present at
    ~5.8 s. See design.md §Chosen approach.

    Algorithm:
      1. Poll `document.body.innerText.length` every 100 ms.
      2. Ignore lengths below `RENDER_MIN_TEXT_LEN` (SPA chrome stubs of a
         few chars must not "stabilize" the wait early).
      3. Once above the floor, return when the length is unchanged for
         `RENDER_STABLE_SECONDS`, or when `RENDER_WAIT_SECONDS` elapses.

    Never raises: a failure to evaluate is treated as "no more waiting" so
    the fetch still proceeds to `page.content()` and the existing failure
    paths (timeout / exception) remain the only sources of `fetch_failed`.
    Generic — no retailer/host branching, no per-site selectors (the
    anti-pattern guardrail in backend/performance.md).
    """
    import time

    deadline = time.monotonic() + RENDER_WAIT_SECONDS
    last_len: int | None = None
    stable_since: float | None = None
    while time.monotonic() < deadline:
        try:
            # `page` is a Playwright Page; typed as object so the module does
            # not hard-depend on the playwright type at import time for this
            # helper's signature (the lifespan already holds a Browser).
            current = await page.evaluate(  # type: ignore[attr-defined]
                "document.body && document.body.innerText "
                "? document.body.innerText.length : 0"
            )
        except Exception:  # noqa: BLE001 — best-effort; never fail the fetch
            return
        if not isinstance(current, int):
            current = 0
        if current < RENDER_MIN_TEXT_LEN:
            # Still below the floor (empty shell / chrome stub) — do not
            # start the stability clock; keep polling until content arrives
            # or the cap hits.
            last_len = None
            stable_since = None
        elif current == last_len:
            if stable_since is None:
                stable_since = time.monotonic()
            elif time.monotonic() - stable_since >= RENDER_STABLE_SECONDS:
                return
        else:
            last_len = current
            stable_since = None
        await asyncio.sleep(0.1)
    # Cap hit — proceed with whatever is currently rendered (may still be
    # empty; the AI will then report available:false, same as pre-change).


async def _snapshot_content(page: object, url: str) -> str:
    """Read `page.content()` resiliently (design.md §fetch contract).

    `page.content()` raises `playwright.async_api.Error: Unable to retrieve
    content because the page is navigating and changing the content` when the
    page is mid-navigation / redirect at the instant of the snapshot. On
    farmers.co.nz this is common: Akamai rewrites the document in-flight after
    `domcontentloaded`. Without this guard the fetch surfaces as
    `fetch_failed`, burns one of the app's retry attempts on a backoff, and
    only re-succeeds by chance — and on the Farmers PDP the retry then often
    hits an Akamai deny shell and rolls the create back.

    Mitigation: a short bounded wait-and-retry. The navigation settles within
    a few hundred milliseconds; we wait `CONTENT_RETRY_DELAY_SECONDS` and try
    again, up to `CONTENT_RETRY_ATTEMPTS` times. Only a persistent failure
    escalates to the caller's exception handler (which maps it to
    `fetch_failed`). Never raises on the happy path.
    """
    for attempt in range(1, CONTENT_RETRY_ATTEMPTS + 1):
        try:
            return await page.content()  # type: ignore[attr-defined]
        except PlaywrightError as exc:
            transient = "navigating and changing the content" in str(exc)
            if not transient or attempt >= CONTENT_RETRY_ATTEMPTS:
                raise
            logger.info(
                "sidecar page content mid-navigation, retrying url=%s "
                "attempt=%d/%d",
                url,
                attempt,
                CONTENT_RETRY_ATTEMPTS,
            )
            await asyncio.sleep(CONTENT_RETRY_DELAY_SECONDS)
    # Unreachable: the loop either returns or raises on the last attempt.
    raise RuntimeError("content snapshot loop exited without a result")


class FetchRequest(BaseModel):
    url: str

    @field_validator("url")
    @classmethod
    def _url_must_be_absolute(cls, value: str) -> str:
        if not value.startswith(("http://", "https://")):
            raise ValueError("url must be an absolute http(s) URL")
        return value


class FetchResponseOk(BaseModel):
    ok: bool = True
    html: str
    url: str


class FetchResponseFail(BaseModel):
    ok: bool = False
    reason: str  # "blocked" | "fetch_failed"


class FetchImageRequest(BaseModel):
    url: str

    @field_validator("url")
    @classmethod
    def _url_must_be_absolute(cls, value: str) -> str:
        if not value.startswith(("http://", "https://")):
            raise ValueError("url must be an absolute http(s) URL")
        return value


class FetchImageResponseOk(BaseModel):
    ok: bool = True
    contentType: str
    data: str  # base64-encoded binary image data


class FetchImageResponseFail(BaseModel):
    ok: bool = False
    reason: str  # "fetch_failed" | "non_image"


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Start the sidecar: semaphore, launch lock, and idle watcher.

    Unlike the old eager lifecycle, the browser is NOT launched here — it
    launches lazily on the first fetch (`_ensure_browser`) and tears down after
    the idle timeout (`_idle_watcher`). This keeps the Firefox process tree
    absent between scrapes, so a NAS (or any lightly-loaded host) does not pay
    ~500 MB for a resident browser that mostly sits idle.

    On shutdown, cancel the idle watcher and tear the browser down if it
    happens to be up.
    """
    global _semaphore, _launch_lock, _idle_task, _last_activity_at
    _semaphore = asyncio.Semaphore(SIDECAR_CONCURRENCY)
    _launch_lock = asyncio.Lock()
    _last_activity_at = time.monotonic()
    _idle_task = asyncio.create_task(_idle_watcher())
    logger.info(
        "Sidecar ready (browser will launch on first fetch, idle teardown after %ss)",
        BROWSER_IDLE_TIMEOUT_SECONDS,
    )
    try:
        yield
    finally:
        if _idle_task is not None:
            _idle_task.cancel()
            try:
                await _idle_task
            except asyncio.CancelledError:
                pass
        _idle_task = None
        if _camoufox_ctx is not None:
            logger.info("Closing Camoufox browser (shutdown)")
            try:
                await _camoufox_ctx.__aexit__(None, None, None)
            except Exception as exc:  # noqa: BLE001 — shutdown cleanup must not mask exit
                logger.warning(
                    "Camoufox browser shutdown error error_type=%s error=%s",
                    _exc_type_name(exc),
                    str(exc),
                )
        _camoufox_ctx = None
        _browser = None
        _launch_lock = None
        _semaphore = None


app = FastAPI(title="Iris Camoufox sidecar", lifespan=lifespan)


@app.get("/health", response_model=None)
async def health() -> dict[str, str]:
    # Under the lazy lifecycle the browser is absent at boot by design, so
    # readiness can no longer gate on `_browser`. The *service* is ready as
    # soon as the lifespan has set up the semaphore / lock / idle watcher —
    # i.e. this handler runs. Whether the browser is currently resident is
    # reported as an informational field so an operator can see it, but it is
    # not a readiness gate: a 503 here would block `docker-entrypoint.sh`'s
    # boot gate forever (the browser only launches on the first real fetch).
    # `response_model=None` is kept so FastAPI does not generate a model from
    # the dict return; the shape is stable and trivial.
    return {"status": "ok", "browser": "ready" if _browser is not None else "absent"}


@app.post("/v1/fetch")
async def fetch(request: FetchRequest) -> FetchResponseOk | FetchResponseFail:
    assert _semaphore is not None and _launch_lock is not None, (
        "sidecar not started — lifespan must run before requests"
    )
    global _active_fetches, _last_activity_at
    _last_activity_at = time.monotonic()
    _active_fetches += 1
    try:
        return await _do_fetch(request)
    finally:
        _active_fetches -= 1


async def _do_fetch(
    request: FetchRequest,
) -> FetchResponseOk | FetchResponseFail:
    """Inner fetch body; called by `fetch` once in-flight accounting is set up."""
    async with _semaphore:
        try:
            # Lazily launch the browser if it is absent (single-flight across
            # concurrent callers). On launch failure this raises, flows to the
            # handler below (records a failure, returns fetch_failed), and the
            # next request retries from ABSENT.
            browser = await _ensure_browser()
            # `new_page` on the shared browser gives a fresh page (no cookie /
            # storage leak between retailers) that we close in a `finally`.
            page = await browser.new_page()
            try:
                response = await page.goto(
                    request.url,
                    wait_until="domcontentloaded",
                    timeout=int(FETCH_TIMEOUT_SECONDS * 1000),
                )
                if response is None:
                    # R3: this path was previously silent. `page.goto` returns
                    # None for navigations cancelled or redirected before a
                    # response; account it as a fetch failure so a degraded
                    # browser that only ever yields None is no longer
                    # invisible in logs.
                    _record_failure(request.url, None, kind="no_response")
                    return FetchResponseFail(reason="fetch_failed")

                # SPA render wait: client-rendered pages inject the price via
                # JS *after* domcontentloaded. Wait (bounded) for body text to
                # stabilize before snapshotting so reducePageHtml / the AI
                # actually see the price. Best-effort; never raises. Static
                # pages stabilize immediately (~no added latency). See
                # design.md §Chosen approach and _wait_for_render.
                await _wait_for_render(page)

                # Always return the rendered HTML when navigation produced a
                # response — including non-2xx. Challenge/deny pages often
                # arrive as 403/503 with a small body; discarding that body
                # would force the app into the generic "Page fetch failed"
                # path and break AC3 (specific anti-bot reason). The app-side
                # `detectBlockedPage` is the source of truth for the signature
                # id; a real 404 product page simply flows through to AI
                # extraction which reports `available: false`.
                status = response.status
                html = await _snapshot_content(page, request.url)
                final_url = page.url
                if not response.ok:
                    logger.warning(
                        "sidecar fetch non-2xx status (returning HTML for classification)",
                        extra={
                            "url": request.url,
                            "status": status,
                            "final_url": final_url,
                            "html_len": len(html),
                        },
                    )
                # A response with content counts as success for the degradation
                # trend (R4): non-2xx challenge/deny pages are a per-site
                # signal, not a shared-browser-degradation signal.
                _record_success()
                return FetchResponseOk(html=html, url=final_url)
            finally:
                try:
                    await page.close()
                except Exception as exc:  # noqa: BLE001 — cleanup must not mask the fetch result
                    logger.warning(
                        "sidecar page close failed url=%s error_type=%s error=%s",
                        request.url,
                        _exc_type_name(exc),
                        str(exc),
                    )
        except (PlaywrightTimeoutError, asyncio.TimeoutError) as exc:
            _record_failure(request.url, exc, kind="timeout")
            return FetchResponseFail(reason="fetch_failed")
        except Exception as exc:  # noqa: BLE001 — never throw to the caller
            _record_failure(request.url, exc, kind="error")
            return FetchResponseFail(reason="fetch_failed")


@app.post("/v1/fetch-image")
async def fetch_image(
    request: FetchImageRequest,
) -> FetchImageResponseOk | FetchImageResponseFail:
    """Fetch a binary image through the Camoufox browser.

    Product image URLs often sit behind the same Cloudflare / anti-bot WAF
    as the product page. A plain Node.js ``fetch`` gets 403'd because it
    lacks the browser's TLS fingerprint and challenge-solving capability.
    Routing the image download through the sidecar — the same browser that
    fetched the page HTML — ensures the image request carries the full
    anti-detect fingerprint and passes the WAF.

    Returns base64-encoded binary data (JSON cannot carry raw bytes).
    """
    assert _semaphore is not None and _launch_lock is not None, (
        "sidecar not started — lifespan must run before requests"
    )
    global _active_fetches, _last_activity_at
    _last_activity_at = time.monotonic()
    _active_fetches += 1
    try:
        return await _do_fetch_image(request)
    finally:
        _active_fetches -= 1


async def _do_fetch_image(
    request: FetchImageRequest,
) -> FetchImageResponseOk | FetchImageResponseFail:
    """Inner image-fetch body; mirrors ``_do_fetch`` structure.

    Navigates to the image URL, reads ``response.body()``, and returns it
    base64-encoded. Images don't need the SPA render-wait or content-
    snapshot retry — ``wait_until="load"`` fires when the image bytes are
    fully received.
    """
    import base64

    async with _semaphore:
        try:
            browser = await _ensure_browser()
            page = await browser.new_page()
            try:
                response = await page.goto(
                    request.url,
                    wait_until="load",
                    timeout=int(FETCH_TIMEOUT_SECONDS * 1000),
                )
                if response is None:
                    _record_failure(request.url, None, kind="no_response")
                    return FetchImageResponseFail(reason="fetch_failed")

                content_type = response.headers.get(
                    "content-type", "image/jpeg"
                )

                if not content_type.startswith("image/"):
                    logger.warning(
                        "sidecar fetch-image non-image content-type "
                        "url=%s content_type=%s status=%d",
                        request.url,
                        content_type,
                        response.status,
                    )
                    return FetchImageResponseFail(reason="non_image")

                body = await response.body()
                _record_success()
                data = base64.b64encode(body).decode("ascii")
                return FetchImageResponseOk(
                    contentType=content_type,
                    data=data,
                )
            finally:
                try:
                    await page.close()
                except Exception as exc:  # noqa: BLE001
                    logger.warning(
                        "sidecar page close failed url=%s error_type=%s "
                        "error=%s",
                        request.url,
                        _exc_type_name(exc),
                        str(exc),
                    )
        except (PlaywrightTimeoutError, asyncio.TimeoutError) as exc:
            _record_failure(request.url, exc, kind="timeout")
            return FetchImageResponseFail(reason="fetch_failed")
        except Exception as exc:  # noqa: BLE001 — never throw to the caller
            _record_failure(request.url, exc, kind="error")
            return FetchImageResponseFail(reason="fetch_failed")

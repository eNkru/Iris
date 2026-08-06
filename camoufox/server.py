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
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.responses import JSONResponse
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

logger = logging.getLogger("camoufox-sidecar")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

# Concurrency bound by an asyncio semaphore matching the app-side pLimit (5, the
# old Playwright concurrency — performance.md Shared Limiter Pattern). Each
# request gets a fresh page off the shared browser; pages are closed per-call.
SIDECAR_CONCURRENCY = 5
# Per-request navigation timeout. Matches the app-side AbortSignal.timeout
# (45 s) so the sidecar fails before the app's HTTP timeout fires.
FETCH_TIMEOUT_SECONDS = 45.0

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
# yielded browser.
_camoufox_ctx: AsyncCamoufox | None = None
_browser: Browser | None = None
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
    logger.warning(
        "sidecar fetch %s", kind,
        extra={
            "url": url,
            "error": message,
            "error_type": error_type,
            "consecutive_failures": count,
        },
    )
    if count == DIAGNOSE_THRESHOLD and exc is not None:
        logger.warning(
            "sidecar browser degraded — %d consecutive failures (root cause "
            "detail below)", count,
            extra={
                "url": url,
                "error_type": error_type,
                "error": message,
                "traceback": _traceback_repr(exc),
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


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Launch the shared Camoufox browser at startup, close it on shutdown."""
    global _semaphore, _camoufox_ctx, _browser
    _semaphore = asyncio.Semaphore(SIDECAR_CONCURRENCY)
    logger.info("Launching shared Camoufox browser (headless)")
    _camoufox_ctx = AsyncCamoufox(headless=True)
    # `__aenter__` yields the `AsyncBrowser`; `new_page()` lives on it, not on
    # the `AsyncCamoufox` context manager itself.
    _browser = await _camoufox_ctx.__aenter__()
    logger.info("Camoufox browser ready")
    try:
        yield
    finally:
        if _camoufox_ctx is not None:
            logger.info("Closing Camoufox browser")
            await _camoufox_ctx.__aexit__(None, None, None)
        _camoufox_ctx = None
        _browser = None
        _semaphore = None


app = FastAPI(title="Iris Camoufox sidecar", lifespan=lifespan)


@app.get("/health", response_model=None)
async def health() -> dict[str, str] | JSONResponse:
    # The browser is launched eagerly in the lifespan, so readiness == the
    # process being up past startup. Return 503 while starting so Compose
    # `service_healthy` (and any external probe) does not treat a pre-ready
    # process as healthy.
    # `response_model=None` is required: FastAPI cannot generate a response
    # model from a Union that includes starlette.Response (JSONResponse).
    if _browser is None:
        return JSONResponse({"status": "starting"}, status_code=503)
    return {"status": "ok"}


@app.post("/v1/fetch")
async def fetch(request: FetchRequest) -> FetchResponseOk | FetchResponseFail:
    assert _semaphore is not None and _browser is not None, (
        "sidecar not started — lifespan must run before requests"
    )
    async with _semaphore:
        try:
            # `new_page` on the shared browser gives a fresh page (no cookie /
            # storage leak between retailers) that we close in a `finally`.
            page = await _browser.new_page()
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

                # Always return the rendered HTML when navigation produced a
                # response — including non-2xx. Challenge/deny pages often
                # arrive as 403/503 with a small body; discarding that body
                # would force the app into the generic "Page fetch failed"
                # path and break AC3 (specific anti-bot reason). The app-side
                # `detectBlockedPage` is the source of truth for the signature
                # id; a real 404 product page simply flows through to AI
                # extraction which reports `available: false`.
                status = response.status
                html = await page.content()
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
                await page.close()
        except asyncio.TimeoutError as exc:
            _record_failure(request.url, exc, kind="timeout")
            return FetchResponseFail(reason="fetch_failed")
        except Exception as exc:  # noqa: BLE001 — never throw to the caller
            _record_failure(request.url, exc, kind="error")
            return FetchResponseFail(reason="fetch_failed")

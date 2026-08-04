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

_semaphore: asyncio.Semaphore | None = None
# `AsyncCamoufox` is the async context-manager client. Entering it yields a
# Playwright `Browser` which exposes `new_page()` / `new_context()`; the
# context manager itself does not. We hold both so the lifespan can
# exit/enter the context and the handler can call `new_page()` on the
# yielded browser.
_camoufox_ctx: AsyncCamoufox | None = None
_browser: Browser | None = None


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
                return FetchResponseOk(html=html, url=final_url)
            finally:
                await page.close()
        except asyncio.TimeoutError:
            logger.warning(
                "sidecar fetch timeout", extra={"url": request.url}
            )
            return FetchResponseFail(reason="fetch_failed")
        except Exception as exc:  # noqa: BLE001 — never throw to the caller
            logger.warning(
                "sidecar fetch error",
                extra={"url": request.url, "error": str(exc)},
            )
            return FetchResponseFail(reason="fetch_failed")

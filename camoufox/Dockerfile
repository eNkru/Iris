# syntax=docker/dockerfile:1
#
# Camoufox sidecar — the single fetch transport for the Iris app
# (design.md §Camoufox sidecar / §Docker deployment).
#
# A Python + FastAPI service holding ONE shared `AsyncCamoufox` browser (an
# engine-level anti-detect Firefox fork). The app POSTs `{url}` to `/v1/fetch`
# and gets back the rendered HTML; the app-side `fetch-page.ts` owns retry /
# backoff / pLimit / structured logging.
#
# Camoufox ships `linux/arm64` builds (confirmed in `pkgman.py` ARCH_MAP), so
# this image runs on ARM NAS deployments as well as x86.

FROM python:3.12-slim

# System libs needed to launch a headless Camoufox/Firefox build.
# Camoufox links against GTK3 (`libmozgtk.so` → libgtk-3 / libgdk-3) plus the
# usual NSS/X11/GL/font stack. Without libgtk-3-0 the browser process exits
# immediately with "Couldn't load XPCOM".
# `playwright` (Camoufox's driver) also needs these at runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        fonts-liberation \
        libasound2 \
        libatk-bridge2.0-0 \
        libatk1.0-0 \
        libatspi2.0-0 \
        libcairo2 \
        libcups2 \
        libdbus-1-3 \
        libdbus-glib-1-2 \
        libdrm2 \
        libgbm1 \
        libgdk-pixbuf-2.0-0 \
        libgtk-3-0 \
        libnspr4 \
        libnss3 \
        libpango-1.0-0 \
        libx11-xcb1 \
        libxcb-shm0 \
        libxcomposite1 \
        libxdamage1 \
        libxfixes3 \
        libxkbcommon0 \
        libxrandr2 \
        libxshmfence1 \
        libxt6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install the Python deps first (layer cached until requirements change).
# `camoufox fetch` downloads the matching Firefox build into the Camoufox
# cache so it is baked into the image and available offline at runtime — the
# sidecar never downloads a browser on startup.
RUN pip install --no-cache-dir camoufox fastapi uvicorn \
    && camoufox fetch

COPY server.py .

EXPOSE 8000

# uvicorn with a single worker: the shared browser + asyncio semaphore
# (SIDECAR_CONCURRENCY = 5) handle concurrency. `--host 0.0.0.0` so the app
# can reach it on the Compose internal network.
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]

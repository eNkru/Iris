# syntax=docker/dockerfile:1
# Iris all-in-one image: Next.js + scheduler + Camoufox on one volume-backed container.
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# Node runs the app; Python runs Camoufox; supervisor keeps both services alive.
# These are the GTK/NSS/X11 libraries required by the Camoufox Firefox build.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
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
        python3 \
        python3-venv \
        supervisor \
        wget \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@11.18.0 --activate

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/api/package.json packages/api/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/prices/package.json packages/prices/package.json
COPY packages/utils/package.json packages/utils/package.json
RUN pnpm install --frozen-lockfile \
    && rm -rf /root/.local/share/pnpm /root/.cache/pnpm

# Keep Python dependencies isolated from Debian's system Python. The browser
# binary is fetched at build time so production startup does not need internet.
#
# Pin camoufox to 0.5.4 — the pip version whose `camoufox fetch` downloads
# browser build 152.0.4-beta.28 (verified in the cached config.json). That is
# the exact build the 2026-08-04 anti-bot spike passed every challenged
# retailer with. An unpinned install drifts to newer builds on rebuilds, which
# can shift anti-bot pass rates; bump deliberately and re-run the retailers
# pass-rate matrix when you do.
RUN python3 -m venv /opt/camoufox \
    && /opt/camoufox/bin/pip install --no-cache-dir camoufox==0.5.4 fastapi uvicorn \
    && /opt/camoufox/bin/camoufox fetch

COPY . .

# Server-only modules validate their environment while Next builds.
ARG DATABASE_PATH=/app/data/iris.db
ARG CAMOUFOX_SIDECAR_URL=http://127.0.0.1:8000
ENV DATABASE_PATH=${DATABASE_PATH}
ENV CAMOUFOX_SIDECAR_URL=${CAMOUFOX_SIDECAR_URL}
ENV NODE_ENV=production

RUN pnpm --filter @iris/web build \
    && rm -rf apps/web/.next/cache

COPY supervisord.conf /etc/supervisord.conf
COPY docker-entrypoint.sh /usr/local/bin/iris-app-start
RUN chmod +x /usr/local/bin/iris-app-start

VOLUME ["/app/data"]
EXPOSE 3000

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]

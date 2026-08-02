# syntax=docker/dockerfile:1
#
# Iris — single application container that runs BOTH the Next.js web server and
# the in-process price-check scheduler in one process (design.md R14).
# Postgres and Redis are separate Compose services (docker-compose.yml).
#
# Single stage on purpose (implement.md step 9): keeping dev tooling
# (drizzle-kit for `db:migrate`, tsc) inside the image keeps the entrypoint
# simple and is acceptable for a private NAS deployment.
#
# Playwright: the @iris/prices package's fetch-page.ts launches a real
# headless Chromium to read retailers behind Cloudflare Managed Security
# Challenges. The chromium binary is downloaded into the Playwright cache
# during `playwright install --with-deps chromium`; `--with-deps` also
# installs the runtime libraries (nss, freetype, etc.) via apt-get.
# Debian Bookworm (glibc) is required because Playwright's chromium build
# is linked against glibc — it cannot run on Alpine/musl.
FROM node:22-bookworm-slim

# wget is needed by the docker-compose healthcheck. The rest of the chromium
# runtime libraries are installed by `playwright install --with-deps` below.
RUN apt-get update && apt-get install -y --no-install-recommends wget && rm -rf /var/lib/apt/lists/*

# Playwright's chromium download lives in /ms-playwright by default. We let
# Playwright download the matching build at image-build time so the cache
# is layered into the image and the app can launch it offline.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# pnpm version is pinned by the packageManager field in package.json; activate
# it via corepack (bundled with Node 22).
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate

WORKDIR /app

# 1. Install dependencies first (layer is cached until the lockfile changes).
#    Copy the workspace manifests, then install with --frozen-lockfile.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/utils/package.json packages/utils/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/api/package.json packages/api/package.json
COPY packages/prices/package.json packages/prices/package.json

# pnpm 11 honors the allowBuilds list in pnpm-workspace.yaml (esbuild, sharp,
# unrs-resolver) for their postinstall scripts.
RUN pnpm install --frozen-lockfile

# 2. Download the Playwright Chromium build and its system-level runtime
#    libraries. `--with-deps` runs apt-get to install nss, freetype, harfbuzz,
#    fontconfig, etc. — the same set the alpine variant installed manually.
RUN pnpm --filter @iris/prices exec playwright install --with-deps chromium

# 3. Copy the rest of the source and build.
COPY . .

# DATABASE_URL is required at build time: @iris/database's client module reads
# getEnv().DATABASE_URL on import even though the pool itself is lazy, so
# `next build` (which type-checks and bundles server code) fails without it.
# Compose passes it via build args; no actual DB connection happens at build.
ARG DATABASE_URL
ENV DATABASE_URL=${DATABASE_URL}

RUN pnpm --filter @iris/web build

# 4. Runtime
ENV NODE_ENV=production
EXPOSE 3000

COPY docker-entrypoint.sh /usr/local/bin/iris-entrypoint
RUN chmod +x /usr/local/bin/iris-entrypoint

ENTRYPOINT ["iris-entrypoint"]

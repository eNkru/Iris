# Iris on a QNAP NAS — build & deploy guide

Single all-in-one container (Next.js + scheduler + Camoufox) on a QNAP running
Container Station. All persistent data and configuration live in one shared
folder on the NAS **outside** the container, so recreating the container or
updating the image never wipes anything.

## What you need

- QNAP NAS running Container Station (x86_64 model; most QNAPs are).
- SSH enabled on the NAS (Control Panel → Telnet/SSH) so you can run `docker` CLI.
- A Mac/PC with Docker. Your Docker daemon must produce `linux/amd64` images —
  the same target as an x86_64 NAS (no cross-compilation needed).

## 1. Build the image on your computer

```bash
# from the Iris repository root
docker build -t iris:1.0.0 .
```

No build args are required (`DATABASE_PATH` and `CAMOUFOX_SIDECAR_URL` default
to the internal container contract `/app/data/iris.db` and
`http://127.0.0.1:8000`).

Verify the platform before shipping it to the NAS:

```bash
docker image inspect iris:1.0.0 --format '{{.Os}}/{{.Architecture}}'
# expect: linux/amd64 (or linux/arm64 if you run an ARM QNAP)
```

## 2. Save and transfer the image

```bash
# create a single-file archive (gzipped is roughly half the size)
docker save iris:1.0.0 | gzip > ~/iris-1.0.0.tar.gz

# copy it to your NAS (use your NAS IP/hostname and an existing shared folder)
scp ~/iris-1.0.0.tar.gz admin@my-nas:/share/Container/iris/
```

> Image is ~1 GB+ when uncompressed (Node + Python + Camoufox browser). gzip
> it and expect a slow transfer over the LAN. Alternatively push to a registry
> (Docker Hub / GHCR) and `docker pull` on the NAS — especially handy for
> re-deploys.

## 3. Set up the folder layout on the NAS

Create one shared folder, e.g. `/share/Container/iris/`. Docker will bind-mount
host folders inside the container, so your database and config survive any
container recreate:

```
/share/Container/iris/
├── docker-compose.yml   # pinned to iris:1.0.0, bind-mounts ./data and ./.env
├── .env                 # real secrets (never committed)
└── data/                # SQLite db + WAL files live here (auto-created)
```

### docker-compose.yml (paste `docker-compose.yml` or replace the existing one)

Use `./data` and `./.env` relative to this file — a **bind mount**, not a named
volume, so the files stay visible and outlive container/volume removal:

```yaml
services:
  app:
    image: iris:1.0.0          # or your registry tag
    restart: unless-stopped
    env_file: ./.env           # config stays on the NAS, outside the image
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data       # SQLite data -> NAS folder, wiped never
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:3000/api/rpc/health/check >/dev/null || exit 1"]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 60s
```

## 4. Create `.env` next to the compose file

Copy from `.env.example` (repo root) and fill in real values, especially:

```env
APP_URL=https://iris.my-qnap.local     # or your URL; used in magic-link emails
BETTER_AUTH_SECRET=<openssl rand -base64 32>   # MUST be set in production
DATABASE_PATH=/app/data/iris.db
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=noreply@yourdomain
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=...
AI_MODEL=gpt-4o-mini
TELEGRAM_BOT_TOKEN=
SCHEDULER_TICK_MS=30000
CAMOUFOX_SIDECAR_URL=http://127.0.0.1:8000
```

`DATABASE_PATH` must point at the mounted dir `/app/data/iris.db`. Do NOT set
`DATABASE_PATH` to a value outside `/app/data`, or the DB lives in container
scratch space and is lost on recreate. Runtime AI settings are admin-editable
from the app and stored in the DB, so `AI_BASE_URL`/`AI_API_KEY` here are
first-boot fallbacks.

## 5. Load the image and start

```bash
ssh user@my-nas
cd /share/Container/iris

# load the image into the local Docker store (do this inside the NAS shell)
docker load -i /share/Container/iris/iris-1.0.0.tar.gz

# validate
docker images | grep iris

# start
docker compose up -d
docker compose logs -f app
```

Open `http://<NAS-IP>:3000` and log in (first run creates the bootstrap admin
from the SMTP-mailed magic link).

## Upgrading to a new version

Data and config are untouched — only the container is swapped:

1. Build & tag on the computer: `docker build -t iris:1.0.1 .`
2. Save/transfer/`docker load` as above.
3. Edit `docker-compose.yml` → `image: iris:1.0.1`.
4. Recreate: `docker compose up -d` (migrations run automatically on startup).

## Notes / gotchas

- **Bind mounts, not named volumes**: named volume data is life in the Docker
  graph and invincible per container; bind mounts let you see, back up, and
  keep your DB on the NAS filesystem, and survive `docker compose down`.
  The `iris-data` volume in the repo's dev `docker-compose.yml` is replaced by
  the `./data` bind mount here.
- **First boot**: the entrypoint runs `pnpm db:migrate` (idempotent) then waits
  for Camoufox `/health` before starting the web server; allow ~60 s.
- **CPU architecture**: QNAPs are x86_64 or arm64. Build to match. The
  Camoufox browser is pinned in the Dockerfile; verification matrix for the
  pinned build is stored in the Trellis task `08-08-single-docker-image`.
- **Backups**: the whole `data/` dir is one file (`iris.db`) + WAL — just
  snapshot that folder while the container is stopped, or use QNAP's snapshot.
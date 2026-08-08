#!/bin/sh
set -eu

mkdir -p /app/data

echo "[iris] applying SQLite migrations"
pnpm db:migrate

echo "[iris] waiting for Camoufox"
attempt=0
while ! wget -qO- http://127.0.0.1:8000/health >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    echo "[iris] Camoufox did not become ready" >&2
    exit 1
  fi
  sleep 2
done

echo "[iris] starting web server and scheduler"
exec pnpm --filter @iris/web start

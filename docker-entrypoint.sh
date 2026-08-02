#!/bin/sh
set -e

# Iris container entrypoint.
#
# The app container runs the web server AND the in-process scheduler
# (design.md R14). Before booting we apply pending Drizzle migrations so a
# fresh Postgres volume needs no manual step.

echo "[iris] waiting for database..."

# drizzle-kit migrate fails fast when Postgres is still starting; retry with
# backoff. `pg_isready` isn't shipped in this image, so we probe via migrate.
attempt=0
while ! pnpm db:migrate >/tmp/migrate.log 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "[iris] database never became ready; last migrate output:" >&2
    cat /tmp/migrate.log >&2
    exit 1
  fi
  echo "[iris] database not ready (attempt $attempt), retrying in 2s"
  sleep 2
done

echo "[iris] migrations applied, starting web server + scheduler"
exec pnpm --filter @iris/web start

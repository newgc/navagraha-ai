#!/usr/bin/env bash
# Runs on the server as the app user, from inside a freshly unpacked release:
#   bash /srv/navagraha/releases/<release>/deploy/remote-deploy.sh
# Backs up the database, migrates, switches `current`, restarts and health-checks.
# If the new release is unhealthy it switches back and restarts the previous one.
set -euo pipefail

BASE=/srv/navagraha
NODE=/opt/navagraha-node/current/bin/node
RELEASE=$(cd "$(dirname "$0")/.." && pwd)
set -a; . "$BASE/shared/.env"; set +a

echo "Release $(basename "$RELEASE")"

# 1. Database backup (last 10 kept). Migrations only go forward; restore this to undo one.
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
pg_dump --no-owner "$DATABASE_URL" | gzip > "$BASE/backups/db-$STAMP.sql.gz"
ls -1t "$BASE"/backups/db-*.sql.gz | tail -n +11 | xargs -r rm -f

# 2. Migrations and idempotent seed data.
(cd "$RELEASE" && "$NODE" packages/db/dist/scripts/migrate.js && "$NODE" packages/db/dist/scripts/seed.js)

# 3. Switch, restart, check.
PREVIOUS=$(readlink -f "$BASE/current" 2>/dev/null || true)
switch_to() { ln -sfn "$1" "$BASE/current.next" && mv -Tf "$BASE/current.next" "$BASE/current"; }
restart() { sudo -n /usr/bin/systemctl restart navagraha-api.service navagraha-web.service; }
healthy() {
  for _ in $(seq 1 40); do
    if curl -fsS -o /dev/null "http://127.0.0.1:$API_PORT/v1/health" &&
       curl -fsS -o /dev/null "http://127.0.0.1:$WEB_PORT/"; then
      return 0
    fi
    sleep 1.5
  done
  return 1
}

switch_to "$RELEASE"
restart
if healthy; then
  echo "Healthy."
else
  echo "New release is not healthy." >&2
  if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ] && [ "$PREVIOUS" != "$RELEASE" ]; then
    echo "Rolling back to $(basename "$PREVIOUS")." >&2
    switch_to "$PREVIOUS"
    restart
  fi
  exit 1
fi

# 4. Keep the last 5 releases.
ls -1dt "$BASE"/releases/*/ | tail -n +6 | while read -r old; do
  [ "$(readlink -f "$old")" = "$(readlink -f "$BASE/current")" ] || rm -rf "$old"
done

#!/usr/bin/env bash
# Runs on the VPS as the deploy user (no root needed), from inside a freshly unpacked release:
#   bash ~/navagraha/releases/<release>/deploy/vps/remote-deploy.sh
# Migrates the database, starts the release under pm2, health-checks it and switches back to
# the previous release if it is unhealthy. Everything lives in ~/navagraha:
#   runtime/current  Node.js + pm2 (uploaded by the workflow; the system Node is untouched)
#   releases/        the last 5 releases     shared/env.json  settings from GitHub secrets
#   logs/            api.log, web.log        .pm2/            our own pm2, apart from any other
set -euo pipefail

NAV_HOME=${NAV_HOME:-$HOME/navagraha}
RELEASE=$(cd "$(dirname "$0")/../.." && pwd)
RUNTIME="$NAV_HOME/runtime/current"
NODE="$RUNTIME/bin/node"
export NAV_HOME PM2_HOME="$NAV_HOME/.pm2" PATH="$RUNTIME/bin:$PATH"
pm2() { "$NODE" "$RUNTIME/pm2/node_modules/pm2/bin/pm2" "$@"; }
setting() { "$NODE" -e 'const s=require(process.argv[1]); process.stdout.write(String(s[process.argv[2]] ?? ""))' "$NAV_HOME/shared/env.json" "$1"; }

API_PORT=$(setting API_PORT)
WEB_PORT=$(setting WEB_PORT)
mkdir -p "$NAV_HOME/logs"
echo "Release $(basename "$RELEASE"); web on 127.0.0.1:$WEB_PORT, API on 127.0.0.1:$API_PORT"

# 1. Migrations and idempotent seed data. Neon keeps point-in-time history (Neon → Restore),
#    which is the way back from a bad migration; migrations only go forward.
with_env() { "$NODE" -e '
  const s = require(process.argv[1]);
  const { spawnSync } = require("node:child_process");
  const r = spawnSync(process.argv[2], process.argv.slice(3), {
    stdio: "inherit", env: { ...process.env, ...s, NODE_ENV: "production" } });
  process.exit(r.status ?? 1);' "$NAV_HOME/shared/env.json" "$@"; }
(cd "$RELEASE" && with_env "$NODE" packages/db/dist/scripts/migrate.js \
  && with_env "$NODE" packages/db/dist/scripts/seed.js)

# 2. Start this release; on failure go back to the previous one.
PREVIOUS=$(readlink -f "$NAV_HOME/current" 2>/dev/null || true)
start_release() {
  pm2 delete navagraha-api navagraha-web >/dev/null 2>&1 || true
  RELEASE="$1" pm2 start "$1/deploy/vps/ecosystem.config.cjs" >/dev/null
}
healthy() {
  for _ in $(seq 1 60); do
    if "$NODE" -e '
      const get = (port, path) => fetch(`http://127.0.0.1:${port}${path}`, { redirect: "manual" })
        .then((r) => { if (r.status >= 400) throw new Error(String(r.status)); });
      Promise.all([get(process.argv[1], "/v1/health"), get(process.argv[2], "/")])
        .then(() => process.exit(0), () => process.exit(1));' "$API_PORT" "$WEB_PORT"; then
      return 0
    fi
    sleep 2
  done
  return 1
}

start_release "$RELEASE"
if healthy; then
  ln -sfn "$RELEASE" "$NAV_HOME/current.next" && mv -Tf "$NAV_HOME/current.next" "$NAV_HOME/current"
  pm2 save >/dev/null
  echo "Healthy."
else
  echo "The new release is not healthy. Last API log lines:" >&2
  tail -n 30 "$NAV_HOME/logs/api.log" >&2 || true
  echo "If the log says the port is in use, set the WEB_PORT / API_PORT variables in GitHub." >&2
  if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ] && [ "$PREVIOUS" != "$RELEASE" ]; then
    echo "Switching back to $(basename "$PREVIOUS")." >&2
    start_release "$PREVIOUS"
    pm2 save >/dev/null
  fi
  exit 1
fi

# 3. Start again after a server reboot (a user crontab entry; no root needed).
BOOT="@reboot PM2_HOME=$PM2_HOME $NODE $RUNTIME/pm2/node_modules/pm2/bin/pm2 resurrect # navagraha"
if command -v crontab >/dev/null; then
  if ! { crontab -l 2>/dev/null | grep -v '# navagraha$'; echo "$BOOT"; } | crontab - 2>/dev/null; then
    echo "::warning::Could not add the reboot entry (crontab refused); after a server reboot, re-run the deploy."
  fi
else
  echo "::warning::crontab is not available; after a server reboot, re-run the deploy."
fi

# 4. Keep the last 5 releases and the last 2 runtimes.
ls -1dt "$NAV_HOME"/releases/*/ | tail -n +6 | while read -r old; do
  [ "$(readlink -f "$old")" = "$(readlink -f "$NAV_HOME/current")" ] || rm -rf "$old"
done
ls -1dt "$NAV_HOME"/runtime/*/ | grep -v '/current/$' | tail -n +3 | while read -r old; do
  [ "$(readlink -f "$old")" = "$(readlink -f "$RUNTIME")" ] || rm -rf "$old"
done

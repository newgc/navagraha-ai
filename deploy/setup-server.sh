#!/usr/bin/env bash
# One-time setup of a Debian 12 VPS for Navagraha AI, next to whatever already runs there.
#
#   sudo DOMAIN=navagrahaai.newgc.in LETSENCRYPT_EMAIL=you@example.com bash setup-server.sh
#
# Safe to run again: it never overwrites the secrets file, the database or an existing site.
# What it does (and nothing else):
#   - a system user `navagraha` owning /srv/navagraha (releases, shared/.env, backups)
#   - Node.js 22 in /opt/navagraha-node, private to this app (the system's Node is untouched)
#   - PostgreSQL 16 (PGDG apt repo), listening on localhost only, with its own role and database
#   - systemd services navagraha-api / navagraha-web, bound to 127.0.0.1, memory-capped
#   - an Nginx site for $DOMAIN proxying to the web app, then HTTPS via Let's Encrypt
#   - a deploy SSH key for GitHub Actions and a sudo rule that only allows restarting the two services
# It does not touch other Nginx sites, the firewall, PHP or MySQL.
set -euo pipefail

DOMAIN="${DOMAIN:-navagrahaai.newgc.in}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"
APP_USER=navagraha
BASE=/srv/navagraha
NODE_DIR=/opt/navagraha-node
NODE_MAJOR=22
API_PORT=4100
WEB_PORT=3100
DB_NAME=navagraha

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
die() { printf '\n\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "Run with sudo."
. /etc/os-release
[ "${ID:-}" = debian ] && [ "${VERSION_ID:-}" = 12 ] || die "Written for Debian 12; this is ${PRETTY_NAME:-unknown}."
NGINX=$(command -v nginx || echo /usr/sbin/nginx)
[ -x "$NGINX" ] || die "Nginx not found. This script adds a site to an existing Nginx; tell Claude which web server runs here."

for port in "$API_PORT" "$WEB_PORT"; do
  if ss -ltnH "( sport = :$port )" | grep -q .; then
    if ! systemctl is-active --quiet navagraha-api navagraha-web 2>/dev/null; then
      die "Port $port is already in use by something else. Change API_PORT/WEB_PORT at the top of this script."
    fi
  fi
done

say "Packages"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl ca-certificates gnupg xz-utils postgresql-common >/dev/null
# Reuse a certbot that is already here (e.g. the one serving the other sites); otherwise install it.
if ! command -v certbot >/dev/null; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
fi
if ! [ -f /etc/apt/sources.list.d/pgdg.list ] && ! grep -rqs apt.postgresql.org /etc/apt/sources.list.d/; then
  /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y >/dev/null
fi
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql-16 >/dev/null
systemctl enable --now postgresql >/dev/null

say "User and folders"
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$BASE" --shell /bin/bash "$APP_USER"
fi
install -d -o "$APP_USER" -g "$APP_USER" -m 750 "$BASE" "$BASE/releases" "$BASE/shared" "$BASE/backups" "$BASE/.ssh"
chmod 700 "$BASE/.ssh"

say "Node.js $NODE_MAJOR (private copy in $NODE_DIR)"
install -d -m 755 "$NODE_DIR"
SHASUMS=$(curl -fsSL "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/SHASUMS256.txt")
TARBALL=$(printf '%s\n' "$SHASUMS" | awk '/linux-x64\.tar\.xz$/ {print $2}')
VERSION_DIR="$NODE_DIR/${TARBALL%.tar.xz}"
if [ ! -x "$VERSION_DIR/bin/node" ]; then
  TMP=$(mktemp -d)
  curl -fsSL -o "$TMP/$TARBALL" "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/$TARBALL"
  (cd "$TMP" && printf '%s\n' "$SHASUMS" | grep " $TARBALL\$" | sha256sum -c - >/dev/null) || die "Node.js checksum mismatch"
  tar -xJf "$TMP/$TARBALL" -C "$NODE_DIR"
  rm -rf "$TMP"
fi
ln -sfn "$VERSION_DIR" "$NODE_DIR/current"
echo "Node $("$NODE_DIR/current/bin/node" -v)"

say "PostgreSQL role and database"
if ! sudo -u postgres psql -tAc "select 1 from pg_roles where rolname='$APP_USER'" | grep -q 1; then
  DB_PASSWORD=$(openssl rand -hex 24)
  sudo -u postgres psql -q -c "create role $APP_USER login password '$DB_PASSWORD'"
  sudo -u postgres psql -q -c "create database $DB_NAME owner $APP_USER"
else
  DB_PASSWORD=""
fi

say "Secrets ($BASE/shared/.env)"
ENV_FILE="$BASE/shared/.env"
if [ ! -f "$ENV_FILE" ]; then
  [ -n "$DB_PASSWORD" ] || die "The database role exists but $ENV_FILE does not. Restore the file, or drop the role and re-run."
  umask 077
  cat > "$ENV_FILE" <<ENV
# Navagraha AI — server-only settings. Never commit this file.
NODE_ENV=production
# staging: sign-in codes go to the API log until an SMS provider is chosen (D-11).
DEPLOY_ENV=staging
API_HOST=127.0.0.1
API_PORT=$API_PORT
WEB_PORT=$WEB_PORT
API_URL=http://127.0.0.1:$API_PORT
DATABASE_URL=postgres://$APP_USER:$DB_PASSWORD@127.0.0.1:5432/$DB_NAME
AUTH_SECRET=$(openssl rand -base64 48 | tr -d '\n')
OTP_SENDER=console
ENV
  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  umask 022
else
  echo "Kept the existing $ENV_FILE"
fi

say "Services"
cat > /etc/systemd/system/navagraha-api.service <<UNIT
[Unit]
Description=Navagraha AI API
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$BASE/current/apps/api
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_DIR/current/bin/node dist/main.js
Restart=always
RestartSec=3
MemoryMax=1G
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=full
ProtectHome=yes

[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/navagraha-web.service <<UNIT
[Unit]
Description=Navagraha AI web app
After=network-online.target navagraha-api.service
Wants=network-online.target

[Service]
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$BASE/current/apps/web
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_DIR/current/bin/node node_modules/next/dist/bin/next start -H 127.0.0.1 -p \${WEB_PORT}
Restart=always
RestartSec=3
MemoryMax=1536M
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=full
ProtectHome=yes

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
# Started by the first deploy, once there is a release to run.
systemctl enable navagraha-api.service navagraha-web.service >/dev/null

say "Deploy permissions"
cat > /etc/sudoers.d/navagraha <<SUDO
# GitHub Actions deploys as $APP_USER and may only restart its own two services.
$APP_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart navagraha-api.service navagraha-web.service
SUDO
chmod 440 /etc/sudoers.d/navagraha
visudo -cf /etc/sudoers.d/navagraha >/dev/null || { rm -f /etc/sudoers.d/navagraha; die "sudoers rule invalid"; }

# Admin command: sudo navagraha grant-role ..., sudo navagraha codes, ...
cat > /usr/local/bin/navagraha <<'CLI'
#!/usr/bin/env bash
# Runs the admin tool of the current Navagraha release as the app user.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run with sudo: sudo navagraha $*" >&2; exit 1; }
if [ "${1:-}" = codes ]; then
  # Recent sign-in codes (staging only: printed because there is no SMS provider yet).
  journalctl -u navagraha-api --since "${2:-15 min ago}" --no-pager -o cat | grep 'Sign-in code' || echo "No codes in that window."
  exit 0
fi
exec runuser -u navagraha -- env INIT_CWD="$PWD" /srv/navagraha/current/deploy/nav "$@"
CLI
chmod 755 /usr/local/bin/navagraha

KEY="$BASE/.ssh/github_deploy"
if [ ! -f "$KEY.pub" ]; then
  sudo -u "$APP_USER" ssh-keygen -q -t ed25519 -N '' -C "github-actions-deploy@$DOMAIN" -f "$KEY"
  cat "$KEY.pub" >> "$BASE/.ssh/authorized_keys"
  chown "$APP_USER:$APP_USER" "$BASE/.ssh/authorized_keys"
  chmod 600 "$BASE/.ssh/authorized_keys"
  NEW_KEY=1
fi

say "Nginx site for $DOMAIN"
if [ -d /etc/nginx/sites-available ]; then
  SITE=/etc/nginx/sites-available/navagraha
  LINK=/etc/nginx/sites-enabled/navagraha
else
  SITE=/etc/nginx/conf.d/navagraha.conf
  LINK=""
fi
# Listen on IPv6 only if this server has it; otherwise nginx -t would fail.
LISTEN6=""
[ -s /proc/net/if_inet6 ] && LISTEN6="listen [::]:80;"
if [ ! -f "$SITE" ]; then
  cat > "$SITE" <<NGINX
# Navagraha AI ($DOMAIN). Only the web app is public; the API listens on 127.0.0.1.
server {
    listen 80;
    $LISTEN6
    server_name $DOMAIN;

    client_max_body_size 6m;   # temple data workbook uploads (5 MB)

    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    location / {
        proxy_pass http://127.0.0.1:$WEB_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_read_timeout 60s;
    }
}
NGINX
  [ -n "$LINK" ] && ln -sfn "$SITE" "$LINK"
  if ! "$NGINX" -t 2>/tmp/navagraha-nginx-test; then
    rm -f "$SITE" ${LINK:+"$LINK"}
    cat /tmp/navagraha-nginx-test
    die "Nginx rejected the configuration; nothing was changed. Send this output to Claude."
  fi
  systemctl reload nginx
else
  echo "Kept the existing $SITE"
fi

say "HTTPS"
PUBLIC_IP=$(curl -4 -fsS https://ifconfig.me || true)
DNS_IP=$(getent ahostsv4 "$DOMAIN" | awk 'NR==1 {print $1}')
if [ -z "$LETSENCRYPT_EMAIL" ]; then
  echo "Skipped: set LETSENCRYPT_EMAIL and re-run to get a certificate."
elif [ -z "$DNS_IP" ] || [ "$DNS_IP" != "$PUBLIC_IP" ]; then
  echo "Skipped: $DOMAIN points to '${DNS_IP:-nothing}', this server is $PUBLIC_IP. Fix DNS, wait, re-run."
elif [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  echo "Certificate already present."
else
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$LETSENCRYPT_EMAIL" --redirect
fi

say "Done"
cat <<NEXT
Add these as GitHub repository secrets (Settings → Secrets and variables → Actions,
environment "staging") for newgc/navagraha-ai:

  STAGING_HOST         $PUBLIC_IP
  STAGING_USER         $APP_USER
  STAGING_PORT         $(sshd -T 2>/dev/null | awk '/^port / {print $2; exit}' || echo 22)
  STAGING_KNOWN_HOSTS  (paste the output of: ssh-keyscan -p <port> localhost)
  STAGING_SSH_KEY      (paste the private key printed below, then clear your terminal)
NEXT
if [ "${NEW_KEY:-0}" = 1 ]; then
  echo
  echo "---- private deploy key (shown once; it is deleted from the server now) ----"
  cat "$KEY"
  shred -u "$KEY"
  echo "---------------------------------------------------------------------------"
else
  echo "(The deploy key was created on an earlier run. To make a new one: sudo rm $KEY.pub, remove its line from $BASE/.ssh/authorized_keys, re-run.)"
fi

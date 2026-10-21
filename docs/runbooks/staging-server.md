# Staging server — navagrahaai.newgc.in

Navagraha runs on the same Debian 12 VPS as InstaLeads, kept apart from it: its own Linux
user (`navagraha`), its own Node.js 22 (`/opt/navagraha-node`, the system Node is untouched),
its own PostgreSQL 16 database (localhost only), memory-capped services, and one Nginx site.
Only the web app is public; the API listens on `127.0.0.1:4100` and is reached by the web app.

| What                                            | Where                                                          |
| ----------------------------------------------- | -------------------------------------------------------------- |
| Releases (last 5)                               | `/srv/navagraha/releases/`, `current` → the live one           |
| Secrets                                         | `/srv/navagraha/shared/.env` (created once, never overwritten) |
| Database backups (before every deploy, last 10) | `/srv/navagraha/backups/`                                      |
| Services                                        | `navagraha-api`, `navagraha-web` (systemd)                     |
| Nginx site                                      | `/etc/nginx/sites-available/navagraha`                         |

It is **staging**: there is no SMS provider yet (D-11), so sign-in codes are written to the
API log instead of being sent. Real customers cannot sign in until a provider is chosen.

## First-time setup

1. **DNS** — GoDaddy → `newgc.in` → DNS → add an `A` record, name `navagrahaai`, value the
   VPS IPv4 address (`curl -4 ifconfig.me` on the VPS), TTL 600. Check with
   `nslookup navagrahaai.newgc.in`.
2. **Copy the setup script to the VPS.** In GitHub open `deploy/setup-server.sh` → _Raw_,
   copy all of it, then on the VPS: `nano ~/setup-server.sh`, paste, save.
3. **Run it** (safe to re-run):
   ```sh
   sudo DOMAIN=navagrahaai.newgc.in LETSENCRYPT_EMAIL=you@example.com bash ~/setup-server.sh
   ```
   It stops with a clear message if anything doesn't fit (another app on ports 3100/4100,
   Nginx rejecting the site — in which case nothing is changed). If DNS is not pointing at
   the server yet it skips HTTPS; re-run once it does.
4. **GitHub secrets** — GitHub → `newgc/navagraha-ai` → Settings → Environments → New
   environment `staging` → add the secrets the script printed: `STAGING_HOST`,
   `STAGING_USER`, `STAGING_PORT`, `STAGING_SSH_KEY` (the private key it printed once — then
   clear your terminal), and `STAGING_KNOWN_HOSTS` (output of
   `ssh-keyscan -p <port> localhost` run on the VPS).
5. **First deploy** — GitHub → Actions → _Deploy staging_ → _Run workflow_. After that, every
   push to `main` deploys itself once CI is green.
6. **Staff** — give yourself and the team their roles:
   ```sh
   sudo navagraha grant-role --phone "98765 43210" --role OPS_MANAGER --actor "Vaithy"
   ```
   Roles: `OPS_COORDINATOR`, `OPS_MANAGER`, `FINANCE`, `CONTENT_ADMIN`, `SYSTEM_ADMIN`.

## Everyday

- **Sign-in codes** (staging only): `sudo navagraha codes` shows codes from the last 15
  minutes (`sudo navagraha codes "1 hour ago"` for longer). Phones are shown masked, last
  four digits visible.
- **Temple workbook** — content admins upload it at `/ops/temples`. From the server:
  `cp workbook.xlsx /tmp/ && sudo navagraha import-temples /tmp/workbook.xlsx --actor "Name"`
  (add `--apply` to import).
- **Logs** — `sudo journalctl -u navagraha-api -f`, `sudo journalctl -u navagraha-web -f`.
- **Status / restart** — `systemctl status navagraha-api navagraha-web`,
  `sudo systemctl restart navagraha-api navagraha-web`.

## How a deploy works

GitHub Actions builds the commit CI just tested, ships it (production dependencies only) to
`/srv/navagraha/releases/<time>-<commit>/` and runs `deploy/remote-deploy.sh` there:

1. backs up the database (`pg_dump`, last 10 kept);
2. runs migrations and the idempotent seed;
3. switches `current` to the new release and restarts both services;
4. checks `/v1/health` and the home page; **if either fails it switches back** to the
   previous release and restarts it, and the workflow fails.

## Rolling back by hand

```sh
ls -1t /srv/navagraha/releases/                 # pick the release to go back to
sudo -u navagraha ln -sfn /srv/navagraha/releases/<release> /srv/navagraha/current
sudo systemctl restart navagraha-api navagraha-web
```

Migrations only go forward. If one must be undone, restore the backup taken before it:

```sh
sudo systemctl stop navagraha-api navagraha-web
gunzip -c /srv/navagraha/backups/db-<time>.sql.gz | sudo -u postgres psql -d navagraha   # into an emptied database
```

Do that with Claude's help — restoring over a live database needs care.

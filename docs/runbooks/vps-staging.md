# Staging on the InstaLeads VPS — navagrahayathra.in

Staging runs on the Contabo VPS in India that already hosts InstaLeads, with its database on
Neon's free plan. **Extra cost: $0.** It runs as an ordinary user (`vaithy`), so no root is
needed for deploys. Every push to `main` that passes CI deploys itself
(`.github/workflows/deploy-vps.yml`).

**Your part:** steps 1–4 below, in the Neon and GitHub websites plus **one copy-paste
command** on the VPS. **Someone with root on the VPS** (whoever runs InstaLeads) does step 5
once, about 5 minutes.

**What runs on the VPS** (all inside `~/navagraha`, nothing else on the server is touched):

- its own Node.js 22 and pm2, uploaded by the deploy (the server's Node 18 is untouched);
- the web app on `127.0.0.1:3100` and the API on `127.0.0.1:4100`, each memory-capped so
  it cannot squeeze InstaLeads; pm2 restarts them if they stop, and a user crontab entry
  starts them after a reboot;
- nginx (step 5) is the only public entrance and adds HTTPS.

**Staging holds test data only.** Anyone with root on this shared server can read the
Navagraha settings and logs, and Neon has no India region (the data sits in Singapore). Before
real customers' data (MR-37), production moves to the encrypted Lightsail database in Mumbai:
[aws-lightsail.md](aws-lightsail.md).

**Sign-in:** there is no SMS provider yet (D-11), so sign-in codes are read with the
**Staging sign-in codes** button in GitHub (step 6).

---

## 1. Database (Neon website)

1. **neon.tech → Sign up** (Free plan, no card).
2. **Create project**: name `navagraha-staging`, Postgres **16**, AWS region **Asia Pacific
   (Singapore)** (closest to India), database name **`navagraha`**.
3. **Connect** → turn **Connection pooling off** → copy the connection string
   (`postgresql://…neon.tech/navagraha?sslmode=require&channel_binding=require`). Paste it as
   is; the app always checks the database's certificate. It contains the password: it goes
   only into the GitHub secret `DATABASE_URL`, never into chat or email.

## 2. A deploy key (one command on the VPS)

Log in to the VPS as `vaithy` the way you normally do, paste this **whole line**, press Enter:

```sh
mkdir -p ~/.ssh && chmod 700 ~/.ssh && ssh-keygen -q -t ed25519 -N '' -C github-navagraha-deploy -f ~/.ssh/navagraha_deploy && echo "restrict $(cat ~/.ssh/navagraha_deploy.pub)" >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo '===== VPS_SSH_KEY =====' && cat ~/.ssh/navagraha_deploy && echo '===== VPS_KNOWN_HOSTS =====' && ssh-keyscan localhost 2>/dev/null && echo '===== done =====' && rm -f ~/.ssh/navagraha_deploy ~/.ssh/navagraha_deploy.pub
```

It prints two blocks. Copy each straight into GitHub (step 3) — not into chat or email:

- **`VPS_SSH_KEY`**: from `-----BEGIN OPENSSH PRIVATE KEY-----` to
  `-----END OPENSSH PRIVATE KEY-----`, both lines included. The command deletes the server's
  copy; GitHub keeps the only one.
- **`VPS_KNOWN_HOSTS`**: every line between `VPS_KNOWN_HOSTS` and `done` (they start with
  `localhost`). This lets GitHub check it is really talking to your server.

If you log in on a port other than 22, the scan needs it: replace `ssh-keyscan localhost`
with `ssh-keyscan -p PORT localhost`.

## 3. GitHub settings

GitHub → `newgc/navagraha-ai` → **Settings → Environments** → `staging` (create it if it is
not there).

**Environment secrets**

| Name              | Value                                                                     |
| ----------------- | ------------------------------------------------------------------------- |
| `VPS_HOST`        | the server's IP address (Contabo panel), e.g. `203.0.113.10`              |
| `VPS_USER`        | `vaithy`                                                                  |
| `VPS_SSH_KEY`     | from step 2                                                               |
| `VPS_KNOWN_HOSTS` | from step 2                                                               |
| `DATABASE_URL`    | the Neon connection string from step 1                                    |
| `AUTH_SECRET`     | a new random string of 48+ characters from a password manager's generator |

**Environment variables**

| Name                     | Value                                                           |
| ------------------------ | --------------------------------------------------------------- |
| `BOOTSTRAP_ADMIN_PHONES` | your mobile number, e.g. `98765 43210` (first System Admin)     |
| `VPS_PORT`               | only if you log in to the VPS on a port other than 22           |
| `WEB_PORT`, `API_PORT`   | only if 3100 / 4100 are taken on the server (step 5 must match) |

## 4. First deploy

GitHub → **Actions → Deploy to VPS → Run workflow**. About 10 minutes the first time. When it
is green the app is running on the server, but not yet public — that is step 5.

If it fails, open the failed step: _Set up SSH_ means the host, user, key or known-hosts
values (step 2–3); _Deploy_ shows the last API log lines (a database error means
`DATABASE_URL`; "address already in use" means set `WEB_PORT` / `API_PORT`).

## 5. Public address and HTTPS (once, by someone with root)

Send this section to whoever administers the VPS, after step 4 has run once. The first deploy
puts the whole nginx site on the server at
`~vaithy/navagraha/current/deploy/vps/nginx-staging.conf`; it proxies
`navagrahayathra.in` to `127.0.0.1:3100` (change the port in the copy if `WEB_PORT` was set).

```sh
sudo cp ~vaithy/navagraha/current/deploy/vps/nginx-staging.conf /etc/nginx/sites-available/navagrahayathra.in
sudo ln -s /etc/nginx/sites-available/navagrahayathra.in /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d navagrahayathra.in     # apt install certbot python3-certbot-nginx if missing
```

**This VPS uses CloudPanel** (how staging is set up today): **Sites → Add site → Node.js** for
`navagrahayathra.in` with **App Port `3200`**, Let's Encrypt on. CloudPanel only accepts a
port that is free when saving, so the GitHub variable `WEB_PORT` is `3200` to match; the
deploy then runs the app there (nothing is started from CloudPanel). To change the port
later: pick a free one in CloudPanel first, then set `WEB_PORT` to it and run the deploy.

Other panels (Plesk, aaPanel, …): a reverse proxy to `http://127.0.0.1:<WEB_PORT>` with
Let's Encrypt and uploads up to 10 MB.

DNS: the domain `navagrahayathra.in` (and `www`) must have `A` records pointing to the VPS IP.

If the site shows **502 Bad Gateway**, nginx is up but cannot reach the app: run **Actions →
Staging status** — it shows whether the apps answer on 127.0.0.1 and which port nginx sends
`navagrahayathra.in` to; the two must match (3100 unless `WEB_PORT` was set).

## 6. First sign-in

1. Open `https://navagrahayathra.in/sign-in` and enter your mobile number.
2. GitHub → **Actions → Staging sign-in codes → Run workflow** → open the run → the step
   shows `Sign-in code for +91******1234: 123456`. Enter that code (codes expire quickly).
3. **Team** (top menu) → add your coordinators, managers, finance and content people. They
   read their codes the same way until SMS is set up.

---

## Everyday

- **A deploy failed** — the previous release keeps running (the deploy switches back
  automatically if the new one is unhealthy). The failed step in Actions shows why.
- **Roll back** — revert the change on `main` and let it deploy. Migrations only go forward;
  Neon → **Restore** puts the database back to a recent point in time.
- **Server rebooted** — the apps start again by themselves. If the site stays down, run
  **Deploy to VPS** once.
- **Temple data** — content admins upload the workbook at `/ops/temples`.

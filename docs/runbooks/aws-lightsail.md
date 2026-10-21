# Hosting on AWS Lightsail — navagrahaai.newgc.in

Everything here is done by clicking in the AWS, GitHub and GoDaddy websites. After the
one-time setup, every push to `main` that passes CI deploys itself.

**What runs:** one Lightsail **container service** with two containers from the same image
— `web` (the public website) and `api` (reachable only from `web`, over localhost) — and one
Lightsail **PostgreSQL 16** database, encrypted at rest, reached over verified TLS.
Lightsail keeps the previous deployment running until a new one is healthy.

**Cost:** about US$45 a month — container service _Small_ ($15) + database _Standard 2 GB,
encrypted_ ($30). Prices from the Lightsail pricing page, October 2026.

**Staging:** there is no SMS provider yet (D-11), so sign-in codes appear in the container
logs instead of being sent. Real customers cannot sign in until one is chosen.

---

## 1. Database (Lightsail console)

1. Sign in to the AWS console, open **Lightsail**, and pick region **Mumbai (ap-south-1)**
   (top right). Use the same region for everything below.
2. **Databases → Create database**
   - Database: **PostgreSQL**, the newest **16.x** version.
   - Login credentials: keep the user name **`dbmasteruser`**. Choose **Specify your own
     password** and use a long random one from a password manager. Save it — it becomes the
     `DB_PASSWORD` secret.
   - Master database name: **`navagraha`**.
   - Plan: **Standard, 2 GB, $30** (the cheapest _encrypted_ plan; the database holds
     travellers' names and phone numbers — MR-37).
   - Name: `navagraha-db` → **Create database**. It takes about 15 minutes.
3. When it is _Available_, open it and copy the **Endpoint** (looks like
   `ls-xxxx.xxxx.ap-south-1.rds.amazonaws.com`). That is `DB_ENDPOINT`.
   Leave **Public mode** off.

## 2. Container service (Lightsail console)

1. **Containers → Create container service**, same region.
2. Power **Small** ($15), scale **1**. Keep scale at 1: migrations run when the API starts
   and are not coordinated between several copies.
3. Skip "Set up deployment" — GitHub will deploy.
4. Name it **`navagraha`** → **Create container service**.

## 3. A deploy key for GitHub (IAM console)

1. AWS console → **IAM → Policies → Create policy → JSON**. Paste the contents of
   `deploy/aws/iam-deploy-policy.json` from this repository. Name it
   `NavagrahaLightsailDeploy`. It only allows pushing images and deploying to Lightsail
   container services.
2. **IAM → Users → Create user** `github-navagraha-deploy` (no console access) → **Attach
   policies directly** → tick `NavagrahaLightsailDeploy` → create.
3. Open the user → **Security credentials → Create access key** → _Application running
   outside AWS_ → copy the **Access key ID** and **Secret access key** (shown once).

## 4. GitHub settings

GitHub → `newgc/navagraha-ai` → **Settings → Environments → New environment** `staging`.

**Environment secrets**

| Name                    | Value                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| `AWS_ACCESS_KEY_ID`     | from step 3                                                                                         |
| `AWS_SECRET_ACCESS_KEY` | from step 3                                                                                         |
| `DB_PASSWORD`           | the database password from step 1                                                                   |
| `AUTH_SECRET`           | a new random string of 48+ characters from a password manager's generator. Never reuse it anywhere. |

**Environment variables**

| Name                     | Value                                                                   |
| ------------------------ | ----------------------------------------------------------------------- |
| `AWS_REGION`             | `ap-south-1`                                                            |
| `LIGHTSAIL_SERVICE`      | `navagraha`                                                             |
| `DB_ENDPOINT`            | from step 1                                                             |
| `DB_USER`                | `dbmasteruser`                                                          |
| `DB_NAME`                | `navagraha`                                                             |
| `BOOTSTRAP_ADMIN_PHONES` | your mobile number, e.g. `98765 43210` (becomes the first System Admin) |

Then **Actions → Deploy to AWS → Run workflow**. It takes about 10 minutes the first time.
When it is green, Lightsail → `navagraha` shows the deployment _Active_ and a public address
like `https://navagraha.xxxx.ap-south-1.cs.amazonlightsail.com` — open it to check.

## 5. Your domain

1. Lightsail → `navagraha` → **Custom domains → Create certificate** for
   `navagrahaai.newgc.in`. Lightsail shows a **CNAME record** to prove you own the domain.
2. GoDaddy → `newgc.in` → DNS → **Add** that CNAME exactly as shown (name and value).
   **Delete** the old `A` record for `navagrahaai` that pointed to the VPS.
3. When the certificate shows _Valid_ (minutes to an hour), attach it / enable the custom
   domain for the service.
4. GoDaddy → add a **CNAME**: name `navagrahaai`, value the service's public domain
   (`navagraha.xxxx.ap-south-1.cs.amazonlightsail.com`, without `https://`).

## 6. First sign-in

1. Open `https://navagrahaai.newgc.in/sign-in` and enter your mobile number.
2. Lightsail → `navagraha` → **Logs** → container **api** → look for
   `Sign-in code for +91******1234: 123456`, and enter that code.
3. **Team** (top menu) → add your coordinators, managers, finance and content people.
   They sign in the same way; read their codes from the same log until SMS is set up.

---

## Everyday

- **A deploy failed** — Actions shows the error; Lightsail keeps the previous version
  running. Lightsail → `navagraha` → **Deployments** and **Logs** show why.
- **Roll back** — Lightsail → `navagraha` → **Deployments** → pick an earlier version →
  _Modify and redeploy_. Migrations only go forward; Lightsail backs up the database daily
  (Database → _Snapshots_), and a snapshot can be restored to a new database.
- **Sign-in codes** — Logs → container `api` (staging only).
- **Temple data** — content admins upload the workbook at `/ops/temples`.

## If the API cannot reach the database

The API log then shows a connection error at start. Check `DB_ENDPOINT` and `DB_PASSWORD`
first. If they are right, open the database → **Networking** and enable **Public mode**
(the connection still needs the password and is encrypted and certificate-checked), then
redeploy.

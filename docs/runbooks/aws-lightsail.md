# Hosting on AWS Lightsail — navagrahaai.newgc.in

Everything here is done by clicking in the AWS, Neon, GitHub and GoDaddy websites. After the
one-time setup, every push to `main` that passes CI deploys itself.

**What runs:** one Lightsail **container service** with two containers from the same image
— `web` (the public website) and `api` (reachable only from `web`, over localhost). Staging's
database is a free **Neon** PostgreSQL 16 database (encrypted at rest), reached over verified
TLS. Lightsail keeps the previous deployment running until a new one is healthy.

**Cost (staging):** about US$10 a month — container service _Micro_ ($10; new AWS accounts
get it free for the first 3 months) + Neon _Free_ plan ($0: 0.5 GB storage, 100 compute
hours a month; the database sleeps after 5 idle minutes, so the first request after a quiet
spell takes about a second longer). Prices from the Lightsail and Neon pricing pages,
October 2026.

**Staging holds test data only.** Neon's free plan has no Mumbai region, so the data sits in
Singapore. Before real customers' names and phone numbers go in (MR-37), move to the
encrypted Lightsail database in Mumbai — see [Before real customers](#before-real-customers).

**Staging sign-in:** there is no SMS provider yet (D-11), so sign-in codes appear in the
container logs instead of being sent. Real customers cannot sign in until one is chosen.

---

## 1. Database (Neon website)

1. Go to **neon.tech → Sign up** (sign in with Google or GitHub is fine). The Free plan needs
   no card.
2. **Create project**
   - Project name: `navagraha-staging`
   - Postgres version: **16**
   - Cloud provider **AWS**, region **Asia Pacific (Singapore)** — the closest to Mumbai.
   - Database name: **`navagraha`** → **Create project**.
3. On the project dashboard click **Connect**. In the dialog:
   - Branch `production`, database `navagraha`, role `neondb_owner` (or the role shown).
   - Turn **Connection pooling off** (the app keeps its own small pool; migrations need a
     direct connection).
   - Copy the **connection string**. It looks like
     `postgresql://neondb_owner:xxxx@ep-xxxx.ap-southeast-1.aws.neon.tech/navagraha?sslmode=require&channel_binding=require`.
     Paste it as is — the app keeps the TLS certificate check on regardless of the URL. It
     contains the password, so it goes **only** into the GitHub secret `DATABASE_URL`
     (step 4), never into chat or email.

## 2. Container service (Lightsail console)

1. **Containers → Create container service**, same region.
2. Power **Micro** ($10, 1 GB memory — enough for staging), scale **1**. Keep scale at 1: migrations run when the API starts
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
| `DATABASE_URL`          | the Neon connection string from step 1                                                              |
| `AUTH_SECRET`           | a new random string of 48+ characters from a password manager's generator. Never reuse it anywhere. |

**Environment variables**

| Name                     | Value                                                                   |
| ------------------------ | ----------------------------------------------------------------------- |
| `AWS_REGION`             | `ap-south-1`                                                            |
| `LIGHTSAIL_SERVICE`      | `navagraha`                                                             |
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
  _Modify and redeploy_. Migrations only go forward; Neon's free plan can restore the
  database to any point in the last 6 hours (Neon → **Restore**).
- **Sign-in codes** — Logs → container `api` (staging only).
- **Temple data** — content admins upload the workbook at `/ops/temples`.

## If the API cannot reach the database

The API log then shows a connection error at start. Check the `DATABASE_URL` secret first:
copy it again from Neon → **Connect** (pooling off) and replace the secret, then **Actions →
Deploy to AWS → Run workflow**. A log line `Database connection closed by the server` on its
own is normal: Neon put the idle database to sleep, and the next request wakes it.

If the API container restarts with an out-of-memory error, set the variable `NODE_HEAP_MB`
lower (default 320) or move the service to the _Small_ power ($15) and set it to `640`.

---

## Before real customers

Do this before the pilot takes real bookings (MR-37: travellers' data encrypted, and kept in
India). Neon stays usable for a separate test site if wanted.

1. Lightsail (region **Mumbai**) → **Databases → Create database**
   - **PostgreSQL**, the newest **16.x** version.
   - Keep user name **`dbmasteruser`**; **Specify your own password** — a long random one
     from a password manager. It becomes the `DB_PASSWORD` secret.
   - Master database name: **`navagraha`**.
   - Plan: **Standard, 2 GB, $30** (the cheapest _encrypted_ plan).
   - Name `navagraha-db` → **Create database** (about 15 minutes).
2. When it is _Available_, copy the **Endpoint**
   (`ls-xxxx.xxxx.ap-south-1.rds.amazonaws.com`). Leave **Public mode** off.
3. GitHub → environment → **delete** the `DATABASE_URL` secret, add the secret
   `DB_PASSWORD`, and the variables `DB_ENDPOINT` (the endpoint), `DB_USER` (`dbmasteruser`)
   and `DB_NAME` (`navagraha`). The deploy then connects to Lightsail and checks its
   certificate against Amazon's bundle in the image.
4. Consider the container power _Small_ for real traffic (variable `NODE_HEAP_MB` = `640`).
5. **Run workflow.** The new database starts empty: the API creates the tables and you sign
   in as the first admin again (step 6). Test data on Neon is not copied.

If the API then cannot reach the Lightsail database, check `DB_ENDPOINT` and `DB_PASSWORD`.
If they are right, open the database → **Networking** and enable **Public mode** (the
connection still needs the password and is encrypted and certificate-checked), then redeploy.

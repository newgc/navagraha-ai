# Navagraha AI

**Your AI Pilgrimage Manager** — AI plans it. Local experts execute it.

A planning, booking and operations platform for the Navagraha temple circuit around
Kumbakonam. The guiding rule (FS §2): **the LLM understands and explains, the product
engine decides, the operations platform executes.**

## Repository layout

| Path                    | What                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `apps/api`              | NestJS API, versioned under `/v1`                                                                         |
| `apps/web`              | Next.js customer web app / PWA                                                                            |
| `packages/domain`       | Pure domain rules: canonical state machines (D-04), confirmation gate, fulfilment and Passport derivation |
| `packages/db`           | PostgreSQL schema (Drizzle), migrations, seed data                                                        |
| `docs/spec`             | MVP Functional Specification V1.1 (original `.docx` and a searchable Markdown copy)                       |
| `docs/decisions`        | Decision records (D-04 draft, D-10)                                                                       |
| `docs/delivery-plan.md` | Phases and what blocks each                                                                               |
| `data`                  | Temple data collection workbook                                                                           |
| `tools/temple-template` | Script that regenerates the workbook                                                                      |

## Getting started

Requires Node 22, pnpm 10 and Docker (or a local PostgreSQL 16).

```sh
cp .env.example .env
docker compose up -d postgres
pnpm install
pnpm build          # builds the shared packages the apps depend on
pnpm db:migrate
pnpm db:seed
pnpm dev:api        # http://localhost:4000/v1/health
pnpm dev:web        # http://localhost:3000
```

## Temple data

The content team fills `data/Navagraha_Temple_Data_Template.xlsx`. To load it:

```sh
pnpm db:import-temples path/to/workbook.xlsx --actor "Your name"          # check only
pnpm db:import-temples path/to/workbook.xlsx --actor "Your name" --apply  # import
```

Content admins can also do this in the browser at `/ops/temples` ("Check only", then "Check and
import"), where the pilot-readiness checklist and each temple's data and verification status are
shown. The check lists every problem by sheet, row and column. Nothing is written while there is
any error. An import replaces schedules, special days, travel times and entry rules, updates
temples, and only offers services marked Verified. Each import is recorded in the audit log
with the file's SHA-256.

## Sign-in and staff roles

Everyone signs in with a phone number and a 6-digit code (`POST /v1/auth/otp/request`, then
`POST /v1/auth/otp/verify`, which returns a bearer token). Codes are sent on WhatsApp through
Hashwa (`OTP_SENDER=whatsapp`, D-11); locally they are printed in the API log, and production
refuses any sender but WhatsApp.

Every API route needs a signed-in user unless it is marked `@Public()`. Staff roles are
granted from the command line and audited:

```sh
pnpm db:grant-role --phone 98765 43210 --role OPS_MANAGER --actor "Your name"
pnpm db:grant-role --phone 98765 43210 --role OPS_MANAGER --actor "Your name" --revoke
```

## Operations console

`apps/web` has the console for coordinators, managers and finance at `/ops` (sign in at
`/sign-in`). It lists bookings, creates concierge bookings, and runs supplier and payment
actions. The browser never holds the API token: sign-in sets an httpOnly cookie and pages call
the API from the server (`apps/web/lib/api.ts`). Set `API_URL` for the web app (default
`http://localhost:4000`).

Browser tests drive the console in Chromium against the real API and a throwaway database:

```sh
pnpm build
E2E_DATABASE_URL=postgres://navagraha:navagraha@localhost:5432/navagraha_e2e pnpm --filter @navagraha/web e2e
```

Add `E2E_SCREENSHOTS=<dir>` to save screenshots of the key screens.

## Concierge (manual) bookings

Operations staff create bookings taken by phone or WhatsApp (FS §12.1). All routes need an
operations role; see `apps/api/src/bookings/booking.schemas.ts` for the request bodies.

| Step                                                                     | Route                                                                           | Who                           |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ----------------------------- |
| Create booking, travellers, itinerary, locked quote, supplier items      | `POST /v1/bookings/manual`                                                      | Coordinator, Manager          |
| List / view                                                              | `GET /v1/bookings?from=&to=&state=`, `GET /v1/bookings/NAV-001001`              | Ops, Finance                  |
| Supplier item: ask → confirm / decline                                   | `POST /v1/fulfilments/{id}/request` · `/confirm` · `/decline`                   | Coordinator, Manager          |
| Replacement supplier item                                                | `POST /v1/bookings/{ref}/fulfilments`                                           | Coordinator, Manager          |
| Record an offline payment (D-19 step 1)                                  | `POST /v1/bookings/{ref}/payments/offline`                                      | Coordinator, Manager, Finance |
| Confirm / reject it (D-19 step 2, a different person)                    | `POST /v1/payments/{id}/confirm` · `/reject`                                    | Finance, Manager              |
| Waive the balance (e.g. complimentary pilot)                             | `POST /v1/bookings/{ref}/payments/waive`                                        | Manager                       |
| Record a change the customer asked for                                   | `POST /v1/bookings/{ref}/change-request`                                        | Coordinator, Manager          |
| Propose the new plan and price · apply when accepted · reject · withdraw | `POST /v1/change-requests/{id}/proposal` · `/approve` · `/reject` · `/withdraw` | Coordinator, Manager          |
| Record a cancellation request · propose the refund                       | `POST /v1/bookings/{ref}/cancel-request` · `POST /v1/cancellations/{id}/review` | Coordinator, Manager          |
| Approve / reject a cancellation                                          | `POST /v1/cancellations/{id}/approve` · `/reject`                               | Manager                       |
| Record a refund paid (D-19, step 1)                                      | `POST /v1/bookings/{ref}/refunds`                                               | Finance, Manager              |
| Confirm / reject it (a different person)                                 | `POST /v1/refunds/{id}/confirm` · `/reject`                                     | Finance, Manager              |

A change is proposed as complete new itinerary and quote versions; when the customer accepts,
the old versions are superseded (never edited). A new travel date asks every supplier again, and
a higher total sends the booking back to pending until the difference is paid. Until D-06 sets
refund tiers, a coordinator proposes each cancellation refund and a manager approves it.

The itinerary is checked structurally and needs the coordinator's sign-off that they checked
timings by hand (D-20). The booking confirms itself, and its Trip is created, as soon as the
payment condition and every mandatory supplier item are both satisfied (FS §33).

## Hosting

**Staging** (`navagrahayathra.in`) runs on the InstaLeads VPS as an ordinary user, with a
free Neon PostgreSQL 16 database (test data only). Every push to `main` deploys there once CI
is green: [docs/runbooks/vps-staging.md](docs/runbooks/vps-staging.md).

Customers request a pilgrimage at `/plan`, operations send a plan and price, and the customer
accepts and pays at `/trips` (D-21, `docs/decisions/D-21-self-service-v1.md`).

Online payments are Razorpay payment links sent on WhatsApp (Cashfree remains a setting); only
the gateway's own records mark a link paid (D-11, `docs/decisions/D-11-payment-gateway-razorpay.md`).

**Production** is planned on AWS Lightsail with an encrypted database in Mumbai (MR-37):
[docs/runbooks/aws-lightsail.md](docs/runbooks/aws-lightsail.md).

The first System Admin comes from `BOOTSTRAP_ADMIN_PHONES`; everyone else is managed on the
**Team** screen (`/ops/team`).

## Checks

```sh
pnpm format:check
pnpm typecheck      # after pnpm build
TEST_DATABASE_URL=postgres://navagraha:navagraha@localhost:5432/navagraha_test pnpm test
```

DB and API tests drop and recreate the schema in `TEST_DATABASE_URL`, so point it at a
throwaway database. Without it those suites are skipped.

## Changing the database

Edit `packages/db/src/schema/*`, then `pnpm db:generate` and commit the new file in
`packages/db/drizzle/`. CI fails if the schema and migrations disagree.

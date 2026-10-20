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

The check lists every problem by sheet, row and column. Nothing is written while there is
any error. An import replaces schedules, special days, travel times and entry rules, updates
temples, and only offers services marked Verified. Each import is recorded in the audit log
with the file's SHA-256.

## Sign-in and staff roles

Everyone signs in with a phone number and a 6-digit code (`POST /v1/auth/otp/request`, then
`POST /v1/auth/otp/verify`, which returns a bearer token). Until an SMS provider is chosen
(D-11) codes are printed in the API log, and production refuses to start that way.

Every API route needs a signed-in user unless it is marked `@Public()`. Staff roles are
granted from the command line and audited:

```sh
pnpm db:grant-role --phone 98765 43210 --role OPS_MANAGER --actor "Your name"
pnpm db:grant-role --phone 98765 43210 --role OPS_MANAGER --actor "Your name" --revoke
```

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

# Navagraha AI — working notes for Claude

Read `docs/spec/functional-spec-v1.1.md` (searchable copy of the FS) for requirements. The FS
owns the D / MR / EC registers (§27–29); use the §29 EC numbering and the §33 state model.
Product Owner decisions in `docs/decisions/` override the FS.

## Non-negotiables from the spec

- The LLM never decides price, availability, feasibility, confirmation or temple completion.
  There is no AI role in `@navagraha/domain` ROLES on purpose.
- Every state change goes through the machine definitions in `packages/domain/src/machines`
  and is written to `state_transition`. Never update a status column directly.
- `state_transition` and `audit_log` are append-only (DB triggers). Corrections are new rows.
- Customers can never move a TempleVisit (NFR-18). `machines.test.ts` pins the customer
  allow-list; changing it needs a Product Owner decision.
- Operational facts (temple hours, fees, travel times) carry provenance columns and are shown
  as fact only when `verification_status = 'VERIFIED'`. Never invent them, including in seeds.
- Open business policy (D-06 refunds/deposit, D-07 GST, D-08 rates) is configuration, never
  hard-coded. Don't silently decide it — raise it.
- Money is integer paise.
- A person acts with their roles in `inActingOrder` (staff before CUSTOMER), so history records
  the coordinator, not the customer role every user also holds. System steps use `systemActor`
  with the triggering user kept.
- Offline payments need two different people (D-19); itineraries are not engine-checked until
  P2 and say so in `validation.level` (D-20).

## Conventions

- pnpm workspaces, all packages ESM. Relative imports end in `.js`.
- NestJS: inject with explicit `@Inject(Token)`; there is no decorator-metadata emit, so
  constructor injection by type alone will not work.
- API routes live under `/v1`. Every request has a correlation ID (`x-correlation-id`).
- Every route requires a signed-in user unless marked `@Public()`; restrict with `@Roles(...)`.
  Validate request bodies with zod via `parseBody`. Record sensitive mutations with
  `AuditService`. Never put OTP codes, tokens or full phone numbers in logs (use `maskPhone`).
- Tests: Vitest. DB/API suites need `TEST_DATABASE_URL` and wipe that database. Browser tests
  (`apps/web/e2e`, Playwright) need `E2E_DATABASE_URL` and built apps; locally set
  `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium` if Playwright's own browser isn't installed.
- Web: the API token stays in an httpOnly cookie; only server code (`lib/api.ts`, server
  actions) calls the API. `@navagraha/db` must not be imported by app code (only e2e setup).
- Deploy: one `Dockerfile` build. Staging: `.github/workflows/deploy-vps.yml` ships the
  image's `/app` and Node to the InstaLeads VPS (no root, pm2, `deploy/vps/`), Neon database;
  runbook `docs/runbooks/vps-staging.md`. Production (planned): `deploy-aws.yml` → Lightsail,
  `docs/runbooks/aws-lightsail.md`. The Product Owner works without a server shell: anything an
  operator needs must be on a screen or a GitHub Actions button.
- Schema changes: edit `packages/db/src/schema`, run `pnpm db:generate`, commit the migration.
- Reference spec IDs (NAV-_, MR-_, EC-_, D-_) in code comments and commit messages where they
  explain why.

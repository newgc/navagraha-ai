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

## Conventions

- pnpm workspaces, all packages ESM. Relative imports end in `.js`.
- NestJS: inject with explicit `@Inject(Token)`; there is no decorator-metadata emit, so
  constructor injection by type alone will not work.
- API routes live under `/v1`. Every request has a correlation ID (`x-correlation-id`).
- Every route requires a signed-in user unless marked `@Public()`; restrict with `@Roles(...)`.
  Validate request bodies with zod via `parseBody`. Record sensitive mutations with
  `AuditService`. Never put OTP codes, tokens or full phone numbers in logs (use `maskPhone`).
- Tests: Vitest. DB/API suites need `TEST_DATABASE_URL` and wipe that database.
- Schema changes: edit `packages/db/src/schema`, run `pnpm db:generate`, commit the migration.
- Reference spec IDs (NAV-_, MR-_, EC-_, D-_) in code comments and commit messages where they
  explain why.

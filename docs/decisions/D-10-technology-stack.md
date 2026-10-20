# D-10 — Technology stack

|            |                                                   |
| ---------- | ------------------------------------------------- |
| Decision   | D-10 Backend selection                            |
| Status     | **Decided** by the Product Owner, 20 October 2026 |
| Supersedes | FS §2.2 recommendation of .NET 10 LTS             |

## Decision

Full TypeScript on PostgreSQL, as a modular monolith:

| Layer        | Choice                                                             |
| ------------ | ------------------------------------------------------------------ |
| Web / PWA    | Next.js (App Router), React                                        |
| API          | NestJS on Node.js 22, Express adapter, versioned under `/v1`       |
| Database     | PostgreSQL 16, Drizzle ORM, SQL migrations committed to the repo   |
| Shared rules | `@navagraha/domain` — pure TypeScript, no I/O, used by API and web |
| Tests        | Vitest; DB and API tests run against a real Postgres               |
| Monorepo     | pnpm workspaces                                                    |

## Why

- One language across web, API and shared domain rules, so the state machines, quote maths and validation are written once.
- The team is mostly the Product Owner plus Claude; fewer moving parts beats the stronger typing story of .NET.
- Everything else in FS §2.2 is kept: modular monolith, PostgreSQL, LLM and providers behind adapters, structured logs, audit events, correlation IDs.

## Consequences

- TypeScript is pinned to 5.9 until the TypeScript 7 toolchain is supported by NestJS and the rest of the stack.
- NestJS 12 is ESM-only, so every package is ESM. Services use explicit `@Inject(Token)` rather than emitted decorator metadata, so code runs unchanged under `tsc`, `tsx` and Vitest.
- Hosting needs a Node runtime and managed Postgres (a container platform or VPS), not shared PHP hosting. Choice of host is still open.

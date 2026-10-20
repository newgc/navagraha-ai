# Delivery plan

16 weeks, following FS §18 with one change: a basic operations console with manual
(concierge) booking moves up front, because FS §12.1 needs it from week 1 and the
10–20 concierge pilot trips should start early.

| Phase                               | Weeks | Scope                                                                                                                                                                                                                                                            | Blocked by                               |
| ----------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **P0 Foundation**                   | 1     | Monorepo, CI, Postgres, master-data schema, identity/traveller schema, append-only audit and state-transition tables, D-04 state machines as tested code, `/v1/health`, `/v1/temples`                                                                            | — (done)                                 |
| **P1 Master data + manual booking** | 2–4   | ✅ Temple data import from the workbook, ✅ OTP sign-in + RBAC, ✅ concierge bookings API (D-19, D-20), ✅ operations console for bookings, ✅ temple data screens with browser upload and pilot-readiness checks, ✅ change requests, cancellations and refunds | — (D-04 approved 20 Oct)                 |
| **P2 Decision engine**              | 4–6   | TripRequest, feasibility solver, Template × Mode × Tier, scoring, DecisionRecord                                                                                                                                                                                 | Verified temple data                     |
| **P3 Operations core**              | 6–8   | Trip board, trip detail, assignments, fulfilment tasks with SLAs, event ledger, incidents, day-before manifests                                                                                                                                                  | —                                        |
| **P4 Quote + payment**              | 8–10  | Package, RateCard, Quote/QuoteLine, price lock, payment adapter, idempotent webhooks, refunds                                                                                                                                                                    | D-06, D-07, D-08, D-11 before real money |
| **P5 AI planner**                   | 10–12 | Conversational planner behind an adapter, schema-validated output, chip-only fallback, eval set + pass bar, prompt-injection defence                                                                                                                             | D-11 (LLM vendor)                        |
| **P6 Trip execution**               | 12–14 | Minimal Live Journey, Passport, WhatsApp + SMS/email fallback, Send My Parents core, T-48h/T-12h checklists                                                                                                                                                      | D-11 (WhatsApp BSP), D-12                |
| **P7 Pilot readiness**              | 14–16 | UAT for EC-39..56, playbook rehearsal (FS §38), NFR verification, security/privacy review, paid pilot                                                                                                                                                            | D-06, D-07, D-13, D-14                   |

## Critical path that is not code

Verified temple data: timings, services and fees, travel times, festival calendar and
Thirunallar / Puducherry entry rules. Collect it in `data/Navagraha_Temple_Data_Template.xlsx`.

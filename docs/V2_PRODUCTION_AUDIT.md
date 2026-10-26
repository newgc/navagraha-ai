# Navagraha AI V2 — production audit and migration plan

|            |                                                                                     |
| ---------- | ----------------------------------------------------------------------------------- |
| Purpose    | Phase 0 of the V2 Feature Expansion brief: what exists, what V2 adds, in what order |
| Baseline   | `main` at `be6a2b8` (22 Oct 2026), deployed to https://navagrahayathra.in           |
| Status     | Audit approved 26 Oct 2026 (D-23); S1 built                                         |
| Relates to | FS V1.1 (`docs/spec/functional-spec-v1.1.md`), D-04, D-11, D-19…D-22, delivery plan |

> **Important correction to the brief:** navagrahayathra.in is the **staging** deployment
> (test money only: Razorpay Test Mode, free Neon database, shared InstaLeads VPS). There is no
> production deployment yet; production is planned on AWS Lightsail (`docs/runbooks/aws-lightsail.md`).
> V2 is therefore built against staging as the baseline, with the same "never break the
> working flows" rule. Going live with real customers is its own step (P7 in the delivery plan).

Most of the V2 brief restates FS V1.1, which this codebase already implements in part. Where
the brief and the FS agree, the existing design is extended; where they differ, this document
says so and proposes a Product Owner decision (CLAUDE.md: Product Owner decisions in
`docs/decisions/` override the FS).

---

## 1. Current architecture

```text
Browser (mobile-first)                         Razorpay           Hashwa (WhatsApp)
   │                                              │  webhooks          ▲
   ▼                                              ▼                    │
Next.js 16 web app (apps/web) ── server actions / lib/api.ts ──► NestJS 12 API (apps/api, /v1)
   httpOnly session cookie;                          │   TransitionService (state machines)
   /webhooks/[provider] forwards raw bytes           │   AuditService (append-only)
                                                     ▼
                                     PostgreSQL 16 (Drizzle; Neon on staging)
                                     state_transition + audit_log append-only (DB triggers)
Shared packages: @navagraha/domain (state machines, roles, catalog, planner engine)
                 @navagraha/db (schema, migrations 0000–0008, seeds)
```

| Layer     | What it is                                                                                                                                         |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend  | Next.js 16 App Router, React server components, server actions; plain CSS with brand tokens                                                        |
| Backend   | NestJS 12 (ESM, explicit `@Inject`), zod validation (`parseBody`), correlation IDs, `/v1`                                                          |
| Database  | PostgreSQL 16 via Drizzle ORM; migrations in `packages/db/drizzle`; money in integer paise                                                         |
| Domain    | `@navagraha/domain`: D-04 state machines, roles, vocabularies, deterministic planner (D-22)                                                        |
| Auth      | WhatsApp OTP (Hashwa) → session; roles CUSTOMER, OPS_COORDINATOR, OPS_MANAGER, DRIVER, FINANCE, CONTENT_ADMIN, SYSTEM_ADMIN; no AI role on purpose |
| Payments  | Razorpay payment links + refunds (Cashfree still selectable), verified webhooks, 10-min reconcile                                                  |
| Messaging | Hashwa WhatsApp API: sign-in codes, proposal and payment-link messages                                                                             |
| AI / LLM  | **None yet.** The deterministic planner exists; the conversational planner is P5 (D-11 LLM vendor open)                                            |
| Deploy    | One Dockerfile. Staging: GitHub Actions → VPS (pm2, no root) + Neon. Production: Lightsail (planned)                                               |
| Tests     | Vitest: domain 77, db 20, api 96, web 9; Playwright e2e 7 (runs in CI on every push)                                                               |
| Logging   | Nest logger with correlation IDs; phone numbers masked (`maskPhone`); no OTP/tokens in logs                                                        |

## 2. Existing modules

| Module (apps/api/src)  | Responsibility                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auth`, `me`, `team`   | OTP sign-in, sessions, roles, bootstrap admins, team screen                                                                                                                          |
| `master-data`          | Temples API, temple-data workbook import (browser upload), pilot-readiness                                                                                                           |
| `planner`              | D-22 engine: places, plan, evaluate, decision records                                                                                                                                |
| `bookings`             | Manual (concierge) bookings, leads/trip requests, proposals, acceptance, payments, payment links, fulfilment components, change requests, cancellations, refunds (gateway + offline) |
| `payments`             | Gateway adapters (Razorpay, Cashfree), webhook verification                                                                                                                          |
| `messaging`            | WhatsApp sender (Hashwa)                                                                                                                                                             |
| `audit`, `transitions` | Append-only audit log and state transitions                                                                                                                                          |

## 3. Existing database entities

| V2 entity                 | Existing table(s)                                                                        | State                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Circuit                   | `circuit`, `circuit_temple`                                                              | ✅ exists (Navagraha seeded)                            |
| Temple                    | `temple` (+ row-level provenance)                                                        | ✅ most fields; provenance is per row, not per field    |
| TempleSchedule            | `temple_schedule` (day type, session, opens/closes, last entry, valid from/to)           | ✅                                                      |
| TempleSpecialDay          | `temple_special_day` (close / re-time / crowd, recurring)                                | ✅                                                      |
| TempleService / Pooja     | `temple_service` (duration, fee, days, window, dress, booking lead)                      | ✅ catalogue; ❌ availability                           |
| TempleDataSource          | provenance columns (`source_type`, `source_url`, `verified_on`, `verification_status`)   | ⚠️ per row; no conflict model                           |
| Travel-time matrix        | `place`, `travel_time` (normal/peak minutes)                                             | ✅                                                      |
| Entry rules               | `entry_rule` (dress, phone, Puducherry entry…)                                           | ✅                                                      |
| TripRequest               | `lead.request` (jsonb), `lead_proposal`                                                  | ⚠️ form fields only; no arrival/departure, food, poojas |
| Trip                      | `trip` (state, start date)                                                               | ⚠️ thin; created at confirmation                        |
| Traveller                 | `traveller`, `booking_traveller` (age band, relationship, wheelchair, consent timestamp) | ✅                                                      |
| Itinerary / Version / Leg | `itinerary` (versioned rows), `itinerary_stop`                                           | ✅ versions; legs implied by stops                      |
| Package / RateCard        | —                                                                                        | ❌ (D-08 rates open)                                    |
| Quote / QuoteLine         | `quote` (versioned, valid until, locked), `quote_line`                                   | ✅ structure; lines typed by hand                       |
| Vehicle/Driver/Hotel/Room | `fulfilment_component` (kind, free text, confirm/decline)                                | ⚠️ no master records or availability                    |
| Payment / Refund          | `payment`, `refund`, `gateway_event`                                                     | ✅                                                      |
| TripEvent / TripTask      | `state_transition` (status changes only)                                                 | ❌ operational events, ❌ tasks                         |
| Notification              | —                                                                                        | ❌ (messages are sent inline)                           |
| MarketRateObservation     | —                                                                                        | ❌                                                      |
| DecisionRecord            | `decision_record` (input, result, config + facts version)                                | ✅ (kind PLAN)                                          |
| CustomerFeedback          | —                                                                                        | ❌                                                      |
| AuditLog                  | `audit_log` (append-only)                                                                | ✅                                                      |

State machines (D-04, `packages/domain/src/machines`): Lead, TripRequest, Itinerary, Booking
(REQUESTED → PENDING_CONFIRMATION → CONFIRMED → IN_PROGRESS → COMPLETED / CANCELLED), Quote,
Payment, Refund, FulfilmentComponent, Trip (SCHEDULED → DRIVER_ASSIGNED → PICKUP_READY →
STARTED → IN_PROGRESS ⇄ INCIDENT → COMPLETED), ItineraryStop (PLANNED → ARRIVED → VISITING →
COMPLETED / SKIPPED), ChangeRequest, Cancellation.

## 4. Existing APIs (`/v1`)

| Area           | Routes                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Health, auth   | `GET /health`; `POST /auth/otp/request`, `/auth/otp/verify`, `/auth/logout`; `GET /me`                                               |
| Temples        | `GET /temples`, `/temples/:code`; admin `GET/POST /admin/temple-data[/imports\|/import\|/temples/:code]`                             |
| Team, audit    | `GET/POST /admin/team[/roles]`; `GET /audit-log`                                                                                     |
| Planner        | `GET /planner/places`; `POST /planner/plan`, `/planner/evaluate`; `GET /planner/decisions/:id`                                       |
| Trip requests  | `POST/GET /trip-requests`, `GET /trip-requests/:ref`, `POST …/:ref/planning`, `…/proposals`, `…/lost`                                |
| Customer       | `GET /my/trips`, `/my/trip-requests/:ref`, `POST …/accept`, `GET /my/bookings/:ref`, `POST …/pay`                                    |
| Bookings       | `POST /bookings/manual`, `GET /bookings[/:ref]`, payments (link / offline / waive), fulfilments, change and cancel requests, refunds |
| Payments       | `POST /payments/:id/reconcile\|cancel-link\|confirm\|reject`; `POST /payments/webhook/:provider`                                     |
| Workflow items | `/fulfilments/:id/*`, `/change-requests/:id/*`, `/cancellations/:id/*`, `/refunds/:id/*`                                             |

Web routes: `/`, `/plan`, `/sign-in`, `/trips`, `/trips/[ref]`, `/paid`, `/webhooks/[provider]`;
operations `/ops`, `/ops/requests[/ref]`, `/ops/bookings/new`, `/ops/bookings/[ref]` (+ change),
`/ops/temples[/code]`, `/ops/team`.

## 5. Existing user flows (customer)

1. **Plan (`/plan`, no sign-in needed to start):** date + flexible dates, 1 day / 2 days,
   pickup place and time, purpose, hotel needed, travellers (age, relationship, wheelchair),
   other requirements, WhatsApp number verified by OTP → lead `NEW`.
2. Operations prepare a plan and price → **proposal** sent on WhatsApp.
3. **Accept** on `/trips/[ref]` → booking created (acceptance channel WEB).
4. **Pay now** → Razorpay link; recorded only from Razorpay's records → booking confirmed
   when payment and mandatory arrangements are in place.
5. Trip shows status, arrangements confirmed (count only, no supplier details).

## 6. Existing admin flows (operations)

Request queue → "Suggest plans" (engine, D-22) → proposal with itinerary + quote lines →
customer accepts; manual concierge bookings by phone/WhatsApp (D-20 validation levels);
fulfilment components (vehicle, hotel, pooja…) requested/confirmed/declined; offline payments
with two-person confirmation (D-19); payment links; change requests; cancellations and refunds
(two-person approval); temple data upload with pilot-readiness checks; team and roles.

## 7. Existing integrations

| Integration | Use                                         | Notes                                                      |
| ----------- | ------------------------------------------- | ---------------------------------------------------------- |
| Hashwa      | WhatsApp sign-in codes + free-text messages | Not an official WhatsApp Business (Meta) BSP — see risks   |
| Razorpay    | Payment links, refunds, webhooks            | Test Mode on staging; live keys refused outside production |
| Cashfree    | Same, kept as a setting                     | InstaLeads account; not used                               |
| Neon        | Staging Postgres                            | Free tier                                                  |
| Maps        | —                                           | Travel times are entered and verified, not fetched         |
| LLM         | —                                           | Not chosen (D-11)                                          |

## 8. Existing technical debt

- Temple provenance is **per row**, not per field; there is no record of a second, conflicting
  source, and no "stale" rule. V2 §8 / §26 need both.
- `lead.request` is free-form jsonb validated by zod: fine for the form, but not queryable for
  analytics (origin city, lead time, group make-up).
- Quote lines are typed by staff; no package, tier or rate card, so prices are not yet
  deterministic (D-08 open).
- Messages are sent inline from services; no outbox, retry, consent check or delivery record.
- `trip` holds only a state; there is no operational event ledger or driver/vehicle record.
- Itinerary stops have a machine (ARRIVED/VISITING/COMPLETED) but no screens drive it yet.
- The DRIVER role exists, with no driver screens.
- No rate limiting beyond OTP request limits; needed before an LLM endpoint is public.
- "Navagraha" appears in copy and seed data; the data model is already circuit-based.

## 9. V2 extension points

| Extension point                                                  | Used for                                                                                           |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `circuit` / `circuit_temple`                                     | Circuit architecture (§23) — already generic                                                       |
| Planner engine (`planTrip`, `evaluateItinerary`, `EngineConfig`) | 1D/2D/3D, "let AI decide", arrival-aware start, senior rules, replanning from the current position |
| `decision_record.kind`                                           | New kinds: DURATION_RECOMMENDATION, ROUTE, REPLAN, QUOTE                                           |
| `lead` + `lead_proposal`                                         | TripRequest v2, tiers, compare plans                                                               |
| `quote` / `quote_line` (versioned)                               | Quote engine output, "why this price"                                                              |
| `fulfilment_component`                                           | Link to new vehicle / driver / hotel / pooja records                                               |
| `itinerary_stop` machine                                         | Live journey and passport (only staff/driver events)                                               |
| `trip` machine (INCIDENT state)                                  | Replanning trigger                                                                                 |
| `WhatsAppMessenger`                                              | Behind a notification outbox                                                                       |
| `PaymentGateway` interface                                       | Unchanged                                                                                          |

## 10. Risks before implementation

| Risk                                                                                                                                                                                                                   | Mitigation                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Verified temple data is the critical path.** The engine refuses to plan until timings, visit minutes and travel times are VERIFIED (it shows DATA_INCOMPLETE today). Every V2 planning feature depends on it.        | Phase 1 first: field-level sources, conflicts, verification queue — the tools for the data work already under way   |
| **Business policy is still open:** deposit/refunds (D-06), GST (D-07), rates and tiers (D-08). A deterministic quote engine needs these values.                                                                        | Build the engine with versioned configuration that refuses to quote without PO-entered rates; never invent defaults |
| **WhatsApp at scale:** Hashwa is not an official Meta BSP. Business-initiated lifecycle messages (pre-trip, live updates) need approved templates on an official API; unofficial senders risk the number being banned. | Decide the BSP before Phase 6; build the outbox so the sender can be swapped                                        |
| **LLM vendor not chosen** (D-11). Cost, data residency, prompt injection.                                                                                                                                              | Adapter + schema-validated output + the existing form as fallback; no LLM can call transition APIs                  |
| **Live location and family tracking are personal data** (DPDP Act 2023). Consent must be explicit, revocable and recorded.                                                                                             | Consent records per traveller; tracking off by default; no raw GPS kept longer than needed                          |
| **Astrology / pariharam claims.** Must be labelled as tradition, never as outcome.                                                                                                                                     | Content field `traditional_belief` (exists) + fixed label in UI; no LLM-written belief text                         |
| **No real production yet.** "Production" in the brief is staging.                                                                                                                                                      | Keep V2 on staging until P7 pilot readiness; production gets its own runbook step                                   |
| **Scope.** 22 features; one Product Owner without a server shell.                                                                                                                                                      | Phased plan below; every operator task as a screen or Actions button                                                |
| **Shared VPS memory** (InstaLeads + Navagraha).                                                                                                                                                                        | Watch `NODE_HEAP_MB`; the LLM runs remotely, not on the VPS                                                         |

---

## 11. Gaps against the V2 specification

Legend: ✅ exists · ⚠️ partial · ❌ missing.

| #   | V2 feature                     | Today                                                                  | Gap                                                                                 |
| --- | ------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | Smart AI planner               | ❌ form only                                                           | LLM extraction → TripRequest, ask only for missing fields, fallback                 |
| 2   | 1 day vs 2 days intelligence   | ⚠️ engine compares 1D / 2D1N candidates; customer picks 1 or 2 days    | "Let us decide" option, 3D2N template, duration DecisionRecord + reasons            |
| 3   | Template × Mode × Tier         | ⚠️ template + mode (+ senior overlay) done; `booking.tier` text column | Tier as data (Essential/Comfort/Premium inclusions) — D-08                          |
| 4   | Temple intelligence            | ⚠️ most fields; row-level provenance                                   | Field-level sources, confidence, CONFLICTING / STALE, queue/walking/food fields     |
| 5   | Date intelligence              | ⚠️ special days close/re-time/crowd                                    | Weekday traditions (labelled), holidays, crowd levels, lunar days (panchang source) |
| 6   | Smart route engine             | ✅ best order and day split, not graha order (D-22)                    | Pickup/hotel/drop places, peak travel, pooja windows, budget weight                 |
| 7   | Senior-friendly                | ✅ overlay: slower visits, more rest, max 6 temples/day                | Max continuous drive, walking/toilets/wheelchair as constraints, vehicle class      |
| 8   | Dynamic quote engine           | ⚠️ versioned quotes, lines by hand                                     | Package, RateCard, deterministic calculation — D-07/D-08                            |
| 9   | Price transparency             | ⚠️ lines shown to customer                                             | "Why this price", compare Essential/Comfort/Premium                                 |
| 10  | Arrival-aware planning         | ❌                                                                     | Mode, times, station/flight; engine start/end constraints                           |
| 11  | Live journey                   | ⚠️ machines exist                                                      | Customer live screen, ETA (from verified times), contacts, alerts                   |
| 12  | Live replanning                | ⚠️ INCIDENT state, change requests                                     | Re-run engine from current position → ops approval → notify                         |
| 13  | Send My Parents                | ⚠️ booker ≠ traveller, relationship, consent timestamp                 | Emergency contact, family updates, consent flow                                     |
| 14  | Digital passport + certificate | ❌                                                                     | From staff/driver stop events only                                                  |
| 15  | Operations control centre      | ⚠️ booking list + detail                                               | Today's trips board, assignments, risk, separate payment/fulfilment                 |
| 16  | Trip event timeline            | ⚠️ state transitions                                                   | `trip_event` ledger (arrived, queue, delay…)                                        |
| 17  | WhatsApp lifecycle             | ⚠️ codes, proposal, payment link                                       | Outbox, opt-in, templates, the 8 lifecycle messages                                 |
| 18  | Analytics                      | ❌                                                                     | Typed fields + demand dashboard                                                     |
| 19  | Circuit architecture           | ✅ data model                                                          | Remove hard-coded "Navagraha" outside copy                                          |
| 20  | Multi-city landing pages       | ❌                                                                     | 7 SEO pages with factual, sourced content                                           |
| 21  | Market rate benchmark          | ❌                                                                     | Internal table + screen                                                             |
| 22  | Data source governance         | ⚠️ upload + readiness checks                                           | Source priority, conflict queue, Verify / Update / Reject / Mark Conflicting        |

## 12. Where the brief differs from the FS / current design (proposed decisions)

| Topic                           | Brief                                                                          | Proposal                                                                                                                                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trip status** (§19)           | One list LEAD … CANCELLED                                                      | Keep the D-04 machines (FS §33) as the source of truth and show the brief's list as a **derived "journey stage"** computed from lead + booking + trip states. No new status column, history stays in `state_transition`.                                 |
| **Payment / fulfilment status** | UNPAID, DEPOSIT_PAID, PARTIALLY_PAID, PAID, REFUNDED / NOT_STARTED … COMPLETED | Already separate in the data; add both as **derived summaries** on every booking. DEPOSIT_PAID only once D-06 defines a deposit.                                                                                                                         |
| **Data status** (§8)            | VERIFIED, OPERATIONAL_CONFIRMED, ESTIMATED, UNCONFIRMED, CONFLICTING, STALE    | Map onto the existing workflow status (TO_COLLECT, COLLECTED, VERIFIED, NEEDS_RECHECK) plus a **confidence** per fact; STALE is computed from age. The engine keeps using only VERIFIED / OPERATIONAL_CONFIRMED facts. ESTIMATED is never shown as fact. |
| **Templates**                   | 1, 2, 3 days, flexible                                                         | 3D2N was reserved for later in the FS; add it as a template, same engine.                                                                                                                                                                                |
| **"AI decides the duration"**   | AI recommends                                                                  | The **engine** decides from verified facts and stores a DecisionRecord; the LLM only explains it (FS §2.1). Labelled "Let us recommend".                                                                                                                 |
| **Completion**                  | Driver / coordinator / ops                                                     | As FS §13.2: only staff or the assigned driver complete a stop; customer reports are recorded but don't count.                                                                                                                                           |

## 13. Recommended migration approach

- **Additive only (expand → migrate → contract).** New tables and nullable columns; no column
  drops, renames or enum-value removals while the old code may read them. Every migration is
  generated with `pnpm db:generate` and tested against a copy of staging data.
- **Keep every existing route and screen working.** New behaviour gets new `/v1` routes or
  optional fields; old clients see the same responses.
- **Settings and switches in configuration**, versioned like `engine-config-…`: tiers, rate
  cards, senior rules, date rules. Off until the PO has entered values.
- **Derived read models** (journey stage, payment summary, fulfilment summary, passport) instead
  of new state columns.
- **The LLM sits outside the trust boundary:** it produces a draft TripRequest only; validation,
  the engine and people do the rest. If it fails, the current form is the planner.
- **Each phase ends green:** unit + API + browser tests, a staging deploy, the existing booking
  flow checked end to end (request → proposal → accept → pay → refund) on mobile.

## 14. Database migration plan

| Migration | Adds                                                                                                                                                                                                                                           | Phase |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 0009      | `data_source` (name, kind, priority 1–6, URL); `temple_fact` (entity, field, value, source, verified at, valid from/until, confidence, status) with conflict detection; new temple fields (queue estimate, food nearby, camera rules, contact) | 1     |
| 0010      | `circuit` display fields; `template_code` value `3D2N`                                                                                                                                                                                         | 1–2   |
| 0011      | TripRequest v2 typed columns on `lead` (origin city, arrival/departure, food, poojas, duration preference, senior/child counts, group size) — jsonb kept for compatibility                                                                     | 2     |
| 0012      | `package`, `tier`, `rate_card` (versioned, valid from/to), `rate_card_line`; `quote.rate_card_version`                                                                                                                                         | 3     |
| 0013      | `vehicle`, `driver`, `hotel`, `room_type`, `pooja_slot`; foreign keys from `fulfilment_component` (nullable)                                                                                                                                   | 4     |
| 0014      | `trip_event` (append-only trigger), `trip_task`, `emergency_contact`, `tracking_consent`                                                                                                                                                       | 4–5   |
| 0015      | `notification` outbox (template, consent check, idempotency key, attempts, status)                                                                                                                                                             | 6     |
| 0016      | `customer_feedback`, `market_rate_observation`                                                                                                                                                                                                 | 7     |

## 15. API changes (all additive)

| Phase | New / changed routes                                                                                                                                                   |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `GET/POST /admin/data-sources`; `GET /admin/temple-facts/queue`; `POST /admin/temple-facts/:id/verify\|update\|reject\|conflict`                                       |
| 2     | `POST /trip-requests` accepts v2 fields (optional); `POST /planner/recommend-duration`; `POST /planner/date-insights`                                                  |
| 2     | `POST /assistant/parse` (LLM → draft TripRequest + missing questions; rate-limited; public)                                                                            |
| 3     | `GET/POST /admin/rate-cards`; `POST /quotes/calculate`; `GET /my/trip-requests/:ref/compare`                                                                           |
| 4     | `GET /ops/today`; `POST /trips/:id/assign`; `POST /trips/:id/events`; `POST /trips/:id/stops/:stop/arrive\|complete\|skip`; `POST /trips/:id/replan` (draft) + approve |
| 5     | `GET /my/bookings/:ref/live`; `GET /my/bookings/:ref/passport` (+ certificate PDF); family view by consented link                                                      |
| 6     | `GET /admin/notifications`; webhook for delivery status (if the BSP provides it)                                                                                       |
| 7     | `GET /admin/analytics/*`; `GET/POST /admin/market-rates`                                                                                                               |

## 16. UI changes

- **Customer:** `/plan` gets a free-text box first ("Tell us about your trip") that fills the
  existing form and asks only what is missing; the form stays as the fallback. A
  "Your recommended pilgrimage" screen (duration, mode, tier, reasons, day-by-day, km, hours,
  price, Accept / Change / Talk to us). "Why this price" and Compare plans. Arrival details.
  Live journey, passport, certificate, Send My Parents. City landing pages.
- **Operations:** Data verification queue, rate cards, today's trips board, trip timeline,
  assignments, stop completion (also for drivers on a phone), replanning approval, notifications
  log, analytics, market rates.
- Mobile-first throughout; the existing brand header, footer and colours.

## 17. Sprint breakdown (2-week sprints)

| Sprint | Phase | Deliverable                                                                                                                                                                                          | Needs from the PO                            |
| ------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| S1     | 1     | ✅ (D-23, except new workbook columns) Field-level sources and confidence, conflict detection, STALE rule, **Data Verification Queue**, source priority, extra temple fields, pooja catalogue screen | Source priority confirmed                    |
| S2     | 2     | TripRequest v2 (arrival/departure, food, poojas, origin), "Let us recommend" duration, 3D2N, arrival-aware engine, wider senior rules, date insights (labelled tradition), DecisionRecord kinds      | Senior rule values; date rules content       |
| S3     | 3     | Package × Tier, versioned rate cards, deterministic quote engine, "Why this price", Compare plans, proposals priced by the engine                                                                    | **D-07 GST, D-08 rates and tier inclusions** |
| S4     | 2     | Smart AI planner (LLM adapter, structured output, missing-field questions, eval set, injection defence, fallback)                                                                                    | **LLM vendor + API key (D-11)**              |
| S5     | 4     | Operations control centre: today's trips, vehicle/driver/hotel records and assignment, trip event timeline, tasks, separate payment/fulfilment summaries                                             | Vehicle/driver list                          |
| S6     | 5     | Customer itinerary/quote screen V2, pre-trip checklist, live journey (staff/driver driven), passport + certificate, Send My Parents with consent                                                     | Certificate wording                          |
| S7     | 6     | Notification outbox, opt-in, the lifecycle messages, delivery log                                                                                                                                    | **WhatsApp BSP decision**, message texts     |
| S8     | 4     | Live replanning: re-plan from the current stop, ops approval, customer notification                                                                                                                  | —                                            |
| S9     | 7     | Analytics dashboard, market rate observations, city landing pages (content reviewed by the PO)                                                                                                       | Page content sign-off                        |

S9's landing pages have no dependencies and can move earlier if marketing needs them.

## 18. Estimated implementation sequence

1. **Phase 1 (S1)** — data foundation. It is useful immediately for the temple data work now
   in progress, and every planning feature depends on it.
2. **Phase 2 core (S2)** — engine extensions that need no new policy.
3. **Phase 3 (S3)** — as soon as D-07/D-08 are decided; until then the engine prices nothing.
4. **Phase 2 AI (S4)** — once the LLM vendor is chosen.
5. **Phases 4 → 5 → 6 → 4b → 7 (S5–S9)** — operations before the customer live screens,
   because live journey and passport are driven by operational events.

After every phase: all tests, a staging deploy, the existing booking flow checked on mobile,
migrations verified on a copy of staging data, and old API responses compared.

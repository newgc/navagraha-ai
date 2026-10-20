# D-04 — Canonical State Machines (DRAFT for Product Owner approval)

|          |                                                       |
| -------- | ----------------------------------------------------- |
| Decision | D-04 State machines                                   |
| Status   | **DRAFT — awaiting Product Owner approval**           |
| Baseline | MVP Functional Specification V1.1 §33 (supersedes §7) |
| Owner    | Vaithy — Product Owner                                |
| Prepared | 20 October 2026                                       |

This draft turns the state lists in FS §33 into explicit transitions: who may make each change, what must be true first, and what happens as a result. Where §33 is silent or ambiguous, the proposal is marked **[PROPOSED]** and listed in §5 as a question. Nothing here sets business policy that D-06 (deposit/refund), D-07 (GST) or D-08 (rates) still own — those appear only as named, configurable conditions.

---

## 1. Rules that apply to every state machine

1. **One door.** Every state change goes through a single domain service (`transition(object, toState, actor, reason)`). No code writes a status column directly.
2. **Every change is an event.** Each transition writes a `StateTransition` record: object type + id, from, to, actor (user id + role, or `system:<provider>`), reason, source/channel, `occurredAt` (when it happened in the real world), `recordedAt` (server time, never client-supplied), correlation ID. This is the audit trail for NFR-10 and NFR-16.
3. **Illegal transitions are rejected and logged.** If the role isn't allowed it is also a security event (EC-53).
4. **Concurrency.** Every object carries a version number; a transition against a stale version fails and must be retried on fresh data (EC-54).
5. **Provider-driven transitions are idempotent.** Payment and WhatsApp webhooks carry the provider event id as an idempotency key; a repeat is acknowledged and ignored (EC-24, EC-43, NFR-09).
6. **Corrections are new events, never edits.** A mistaken transition is undone by a compensating transition with a reason, made by a role that is allowed to correct it. History is never rewritten.
7. **The customer and the AI can never perform operational transitions.** The LLM has no transition authority at all; the customer app can only _request_ (change, cancel, book, pay).

Roles used below: **CUS** Customer/Booker · **OC** Operations Coordinator · **OM** Operations Manager · **DRV** Driver (only if D-15 enables the driver page) · **FIN** Finance · **SYS** system/automated job · **PAY** payment gateway webhook · **AI** planner (no transition rights; listed only where it triggers a system action).

---

## 2. Transactional core

### 2.1 Booking

`REQUESTED → PENDING_CONFIRMATION → CONFIRMED → IN_PROGRESS → COMPLETED` · `CANCELLED`

| From                                                       | To                   | Who                     | Must be true                                                                                  | Effects                                                                                    |
| ---------------------------------------------------------- | -------------------- | ----------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| —                                                          | REQUESTED            | CUS, OC (manual, EC-38) | Quote is LOCKED; at least one Traveller; Booker identified                                    | Fulfilment created (PENDING); Payment record(s) created per D-06                           |
| REQUESTED                                                  | PENDING_CONFIRMATION | SYS                     | Booking accepted (validations pass)                                                           | Fulfilment tasks raised with SLAs (MR-22)                                                  |
| PENDING_CONFIRMATION                                       | CONFIRMED            | **SYS only**            | **Confirmation gate (below)**                                                                 | Confirmation + receipt/invoice sent (NAV-BOOK-005, NAV-NOT-001); Trip created as SCHEDULED |
| CONFIRMED                                                  | PENDING_CONFIRMATION | SYS, OM                 | Gate no longer holds (e.g. hotel can't honour, EC-08; approved change request) **[PROPOSED]** | Customer told "Confirmation pending — action required"; ops alert                          |
| CONFIRMED                                                  | IN_PROGRESS          | SYS                     | Trip moved to STARTED                                                                         | —                                                                                          |
| IN_PROGRESS                                                | COMPLETED            | SYS                     | Trip COMPLETED                                                                                | Feedback request (MR-05)                                                                   |
| REQUESTED / PENDING_CONFIRMATION / CONFIRMED / IN_PROGRESS | CANCELLED            | **SYS only**            | A Cancellation reached APPROVED                                                               | Fulfilment → RELEASED/CANCELLED; refund handled by Cancellation                            |

**Confirmation gate (FS §33, §11.1).** Booking becomes CONFIRMED only when **both** hold at the same moment:

- `paymentConditionMet(booking)` — the D-06 policy (e.g. "deposit received" or "full amount received"). Configurable; until D-06 is decided it defaults to _full payment SUCCESS_.
- `fulfilment.state = ALL_REQUIRED_CONFIRMED`.

Payment and fulfilment run **in parallel**; neither waits for the other. The gate is re-checked whenever either side changes. No client-side signal (e.g. "payment page said success") can open it (FS §11.2).

### 2.2 Payment

A Booking can have several Payment records (deposit, balance, retries — MR-17). Each record is one gateway transaction.

`NOT_REQUIRED` · `PENDING → SUCCESS | FAILED` · `SUCCESS → PARTIALLY_REFUNDED → REFUNDED`

| From                         | To                 | Who                                              | Must be true                                                                            | Effects                                                                                   |
| ---------------------------- | ------------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| —                            | NOT_REQUIRED       | SYS, OM                                          | Policy says no payment for this component (e.g. pay-at-hotel, complimentary pilot trip) | Counts as met for the gate                                                                |
| —                            | PENDING            | SYS                                              | Gateway order created (`POST /payments/create`)                                         | —                                                                                         |
| PENDING                      | SUCCESS            | **PAY (verified webhook) or SYS reconciliation** | Signature verified; amount and currency match the order                                 | Gate re-checked                                                                           |
| PENDING                      | FAILED             | PAY, SYS                                         | Gateway failure, or order expired per policy (UPI pending timeout, EC-25)               | Customer can retry → **new** Payment record                                               |
| FAILED                       | SUCCESS            | PAY, SYS reconciliation                          | Gateway later reports capture for the same order (late UPI success) **[PROPOSED]**      | Gate re-checked; if the booking was already cancelled → raise reconciliation task, refund |
| SUCCESS / PARTIALLY_REFUNDED | PARTIALLY_REFUNDED | PAY, SYS                                         | Gateway confirms a refund; total refunded < captured amount                             | —                                                                                         |
| SUCCESS / PARTIALLY_REFUNDED | REFUNDED           | PAY, SYS                                         | Gateway confirms a refund; total refunded = captured amount                             | —                                                                                         |

Refunds are **initiated** by FIN or OM as a separate Refund record (`INITIATED → CONFIRMED | FAILED`, confirmed by PAY/SYS). The Payment only changes state when the gateway confirms, so it can never show "refunded" for money that hasn't moved. §33 lists `FAILED → REFUNDED`; this draft does not allow it, because nothing was captured to refund.

### 2.3 Fulfilment

§33 gives aggregate states. This draft adds a **component** level underneath, because each vehicle, hotel and pooja is confirmed separately by a different supplier.

**FulfilmentComponent** (one per vehicle, hotel room set, pooja, pickup…) **[PROPOSED]**
`PENDING → REQUESTED → CONFIRMED | DECLINED` · `→ RELEASED` · `→ CANCELLED`

| From                | To        | Who                    | Must be true                                                                                                             |
| ------------------- | --------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| PENDING             | REQUESTED | OC                     | Request sent to supplier; supplier + channel recorded                                                                    |
| REQUESTED           | CONFIRMED | OC, SYS (provider API) | Supplier reference captured (FS §12)                                                                                     |
| REQUESTED           | DECLINED  | OC, SYS                | Reason recorded → ops picks alternative (new component) or offers refund of that component                               |
| CONFIRMED           | RELEASED  | OC, SYS                | Booking cancelled or component replaced; supplier told                                                                   |
| PENDING / REQUESTED | CANCELLED | OC, SYS                | Component no longer needed (change request). An already CONFIRMED component is RELEASED instead, so the supplier is told |

**Fulfilment (aggregate)** — **derived**, never set by hand:

| State                  | Condition                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------- |
| PENDING                | No mandatory component confirmed yet                                               |
| PARTIAL                | Some, not all, mandatory components confirmed                                      |
| ALL_REQUIRED_CONFIRMED | Every mandatory component for the package is CONFIRMED                             |
| FAILED                 | A mandatory component DECLINED with no replacement and ops marked it unrecoverable |
| RELEASED               | All confirmed components released after cancellation                               |
| CANCELLED              | Booking cancelled before anything was confirmed                                    |

Which components are mandatory comes from the Package (FS §10), not from code.

### 2.4 Quote

`DRAFT → CALCULATED → PRESENTED → LOCKED → EXPIRED | CANCELLED`

| From                           | To         | Who                     | Must be true                                           | Effects                                                      |
| ------------------------------ | ---------- | ----------------------- | ------------------------------------------------------ | ------------------------------------------------------------ |
| —                              | DRAFT      | SYS, OC                 | Itinerary version + selected components                | —                                                            |
| DRAFT                          | CALCULATED | SYS (quote engine only) | RateCard version resolved; all lines priced            | Inputs + RateCard version stored (NFR-17)                    |
| CALCULATED                     | PRESENTED  | SYS                     | Shown to customer / sent                               | `quote_viewed` analytics                                     |
| PRESENTED                      | LOCKED     | CUS, OC                 | Customer accepts; within validity (MR-13)              | Price locked until lock expiry; Booking may now be REQUESTED |
| PRESENTED / LOCKED             | EXPIRED    | SYS                     | Validity or lock window passed without booking/payment | New quote needed; rates may have changed (EC-26)             |
| DRAFT / CALCULATED / PRESENTED | CANCELLED  | SYS, OC                 | Superseded by a newer quote version                    | —                                                            |

A quote is **immutable once CALCULATED**. Any change (date, group size, rate) creates a new quote version (EC-26, EC-27). §33 writes "ACCEPTED/LOCKED"; this draft treats them as one state, LOCKED.

---

## 3. Planning

### 3.1 Lead

`NEW → QUALIFIED → PLANNING → QUOTED → CONVERTED | LOST`

| From      | To        | Who                                            | Must be true                                       |
| --------- | --------- | ---------------------------------------------- | -------------------------------------------------- |
| —         | NEW       | SYS (planner start, form), OC (phone/WhatsApp) | Contact captured; source/channel recorded          |
| NEW       | QUALIFIED | SYS, OC                                        | Has travel window + group size + reachable contact |
| QUALIFIED | PLANNING  | SYS                                            | Planning session or ops itinerary started          |
| PLANNING  | QUOTED    | SYS                                            | A quote reached PRESENTED                          |
| QUOTED    | CONVERTED | SYS                                            | Booking REQUESTED                                  |
| any open  | LOST      | OC, SYS (inactivity timeout)                   | Reason recorded                                    |
| LOST      | PLANNING  | OC, SYS                                        | Lead returns **[PROPOSED]**                        |

Ops may move a manual lead straight from NEW to PLANNING (concierge, FS §12.1).

### 3.2 PlanningSession

`OPEN → COLLECTING → READY → PLAN_GENERATED → EXPIRED | CANCELLED`

| From           | To             | Who | Must be true                                                                                     |
| -------------- | -------------- | --- | ------------------------------------------------------------------------------------------------ |
| —              | OPEN           | CUS | —                                                                                                |
| OPEN           | COLLECTING     | SYS | First answer received                                                                            |
| COLLECTING     | READY          | SYS | TripRequest passes schema validation (MR-07)                                                     |
| READY          | PLAN_GENERATED | SYS | Engine returned at least one candidate (feasible or explained-infeasible) + DecisionRecord saved |
| PLAN_GENERATED | COLLECTING     | SYS | Customer changes an input that matters **[PROPOSED]**                                            |
| any            | EXPIRED        | SYS | Inactive past configured timeout                                                                 |
| any            | CANCELLED      | CUS | —                                                                                                |

The session has **no booking authority**. An LLM outage (EC-30) does not change state; the session switches to the chip-only planner (MR-08).

### 3.3 Itinerary (per version)

`DRAFT → VALIDATED → PROPOSED → ACCEPTED → OPS_ADJUSTED → LIVE → COMPLETED | ABANDONED`, plus **SUPERSEDED [PROPOSED]**

Each itinerary **version** is immutable once VALIDATED. Customer or ops changes create a **new version** (NAV-IT-004/005) linked to the previous one, with reason and source. The Trip points at its _active_ version.

| From                    | To           | Who                               | Must be true                                                                                                                            |
| ----------------------- | ------------ | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| —                       | DRAFT        | SYS (engine), OC                  | —                                                                                                                                       |
| DRAFT                   | VALIDATED    | **SYS (feasibility engine only)** | All hard constraints pass (FS §9.2). An infeasible draft stays DRAFT with failed constraints listed                                     |
| VALIDATED               | PROPOSED     | SYS, OC                           | Presented to customer                                                                                                                   |
| PROPOSED                | ACCEPTED     | CUS, OC                           | Linked quote LOCKED                                                                                                                     |
| VALIDATED               | OPS_ADJUSTED | OC, OM                            | This is an ops-made version replacing the active one; reason required; previous active version → SUPERSEDED; customer notified (FS §12) |
| ACCEPTED / OPS_ADJUSTED | LIVE         | SYS                               | Trip STARTED (or immediately, for an ops version made during a live trip)                                                               |
| LIVE                    | COMPLETED    | SYS                               | Trip COMPLETED                                                                                                                          |
| any non-terminal        | ABANDONED    | SYS                               | Trip CANCELLED, or plan never accepted                                                                                                  |
| any non-terminal        | SUPERSEDED   | SYS                               | A newer version became active                                                                                                           |

If a replan fails (EC-55), the last feasible version stays active and an ops alert is raised.

---

## 4. Execution

### 4.1 Trip

`SCHEDULED → DRIVER_ASSIGNED → PICKUP_READY → STARTED → IN_PROGRESS → COMPLETED` · `INCIDENT` · `CANCELLED`

| From                             | To              | Who         | Must be true                                                                                 | Effects                                                               |
| -------------------------------- | --------------- | ----------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| —                                | SCHEDULED       | SYS         | Booking CONFIRMED                                                                            | —                                                                     |
| SCHEDULED                        | DRIVER_ASSIGNED | OC          | Vehicle **and** driver assigned; capacity ≥ travellers                                       | Reassignment later (EC-06) keeps the state and records an event       |
| DRIVER_ASSIGNED                  | PICKUP_READY    | OC, SYS     | Day-before manifest generated (MR-25); T-12h checklist sent (MR-03); booking still CONFIRMED | Pickup details sent                                                   |
| PICKUP_READY                     | STARTED         | OC, DRV     | Pickup event recorded                                                                        | Booking → IN_PROGRESS; Itinerary → LIVE; parent milestone "picked up" |
| STARTED                          | IN_PROGRESS     | SYS         | First temple ARRIVED **[PROPOSED meaning]**                                                  | —                                                                     |
| STARTED / IN_PROGRESS            | INCIDENT        | OC, OM, DRV | Incident created (MR-23)                                                                     | Ops alert; playbook shown (FS §38)                                    |
| INCIDENT                         | IN_PROGRESS     | OM          | Operational clearance recorded **[PROPOSED]**                                                | Customer notified                                                     |
| IN_PROGRESS / INCIDENT           | COMPLETED       | OC, OM      | Drop-off recorded. Partial completion allowed (EC-56) — Passport reflects actual visits      | Feedback request                                                      |
| any before STARTED               | CANCELLED       | SYS         | Booking CANCELLED                                                                            | —                                                                     |
| STARTED / IN_PROGRESS / INCIDENT | CANCELLED       | OM          | Trip abandoned (e.g. EC-14, EC-29) with reason                                               | Cancellation record raised for refund handling                        |

Overnight (2D/1N) trips stay IN_PROGRESS overnight; hotel check-in/out are events, not states.

### 4.2 TempleVisit

`PLANNED → ARRIVED → VISITING → COMPLETED | SKIPPED`

| From                         | To        | Who         | Must be true                                                                                                                               |
| ---------------------------- | --------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| PLANNED                      | ARRIVED   | OC, DRV     | Trip STARTED/IN_PROGRESS                                                                                                                   |
| ARRIVED                      | VISITING  | OC, DRV     | —                                                                                                                                          |
| VISITING                     | COMPLETED | OC, DRV     | Event from an assigned, active trip (FS §37)                                                                                               |
| PLANNED                      | COMPLETED | OC, OM      | Coordinator recording after a phone call (P0 fallback, D-15). Mandatory note; `occurredAt` may be earlier than `recordedAt` **[PROPOSED]** |
| PLANNED / ARRIVED / VISITING | SKIPPED   | OC, OM      | Reason (closed, queue, tired, time) — EC-01, EC-11, EC-16                                                                                  |
| COMPLETED                    | SKIPPED   | **OM only** | Correcting a false completion (EC-37); reason required; Passport recalculated                                                              |

**The customer can never move a TempleVisit** (NFR-18, EC-45). A customer saying "we finished" is stored as a note, not a transition.

### 4.3 Passport

`0/9 → N/9 → 9/9 → CERTIFIED`

Derived, not set by hand: the count of distinct circuit temples with a COMPLETED TempleVisit for that traveller. It goes down if an OM correction turns a visit into SKIPPED. CERTIFIED (certificate) is P1 and only from 9/9.

### 4.4 ChangeRequest

`REQUESTED → REVIEWING → APPROVED | REJECTED → APPLIED`, plus **WITHDRAWN [PROPOSED]**

| From                  | To        | Who     | Must be true                                                            | Effects                                                                           |
| --------------------- | --------- | ------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| —                     | REQUESTED | CUS, OC | Booking not COMPLETED/CANCELLED                                         | Ops task raised                                                                   |
| REQUESTED             | REVIEWING | OC      | —                                                                       | New itinerary + quote versions prepared; availability re-checked (EC-19/20/27/28) |
| REVIEWING             | APPROVED  | OC, OM  | Feasible; **customer accepted any price difference** (new quote LOCKED) | —                                                                                 |
| REVIEWING             | REJECTED  | OC, OM  | Reason given to customer                                                | —                                                                                 |
| APPROVED              | APPLIED   | SYS     | New versions activated; extra payment/refund created if needed          | Booking may drop to PENDING_CONFIRMATION until new components confirmed           |
| REQUESTED / REVIEWING | WITHDRAWN | CUS     | —                                                                       | —                                                                                 |

### 4.5 Cancellation

`REQUESTED → REVIEWING → APPROVED | REJECTED → REFUND_PENDING → REFUNDED`, plus **CLOSED_NO_REFUND [PROPOSED]**

| From           | To               | Who         | Must be true                                                         | Effects                                  |
| -------------- | ---------------- | ----------- | -------------------------------------------------------------------- | ---------------------------------------- |
| —              | REQUESTED        | CUS, OC, OM | —                                                                    | —                                        |
| REQUESTED      | REVIEWING        | OC          | Refund amount calculated from the D-06 policy, per component (EC-47) | —                                        |
| REVIEWING      | APPROVED         | OM          | —                                                                    | Booking → CANCELLED; fulfilment released |
| REVIEWING      | REJECTED         | OM          | Reason                                                               | —                                        |
| APPROVED       | REFUND_PENDING   | SYS         | Refund amount > 0                                                    | Refund initiated with gateway            |
| REFUND_PENDING | REFUNDED         | SYS         | Gateway confirms refund                                              | Payment → REFUNDED / PARTIALLY_REFUNDED  |
| APPROVED       | CLOSED_NO_REFUND | SYS         | Refund amount = 0 under policy                                       | —                                        |

---

## 5. Questions for the Product Owner

| #   | Question                                                                                                | Draft position                                                                        |
| --- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Q1  | Until D-06 is decided, what payment condition opens the confirmation gate?                              | Full payment SUCCESS (safest). Configurable per package                               |
| Q2  | May a CONFIRMED booking drop back to PENDING_CONFIRMATION when a supplier fails or a change is applied? | Yes, with customer notification. The alternative is a separate "ACTION_REQUIRED" flag |
| Q3  | Add a component level under Fulfilment (PENDING/REQUESTED/CONFIRMED/DECLINED/RELEASED)?                 | Yes — §33's aggregate states can't be tracked without it                              |
| Q4  | Allow FAILED → SUCCESS for late gateway confirmations? Remove FAILED → REFUNDED from §33?               | Yes to both                                                                           |
| Q5  | Merge Quote ACCEPTED and LOCKED into one state?                                                         | Yes                                                                                   |
| Q6  | Add Itinerary SUPERSEDED for replaced versions?                                                         | Yes                                                                                   |
| Q7  | What separates Trip STARTED from IN_PROGRESS?                                                           | STARTED = picked up; IN_PROGRESS = first temple arrival. Or merge them                |
| Q8  | Is Trip INCIDENT a pause (can return to IN_PROGRESS) or an end state?                                   | A pause; the incident itself is its own record (MR-23)                                |
| Q9  | May coordinators record a temple COMPLETED directly from PLANNED after a phone call?                    | Yes, with a mandatory note — needed while the driver page is P1                       |
| Q10 | Who can correct a false temple completion?                                                              | Operations Manager only, with reason                                                  |
| Q11 | Add ChangeRequest WITHDRAWN and Cancellation CLOSED_NO_REFUND?                                          | Yes                                                                                   |
| Q12 | Is the Passport per traveller across all their trips, or per trip?                                      | Per traveller per circuit, across trips (a pilgrim who did 6/9 last year continues)   |

Once these are answered, the approved version becomes the source for the `packages/domain` state machine code and its tests, and the API contracts in FS §15/§32 are locked against it.

# D-23 — V2 direction, and data source governance (V2 Phase 1)

|            |                                                                                     |
| ---------- | ----------------------------------------------------------------------------------- |
| Decision   | How V2 is delivered, its vendors, and the rules for conflicting temple facts        |
| Status     | **Decided** by the Product Owner, 26 October 2026 (rules in §3 to be reviewed)      |
| Relates to | V2 brief, `docs/V2_PRODUCTION_AUDIT.md`, FS §5.1, §14, NAV-TEM-002/003, EC-49, D-11 |

## 1. Delivery

- V2 is built **incrementally on the existing application**, in the order of the audit's
  sprint plan (S1 data foundation first). Each phase ends with every test green, a staging
  deploy and the existing booking flow checked.
- The brief's trip / payment / fulfilment status lists are shown as **derived views** of the
  D-04 state machines; the machines stay the source of truth (audit §12).

## 2. Vendors

- **AI planner (S4): Claude (Anthropic).** It turns a pilgrim's message into a draft
  TripRequest with schema-validated output; it never sets prices, timings or availability, and
  the current form remains the fallback. The API key goes into GitHub secrets when S4 starts.
- **WhatsApp: Hashwa for now.** Lifecycle messages (S7) go through a notification queue with a
  replaceable sender; an official Meta WhatsApp Business provider is chosen before going live.

## 3. Data source governance (built in S1)

- The workbook stays the **master copy**. On screen, anyone in operations can add a
  **second source** for a single fact (opening and closing times, visit minutes, drive times,
  pooja fees and durations, access facts).
- **Source priority** (V2 §26): 1 HR&CE / Government · 2 temple office, website or priest ·
  3 verified local driver / guide · 4 our operations team · 5 customer report · 6 maps and
  other web sources. **Only 1–4 can verify a fact**; 5–6 can flag one, never settle it.
- **Confidence** shown for every fact: VERIFIED (1–2), OPERATIONAL_CONFIRMED (3–4), ESTIMATED
  (collected, or verified only from 5–6 such as Google Maps times), UNCONFIRMED, STALE (due
  for re-check or marked conflicting), CONFLICTING.
- **A disagreeing second source makes the fact CONFLICTING**, and the planning engine stops
  using it. Nothing is resolved automatically, by the system or by an LLM. A content admin or
  operations manager decides in the **Data verification queue**: Verify (keep the current
  value), Update (take the other source's value), Reject (the other source is wrong) or Mark
  conflicting (needs a re-check).
- A value a person replaced that a later workbook upload brings back is flagged again, so an
  old workbook cannot silently undo a decision.
- **Re-check after 180 days** (EC-49), as before — a pilot default to review.
- Every action is in the audit log.

## Open

- New temple fields from the brief (queue estimate, food nearby, camera rules) need new
  workbook columns; they are added together with the next workbook version, so the workbook
  being filled in now keeps working.

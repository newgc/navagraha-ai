# D-19 — Offline payments for concierge bookings

|            |                                                                              |
| ---------- | ---------------------------------------------------------------------------- |
| Decision   | How UPI / bank transfer / cash payments are recorded                         |
| Status     | **Decided** by the Product Owner, 20 October 2026                            |
| Relates to | D-04 §2.2 (Payment), D-06 (deposit policy), FS §12.1 (manual concierge mode) |

## Decision

Two-person rule. An offline payment counts toward the confirmation gate only after two
different people have handled it:

1. **Record** — an Operations Coordinator, Operations Manager or Finance user records the
   receipt: method (UPI, bank transfer or cash), amount, the UPI / bank reference (or a cash
   receipt number) and the date received. The payment is created **PENDING**.
2. **Confirm** — a **different** user with the Finance or Operations Manager role checks the
   money arrived and confirms it. The system then moves the payment PENDING → SUCCESS.
   They can instead reject it with a reason (PENDING → FAILED).

Both steps are audited, and the payment row keeps who recorded and who confirmed it; the
database refuses a row where they are the same person.

## Why

D-04 allows SUCCESS only from a verified gateway webhook or system reconciliation, so that
no client signal or single person can mark money as received. The two-person rule keeps that
intent for money that never passes through a gateway.

## Also

- An Operations Manager can mark a booking's payment **NOT_REQUIRED** with a reason (e.g. a
  complimentary pilot trip). D-04 already allows this.
- A recorded amount may not exceed the balance still due, which catches typing mistakes.

## Extension — refunds paid out (20 October 2026)

The same two-person rule applies to money going back to a customer. A Finance or Operations
Manager user records the refund they paid (method, amount, UPI / bank reference, date) and a
**different** Finance or Operations Manager user confirms it. Only then does the system mark
the Refund CONFIRMED and reduce the payments it is allocated to (newest payment first).

Until D-06 sets refund tiers, the refund amount for a cancellation is proposed by the
coordinator with a note and approved by an Operations Manager; it can never exceed what was
paid. Proposed by Claude while building cancellations; the Product Owner can reverse it.

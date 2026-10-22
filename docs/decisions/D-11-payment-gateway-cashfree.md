# D-11 (part) — Online payments: Cashfree payment links sent on WhatsApp

|            |                                                                                |
| ---------- | ------------------------------------------------------------------------------ |
| Decision   | Which payment gateway, and how customers pay online                            |
| Status     | **Superseded** 22 October 2026 by Razorpay (D-11-payment-gateway-razorpay.md)  |
| Relates to | D-11 (vendors), FS §11.2, §32, MR-19, NFR-06, NFR-09, EC-22–EC-26, D-04 §2.2   |
| Scope      | Payment links for concierge bookings. Website checkout comes with self-service |

## Decision

- **Gateway: Cashfree** (Payment Gateway API, `x-api-version` 2026-01-01).
- **How customers pay: payment links.** On a booking, operations or finance click **Send
  payment link**: we create a Cashfree link for the balance still due (or a part of it) and
  send it to the booker on WhatsApp through Hashwa. Cashfree's own SMS/email is turned off.
  Checkout on the website follows when the self-service booking flow is built.

## How money is recorded (FS §11.2, MR-19, NFR-09)

- The link is a `payment` row (`GATEWAY`, `PENDING`) from the moment it is created, so it
  holds that part of the balance and two links can never ask for the same money.
- **Only Cashfree's own records move it to `SUCCESS`.** A webhook is verified (base64
  HMAC-SHA256 of timestamp + raw body, keyed by the client secret), stored once
  (`gateway_event`, unique per provider + idempotency key), acknowledged, and then only
  _triggers_ a reconciliation that reads the link's paid orders and their payments from the
  API. The return page after paying, a webhook body or a person can never mark a link paid.
- The payment step is recorded with the `PAYMENT_GATEWAY` actor; the confirmation gate is
  then re-checked as for any payment.
- Lost webhooks: every 10 minutes the API reconciles unpaid links, and operations have a
  **Check payment status** button.
- A link that expires or is cancelled without payment becomes `FAILED`; if the money still
  arrives (EC-25, late UPI), the next reconciliation moves it to `SUCCESS`.
- Money that arrives after a booking was cancelled (EC-22) is still recorded, and shows as
  refundable.
- The API is not on the internet: Cashfree calls `https://<site>/webhooks/cashfree` on the
  website, which forwards the exact bytes to the API.
- Staging uses Cashfree's **sandbox** only; the API refuses production keys anywhere but the
  production deployment, and sandbox keys there.

## Refunds through Cashfree (added 21 October 2026)

1. Finance or a manager asks for a refund on the booking (amount within what is due to be
   refunded). It is tied to one online payment — the newest that can take it — and holds
   that amount. Nothing is sent.
2. A **different** Finance / manager user approves it (D-19 extension; the database refuses
   the same person). Only then is it sent: `POST /pg/orders/{order_id}/refunds`, with our
   refund id as the idempotency key so "Send again" after a network error cannot refund
   twice. A gateway refusal (4xx) fails the refund and frees the amount.
3. Cashfree's record decides the outcome: its refund webhook, the 10-minute check or **Check
   refund status** read the refund; `SUCCESS` → CONFIRMED by the `PAYMENT_GATEWAY` actor and
   the payment (partially) refunded and the cancellation closed exactly as for an offline
   refund; `CANCELLED` / `REJECTED` → FAILED.

Refunds paid outside Cashfree (UPI, bank, cash) are still recorded and confirmed by two
people as before. In the sandbox the refund note is `SUCCESS` so Cashfree simulates a paid
refund (Cashfree docs); live refunds carry the reason.

## Open

- **Link validity** is a setting (`PAYMENT_LINK_EXPIRY_HOURS`, 48 hours) until payment timing
  is decided with D-06 (FS §31: "payment timing unspecified").
- **Deposit or full payment** stays D-06; links default to the whole balance due.
- Cashfree's payment-link webhook format is unclear in its docs; we rely on the standard
  signed payment webhooks (which carry the link id in `order_tags`) plus reconciliation.
  Confirm in the sandbox that payment webhooks arrive for link payments.

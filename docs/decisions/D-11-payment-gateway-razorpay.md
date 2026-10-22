# D-11 (part) — Online payments: Razorpay payment links (replaces Cashfree)

|            |                                                                              |
| ---------- | ---------------------------------------------------------------------------- |
| Decision   | Which payment gateway takes online payments                                  |
| Status     | **Decided** by the Product Owner, 22 October 2026                            |
| Relates to | D-11 (vendors), FS §11.2, §32, MR-19, NFR-06, NFR-09, EC-22–EC-26, D-04 §2.2 |
| Replaces   | The gateway choice in `D-11-payment-gateway-cashfree.md`                     |

## Decision

- **Gateway: Razorpay**, because Navagraha needs its own merchant account (the Cashfree
  account belongs to InstaLeads).
- Everything else in `D-11-payment-gateway-cashfree.md` stays as decided: payment links sent
  on WhatsApp by us, money recorded only from the gateway's own records, webhooks verified,
  stored once and only triggering a reconciliation, the 10-minute safety check, refunds asked
  by one Finance / manager user and approved by a different one before anything is sent.
- Cashfree remains selectable (`PAYMENT_GATEWAY=cashfree`); nothing else changes.

## How Razorpay is used (API v1, docs read 22 October 2026)

| What             | Razorpay                                                                             |
| ---------------- | ------------------------------------------------------------------------------------ |
| Link             | `POST /v1/payment_links`, amount in paise, our link id as `reference_id` (unique)    |
| Our notices      | `notify: {sms: false, email: false}` — we send the link on WhatsApp                  |
| Read a link      | `GET /v1/payment_links?reference_id=…`; captured `payments` on the link              |
| Refund           | `POST /v1/payments/{payment_id}/refund`, our refund id as `receipt`                  |
| No double refund | before sending, and after a refusal, look the receipt up in `/payments/{id}/refunds` |
| Refund outcome   | `processed` → refunded; `failed` → failed; `pending` → keep checking                 |
| Webhooks         | `https://<site>/webhooks/razorpay`; hex HMAC-SHA256 of the raw body with the webhook |
|                  | secret (`X-Razorpay-Signature`); `X-Razorpay-Event-Id` makes repeats harmless        |
| Test or live     | chosen by the key: `rzp_test_` on staging only, `rzp_live_` on production only       |

## Switching over

- An open Cashfree link stops holding the balance at the next check, because Razorpay has
  never heard of it; payments already recorded stay as they are.
- A Cashfree payment cannot be refunded through Razorpay: the refund is refused before
  anything is sent; record it as a refund paid outside the gateway.

## Open

- Production needs the Razorpay account activated (KYC) and live keys on the production
  deployment only.
- Gateway fees and who bears them stay with D-06 / D-08.

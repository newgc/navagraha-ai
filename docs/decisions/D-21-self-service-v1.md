# D-21 — Self-service booking, first version: request → plan → accept → pay

|            |                                                                                     |
| ---------- | ----------------------------------------------------------------------------------- |
| Decision   | How customers book on the website before the planning engine and rate card exist    |
| Status     | **Decided** by the Product Owner, 21 October 2026                                   |
| Relates to | FS §4.2, §4.10, §8.1 TripRequest, §12.1; D-04 §3 Lead; D-08; D-11; D-20; NAV-AI-007 |

## Decision

1. **Request.** Anyone can fill in **Plan My Pilgrimage** (`/plan`): date (flexible or not),
   1 day / 2 days / "recommend", pickup, travellers (age band, relation, wheelchair), purpose,
   hotel, notes, name and email. The mobile number is verified with a WhatsApp code **at the
   end**, which also signs the person in. The request is a **Lead** (D-04 §3) in `NEW`,
   created by the system on the customer's behalf.
2. **Plan and price by hand.** Operations open **Trip requests**, and send a **proposal** —
   itinerary, quote lines, supplier items — with the same D-20 structural check and timing
   sign-off as a phone booking, and prices entered by the coordinator until the D-08 rate
   card exists. The lead moves `PLANNING → QUOTED`; the customer is told on WhatsApp. A
   revision is a new, immutable proposal version; only the newest can be accepted.
3. **Accept.** The customer sees the plan at **My trips** (`/trips`) and clicks **Accept and
   book** within the price's validity (MR-13). The booking is created from that exact
   proposal: itinerary and quote prepared by the coordinator, `PROPOSED → ACCEPTED` and
   `PRESENTED → LOCKED` by the **customer** (`acceptedVia: WEB`), booking created by the
   customer, lead `QUOTED → CONVERTED`. From here it is an ordinary booking.
4. **Pay.** **Pay now** opens the payment link (Razorpay) for the balance (reusing an open one);
   payment is recorded only from the gateway's records (D-11). The customer sees how many
   arrangements are confirmed, never supplier names or references.

Nothing in this flow invents a plan, price, timing or availability (NAV-AI-007): every plan
and price comes from a person, and the customer page says so.

## Later

- Instant prices from a rate card (D-08), then instant plans from the planning engine (P2)
  and the conversational planner (P5) — the request form maps onto FS §8.1 TripRequest.
- Customer-side change and cancellation requests (today: ask the team on WhatsApp).

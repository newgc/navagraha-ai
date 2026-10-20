# D-20 — Validating concierge itineraries before the engine exists

|            |                                                                                     |
| ---------- | ----------------------------------------------------------------------------------- |
| Decision   | Who validates a manually planned itinerary until the P2 feasibility engine is built |
| Status     | **Decided** by the Product Owner, 20 October 2026                                   |
| Relates to | D-04 §3.3 (Itinerary DRAFT → VALIDATED is engine-only), FS §12.1, FS §9.2           |

## Decision

Until the feasibility engine replaces it, the system validates a concierge itinerary with a
**structural check plus a coordinator sign-off**:

- **Structural check (system):** every stop is a temple in the trip's circuit; no temple twice;
  stops fit the template (1 day for 1D, days 1–2 for 2D/1N); planned arrival times run forward
  within each day; the travel date is not in the past; vehicle seats (if given) cover the
  travellers. Failures block; softer findings (e.g. "covers 7 of 9 temples") are warnings.
- **Sign-off (coordinator):** the coordinator must confirm they have checked opening hours and
  travel times by hand.

The itinerary is stored with `validation.level = "STRUCTURAL_WITH_OPS_SIGN_OFF"`, the
coordinator who signed off and every warning, so it is always clear it was **not
engine-checked**. The DRAFT → VALIDATED transition is still made by the system, as D-04
requires; the engine will set `validation.level = "ENGINE"` once it exists.

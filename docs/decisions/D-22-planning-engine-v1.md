# D-22 — Planning engine v1 and its settings (P2)

|            |                                                                                         |
| ---------- | --------------------------------------------------------------------------------------- |
| Decision   | How the feasibility engine plans, and the starting values of its settings               |
| Status     | **Built; settings to be reviewed** by the Product Owner and operations                  |
| Relates to | FS §8.2 DecisionRecord, §9 Itinerary Engine, §34; NAV-IT-001/002, NAV-AI-004..008; D-20 |

## What it does

- **Verified facts only (NAV-AI-007).** Visit minutes and wheelchair access from VERIFIED
  temple rows; VERIFIED opening sessions and special days; VERIFIED travel times. Anything
  missing is listed as a data gap and the engine does not plan (`DATA_INCOMPLETE`).
- **Opening hours on a date:** the most specific day type wins (a "Sunday" row replaces
  "Every day"); special days close the temple, replace its timings or mark it crowded (busy
  visit minutes + expected extra wait). Lunar-day timings (Amavasai, Pradosham…) cannot be
  placed without a panchang and are flagged for a person to check.
- **A day:** drive (verified minutes × the mode's safety factor) → wait for opening if early →
  visit (visit minutes × mode × senior factor) within a session and before last entry →
  rest → … → drive back by the latest return time. A meal break is taken in the meal window,
  during a midday wait when possible.
- **Search:** the best order of the temples (earliest return), and for 2 days the best split
  between the days (least total time out). Exhaustive with pruning, so the answer is the true
  best for the facts and settings.
- **Candidates (FS §9.1):** 1 day Fast / Balanced / Relaxed, 2 days 1 night Balanced /
  Relaxed. Each is possible or not, with the constraint that failed ("Thirunallar: arriving at
  19:40 leaves no time… before it closes (20:30)", EC-17).
- **Recommendation (FS §9.3):** weighted factors (purpose fit, comfort, travel efficiency,
  budget — indicative until D-08 —, reliability, preference fit) and plain reasons
  (NAV-AI-006).
- **DecisionRecord (FS §8.2):** every run stores the input, all candidates, the result and
  the settings and facts versions.
- **D-20 upgrade:** a proposal sent from an engine plan is checked again in its exact order; if
  it fits, its validation level is **ENGINE** and the booking made from it keeps that. If not,
  it stays at the coordinator sign-off level with the engine's finding as a warning.

## Settings to review (`engine-config-2026-10-21`)

| Setting              | Value                                                                       |
| -------------------- | --------------------------------------------------------------------------- |
| Default pickup       | 06:00                                                                       |
| Latest return        | 21:30 (to the drop point, or the hotel on day 1)                            |
| Meal                 | 45 minutes, starting between 12:00 and 14:30                                |
| Fast                 | visit × 1.0, travel × 1.1, no rest between temples                          |
| Balanced             | visit × 1.2, travel × 1.2, 10 minutes rest                                  |
| Relaxed              | visit × 1.5, travel × 1.3, 20 minutes rest                                  |
| Senior overlay (60+) | visit × 1.25 more, +10 minutes rest, at most 6 temples a day                |
| Weights (FS §9.3)    | purpose 25, comfort 20, travel 20, budget 15, reliability 10, preference 10 |

These live in `packages/domain/src/planner/config.ts`; changing them is a new version.

## Not yet

- Peak-hour travel times (`peak_minutes` / `peak_hours`), poojas and service windows, hotel
  check-in/out, vehicle availability and blackout periods (FS §9.2) — next steps as the data
  arrives.
- Customers see engine plans only through proposals; instant plans on the website come with
  the rate card (D-08) and the conversational planner (P5).

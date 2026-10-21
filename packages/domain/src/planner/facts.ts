/**
 * The verified operational facts the engine plans with (NAV-TEM, MR-47..49). Loaders pass
 * only rows whose verification_status is VERIFIED; anything missing is a data gap, never a
 * guess (NAV-AI-007).
 */

export interface SessionFact {
  /** As in the temple workbook: "Every day", "Monday"…, "Weekdays (Mon-Fri)", "Amavasai"… */
  dayType: string;
  opensAt: string;
  closesAt: string;
  lastEntryAt?: string | null;
  validFrom: string;
  validTo?: string | null;
}

export interface SpecialDayFact {
  name: string;
  fromDate: string;
  toDate: string;
  /** "Closed", "Changed timings", "Extended timings", "Very heavy crowd", "Heavy crowd"… */
  effect: string;
  changedOpensAt?: string | null;
  changedClosesAt?: string | null;
  expectedExtraWaitMinutes?: number | null;
  recursYearly?: boolean | null;
}

export interface TempleFacts {
  code: string;
  name: string;
  /** Travel-matrix node for this temple. */
  placeCode: string | null;
  visitMinutesNormal: number | null;
  visitMinutesBusy: number | null;
  wheelchairAccess: boolean | null;
  sessions: SessionFact[];
  specialDays: SpecialDayFact[];
}

export interface PlanningFacts {
  temples: TempleFacts[];
  /** Verified travel minutes, keyed `${from}>${to}`; loaders add the reverse of symmetric pairs. */
  travelMinutes: Record<string, number>;
  /** Names of the start/drop places (HUB-KUM, ORG-MAA…), for explanations. */
  places: Record<string, string>;
  /** Hotel / overnight place for 2-day plans. */
  overnightPlace: string;
  /** Version of the facts used (e.g. latest verified-at), stored in the DecisionRecord. */
  version: string;
}

export const travelKey = (from: string, to: string) => `${from}>${to}`;

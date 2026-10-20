import { TEMPLATE_DAYS, type TemplateCode } from '../catalog.js';

/** D-20 — structural validation of a manually planned itinerary until the engine exists. */

export interface ConciergeStopInput {
  templeCode: string;
  day: number;
  /** HH:MM, optional at planning time. */
  plannedArrival?: string | null;
}

export interface ConciergeItineraryInput {
  template: TemplateCode;
  startDate: string;
  today: string;
  circuitTempleCodes: readonly string[];
  stops: readonly ConciergeStopInput[];
  travellerCount: number;
  vehicleSeats?: number | null;
}

export interface ValidationFinding {
  code: string;
  message: string;
  stop?: number;
}

export function validateConciergeItinerary(input: ConciergeItineraryInput) {
  const errors: ValidationFinding[] = [];
  const warnings: ValidationFinding[] = [];
  const days = TEMPLATE_DAYS[input.template];

  if (input.startDate < input.today) {
    errors.push({ code: 'DATE_IN_PAST', message: 'The travel date is in the past' });
  }
  if (input.stops.length === 0) {
    errors.push({ code: 'NO_STOPS', message: 'Add at least one temple' });
  }
  if (input.travellerCount < 1) {
    errors.push({ code: 'NO_TRAVELLERS', message: 'Add at least one traveller' });
  }
  if (input.vehicleSeats != null && input.vehicleSeats < input.travellerCount) {
    errors.push({
      code: 'VEHICLE_TOO_SMALL',
      message: `The vehicle seats ${input.vehicleSeats} but there are ${input.travellerCount} travellers`,
    });
  }

  const seen = new Set<string>();
  const lastArrivalByDay = new Map<number, string>();
  // Compare against the last stop with a valid day, so one bad day doesn't cascade.
  let lastValidDay: number | null = null;
  input.stops.forEach((s, i) => {
    const stop = i + 1;
    if (!input.circuitTempleCodes.includes(s.templeCode)) {
      errors.push({
        code: 'NOT_IN_CIRCUIT',
        message: `${s.templeCode} is not in this circuit`,
        stop,
      });
    }
    if (seen.has(s.templeCode)) {
      errors.push({ code: 'DUPLICATE_TEMPLE', message: `${s.templeCode} appears twice`, stop });
    }
    seen.add(s.templeCode);
    if (!Number.isInteger(s.day) || s.day < 1 || s.day > days) {
      errors.push({
        code: 'DAY_OUT_OF_RANGE',
        message: `Day ${s.day} does not fit a ${input.template} trip (days 1–${days})`,
        stop,
      });
      return;
    }
    if (lastValidDay != null && s.day < lastValidDay) {
      errors.push({ code: 'DAYS_OUT_OF_ORDER', message: 'Stops must be in day order', stop });
    }
    lastValidDay = s.day;
    if (s.plannedArrival) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.plannedArrival)) {
        errors.push({ code: 'BAD_TIME', message: `"${s.plannedArrival}" is not HH:MM`, stop });
        return;
      }
      const last = lastArrivalByDay.get(s.day);
      if (last && s.plannedArrival <= last) {
        errors.push({
          code: 'TIMES_OUT_OF_ORDER',
          message: `Arrival ${s.plannedArrival} is not after the previous stop (${last})`,
          stop,
        });
      }
      lastArrivalByDay.set(s.day, s.plannedArrival);
    }
  });

  const covered = [...seen].filter((c) => input.circuitTempleCodes.includes(c)).length;
  if (covered > 0 && covered < input.circuitTempleCodes.length) {
    warnings.push({
      code: 'PARTIAL_CIRCUIT',
      message: `Covers ${covered} of ${input.circuitTempleCodes.length} temples`,
    });
  }
  for (let d = 1; d <= days; d++) {
    if (input.stops.length > 0 && !input.stops.some((s) => s.day === d)) {
      warnings.push({ code: 'EMPTY_DAY', message: `Day ${d} has no temples` });
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENGINE_CONFIG,
  evaluateItinerary,
  planTrip,
  scheduleFor,
  travelKey,
  type PlanRequest,
  type PlanningFacts,
  type TempleFacts,
} from '../src/index.js';

const CODES = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9'];
// A Wednesday.
const DATE = '2026-11-04';

function temple(code: string, overrides: Partial<TempleFacts> = {}): TempleFacts {
  return {
    code,
    name: `Temple ${code}`,
    placeCode: `P-${code}`,
    visitMinutesNormal: 30,
    visitMinutesBusy: 60,
    wheelchairAccess: true,
    sessions: [
      {
        dayType: 'Every day',
        opensAt: '06:00',
        closesAt: '12:30',
        lastEntryAt: '12:15',
        validFrom: '2026-01-01',
      },
      {
        dayType: 'Every day',
        opensAt: '16:00',
        closesAt: '20:30',
        lastEntryAt: '20:15',
        validFrom: '2026-01-01',
      },
    ],
    specialDays: [],
    ...overrides,
  };
}

/** Temples on a line, 15 minutes apart; the hub sits next to T1. */
function facts(temples = CODES.map((c) => temple(c))): PlanningFacts {
  const pos: Record<string, number> = { HUB: 0 };
  CODES.forEach((c, i) => (pos[`P-${c}`] = i + 1));
  const travelMinutes: Record<string, number> = {};
  for (const a of Object.keys(pos)) {
    for (const b of Object.keys(pos)) {
      if (a !== b) travelMinutes[travelKey(a, b)] = 15 * Math.abs(pos[a]! - pos[b]!);
    }
  }
  return {
    temples,
    travelMinutes,
    places: { HUB: 'Kumbakonam' },
    overnightPlace: 'HUB',
    version: 'test-facts',
  };
}

const adults = [{ ageBand: 'ADULT_18_59' }, { ageBand: 'ADULT_18_59' }];
const request = (overrides: Partial<PlanRequest> = {}): PlanRequest => ({
  startDate: DATE,
  fromPlace: 'HUB',
  temples: CODES,
  travellers: adults,
  purpose: 'ALL_NINE',
  days: 'RECOMMEND',
  ...overrides,
});

describe('opening hours on a date', () => {
  it('uses the most specific day type and applies special days', () => {
    const t = temple('T1', {
      sessions: [
        { dayType: 'Every day', opensAt: '06:00', closesAt: '12:00', validFrom: '2026-01-01' },
        { dayType: 'Sunday', opensAt: '05:00', closesAt: '13:00', validFrom: '2026-01-01' },
        { dayType: 'Amavasai', opensAt: '04:00', closesAt: '22:00', validFrom: '2026-01-01' },
      ],
      specialDays: [
        {
          name: 'Pongal',
          fromDate: '2020-01-14',
          toDate: '2020-01-15',
          effect: 'Closed',
          recursYearly: true,
        },
        {
          name: 'Peyarchi',
          fromDate: '2026-11-04',
          toDate: '2026-11-04',
          effect: 'Very heavy crowd',
          expectedExtraWaitMinutes: 90,
        },
      ],
    });
    expect(scheduleFor(t, '2026-11-08').windows).toEqual([
      { open: 300, lastEntry: 780, close: 780 },
    ]);
    const wed = scheduleFor(t, DATE);
    expect(wed.windows).toEqual([{ open: 360, lastEntry: 720, close: 720 }]);
    expect(wed.busy).toEqual({ extraWaitMinutes: 90, reason: 'Peyarchi' });
    expect(wed.notes.map((n) => n.code)).toContain('LUNAR_DAY_UNCHECKED');
    expect(scheduleFor(t, '2027-01-15')).toMatchObject({ closed: true, windows: [] });
  });
});

describe('planning engine (FS §9, NAV-IT-002)', () => {
  it('plans every template × mode and recommends one with reasons', () => {
    const r = planTrip(request(), facts());
    expect(r.status).toBe('OK');
    expect(r.candidates.map((c) => c.id)).toEqual([
      '1D-FAST',
      '1D-BALANCED',
      '1D-RELAXED',
      '2D1N-BALANCED',
      '2D1N-RELAXED',
    ]);
    const fast = r.candidates.find((c) => c.id === '1D-FAST')!;
    expect(fast.feasible).toBe(true);
    expect(fast.days[0]!.temples).toHaveLength(9);
    // Visits never start before opening or end after closing.
    for (const e of fast.days[0]!.events) {
      if (e.kind === 'VISIT') {
        const inMorning = e.enter >= '06:00' && e.leave <= '12:30';
        const inEvening = e.enter >= '16:00' && e.leave <= '20:30';
        expect(inMorning || inEvening).toBe(true);
      }
    }
    // Lunch fits in the midday closure.
    expect(fast.days[0]!.events.some((e) => e.kind === 'MEAL')).toBe(true);
    expect(r.recommended).toBeTruthy();
    expect(r.reasons[0]).toMatch(/scores highest/);
    expect(r.configVersion).toBe(DEFAULT_ENGINE_CONFIG.version);
    expect(r.factsVersion).toBe('test-facts');
  });

  it('applies the senior overlay: no nine-temple day, so two days are recommended', () => {
    const r = planTrip(
      request({ travellers: [{ ageBand: 'SENIOR_75_PLUS' }, ...adults] }),
      facts(),
    );
    expect(r.senior).toBe(true);
    const oneDay = r.candidates.filter((c) => c.template === '1D');
    expect(oneDay.every((c) => !c.feasible)).toBe(true);
    expect(oneDay[0]!.failure!.code).toBe('TOO_MANY_TEMPLES_FOR_SENIORS');
    expect(r.recommended).toMatch(/^2D1N-/);
    const two = r.candidates.find((c) => c.id === r.recommended)!;
    expect(two.days.map((d) => d.temples.length).every((n) => n <= 6)).toBe(true);
    expect(two.days.flatMap((d) => d.temples).sort()).toEqual(CODES);
    expect(two.days[1]!.date).toBe('2026-11-05');
    expect(r.reasons.join(' ')).toMatch(/Senior-friendly/);
  });

  it('never plans with missing or unverified facts (NAV-AI-007)', () => {
    const f = facts([
      ...CODES.slice(0, 8).map((c) => temple(c)),
      temple('T9', { visitMinutesNormal: null }),
    ]);
    delete f.travelMinutes[travelKey('P-T3', 'P-T4')];
    const r = planTrip(request(), f);
    expect(r.status).toBe('DATA_INCOMPLETE');
    expect(r.candidates).toEqual([]);
    expect(r.gaps.map((g) => g.code)).toEqual(['VISIT_MINUTES_MISSING', 'TRAVEL_TIME_MISSING']);
    expect(r.gaps[1]!.message).toMatch(/P-T3 → P-T4/);
  });

  it('says honestly when nothing fits (EC-17)', () => {
    const closed = {
      name: 'Kumbabhishekam',
      fromDate: DATE,
      toDate: '2026-11-05',
      effect: 'Closed',
    };
    const f = facts(CODES.map((c) => temple(c, c === 'T5' ? { specialDays: [closed] } : {})));
    const r = planTrip(request(), f);
    expect(r.status).toBe('NO_FEASIBLE_PLAN');
    expect(r.candidates.every((c) => c.failure?.code === 'TEMPLE_CLOSED')).toBe(true);
    expect(r.candidates[0]!.failure!.message).toMatch(/Temple T5 is closed/);
  });

  it('notes wheelchair access and lunar-day timings for people to check', () => {
    const f = facts(CODES.map((c) => temple(c, c === 'T2' ? { wheelchairAccess: false } : {})));
    const r = planTrip(
      request({ travellers: [{ ageBand: 'ADULT_18_59', needsWheelchair: true }] }),
      f,
    );
    expect(r.notes.map((n) => n.code)).toContain('NO_WHEELCHAIR_ACCESS');
  });
});

describe('evaluating a hand-made itinerary (D-20 → engine)', () => {
  const base = {
    template: '1D' as const,
    mode: 'BALANCED' as const,
    startDate: DATE,
    fromPlace: 'HUB',
    travellers: adults,
  };

  it('accepts an order that fits and returns its timetable', () => {
    const r = evaluateItinerary(
      { ...base, stops: CODES.slice(0, 4).map((templeCode) => ({ templeCode, day: 1 })) },
      facts(),
    );
    expect(r.status).toBe('FEASIBLE');
    expect(r.days[0]!.events[0]).toMatchObject({
      kind: 'TRAVEL',
      from: 'HUB',
      to: 'P-T1',
      depart: '06:00',
    });
  });

  it('rejects an order that arrives after closing, saying where', () => {
    const late = evaluateItinerary(
      { ...base, startTime: '19:00', stops: CODES.map((templeCode) => ({ templeCode, day: 1 })) },
      facts(),
    );
    expect(late.status).toBe('NOT_FEASIBLE');
    expect(late.failure!.code).toBe('ARRIVES_AFTER_CLOSING');
    expect(late.failure!.temple).toBeDefined();
  });
});

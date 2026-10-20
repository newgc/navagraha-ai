import { describe, expect, it } from 'vitest';
import {
  bookingMachine,
  calculateQuote,
  checkOfflineConfirmation,
  decideForRoles,
  validateConciergeItinerary,
  type ConciergeItineraryInput,
} from '../src/index.js';

describe('calculateQuote', () => {
  const line = {
    kind: 'VEHICLE',
    description: 'Innova, 1 day',
    quantity: 1,
    unitPricePaise: 450000,
    taxPaise: 22500,
  };

  it('is deterministic integer arithmetic', () => {
    const q = calculateQuote([
      line,
      { ...line, kind: 'POOJA', quantity: 3, unitPricePaise: 5000, taxPaise: 0 },
    ]);
    expect(q).toMatchObject({ subtotalPaise: 465000, taxPaise: 22500, totalPaise: 487500 });
    expect(q.lines.map((l) => [l.seq, l.lineTotalPaise])).toEqual([
      [1, 472500],
      [2, 15000],
    ]);
    expect(calculateQuote([line])).toEqual(calculateQuote([line]));
  });

  it('rejects bad lines', () => {
    expect(() => calculateQuote([])).toThrow(/at least one/);
    expect(() => calculateQuote([{ ...line, quantity: 0 }])).toThrow(/quantity/);
    expect(() => calculateQuote([{ ...line, unitPricePaise: 10.5 }])).toThrow(/paise/);
    expect(() => calculateQuote([{ ...line, taxPaise: -1 }])).toThrow(/paise/);
    expect(() =>
      calculateQuote([{ ...line, quantity: 1000, unitPricePaise: 1_00_00_000_00 }]),
    ).toThrow(/implausibly/);
  });
});

describe('validateConciergeItinerary (D-20)', () => {
  const nine = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9'];
  const base: ConciergeItineraryInput = {
    template: '1D',
    startDate: '2026-11-01',
    today: '2026-10-20',
    circuitTempleCodes: nine,
    stops: nine.map((templeCode) => ({ templeCode, day: 1 })),
    travellerCount: 4,
    vehicleSeats: 7,
  };
  const codes = (r: ReturnType<typeof validateConciergeItinerary>) => r.errors.map((e) => e.code);

  it('accepts a full one-day circuit', () => {
    expect(validateConciergeItinerary(base)).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it('finds structural errors', () => {
    const r = validateConciergeItinerary({
      ...base,
      startDate: '2026-10-19',
      vehicleSeats: 3,
      stops: [
        { templeCode: 'T1', day: 1, plannedArrival: '09:00' },
        { templeCode: 'T1', day: 1, plannedArrival: '08:00' },
        { templeCode: 'XX', day: 2 },
        { templeCode: 'T3', day: 1, plannedArrival: '9am' },
      ],
    });
    expect(codes(r)).toEqual([
      'DATE_IN_PAST',
      'VEHICLE_TOO_SMALL',
      'DUPLICATE_TEMPLE',
      'TIMES_OUT_OF_ORDER',
      'NOT_IN_CIRCUIT',
      'DAY_OUT_OF_RANGE',
      'BAD_TIME',
    ]);
    expect(r.ok).toBe(false);
  });

  it('two-day trips: days in order, warnings for partial circuits and empty days', () => {
    const r = validateConciergeItinerary({
      ...base,
      template: '2D1N',
      stops: [
        { templeCode: 'T1', day: 2 },
        { templeCode: 'T2', day: 1 },
      ],
    });
    expect(codes(r)).toEqual(['DAYS_OUT_OF_ORDER']);
    const ok = validateConciergeItinerary({
      ...base,
      template: '2D1N',
      stops: [{ templeCode: 'T1', day: 1 }],
    });
    expect(ok.ok).toBe(true);
    expect(ok.warnings.map((w) => w.code)).toEqual(['PARTIAL_CIRCUIT', 'EMPTY_DAY']);
  });
});

describe('checkOfflineConfirmation (D-19)', () => {
  it('needs a different person with Finance or Ops Manager role', () => {
    expect(
      checkOfflineConfirmation({
        recordedByUserId: 'a',
        confirmerUserId: 'b',
        confirmerRoles: ['FINANCE'],
      }),
    ).toEqual({ ok: true });
    expect(
      checkOfflineConfirmation({
        recordedByUserId: 'a',
        confirmerUserId: 'a',
        confirmerRoles: ['OPS_MANAGER'],
      }),
    ).toEqual({ ok: false, reason: 'SAME_PERSON' });
    expect(
      checkOfflineConfirmation({
        recordedByUserId: 'a',
        confirmerUserId: 'b',
        confirmerRoles: ['OPS_COORDINATOR'],
      }),
    ).toEqual({ ok: false, reason: 'ROLE_NOT_ALLOWED' });
  });
});

describe('decideForRoles', () => {
  it('uses the first role the machine allows', () => {
    const d = decideForRoles(
      bookingMachine,
      { from: 'CONFIRMED', to: 'PENDING_CONFIRMATION', reason: 'x' },
      ['CUSTOMER', 'OPS_MANAGER'],
    );
    expect(d).toMatchObject({ ok: true, role: 'OPS_MANAGER' });
  });

  it('reports the most useful failure', () => {
    expect(
      decideForRoles(bookingMachine, { from: 'CONFIRMED', to: 'PENDING_CONFIRMATION' }, [
        'OPS_MANAGER',
      ]),
    ).toMatchObject({ ok: false, error: 'REASON_REQUIRED' });
    expect(
      decideForRoles(bookingMachine, { from: 'COMPLETED', to: 'CANCELLED' }, ['SYSTEM']),
    ).toMatchObject({
      ok: false,
      error: 'FROM_TERMINAL_STATE',
    });
    expect(
      decideForRoles(bookingMachine, { from: 'REQUESTED', to: 'PENDING_CONFIRMATION' }, []),
    ).toMatchObject({
      ok: false,
      error: 'ROLE_NOT_ALLOWED',
    });
  });
});

describe('inActingOrder', () => {
  it('puts staff roles before CUSTOMER, least privileged first', async () => {
    const { inActingOrder } = await import('../src/index.js');
    expect(inActingOrder(['CUSTOMER', 'OPS_MANAGER', 'OPS_COORDINATOR'])).toEqual([
      'OPS_COORDINATOR',
      'OPS_MANAGER',
      'CUSTOMER',
    ]);
  });
});

describe('allocateRefund', () => {
  it('takes from the newest payment first and never over-refunds one', async () => {
    const { allocateRefund } = await import('../src/index.js');
    const ps = [
      { id: 'a', capturedPaise: 400000, refundedPaise: 0 },
      { id: 'b', capturedPaise: 249500, refundedPaise: 49500 },
    ];
    expect(allocateRefund(ps, 100000)).toEqual([{ paymentId: 'b', paise: 100000 }]);
    expect(allocateRefund(ps, 300000)).toEqual([
      { paymentId: 'b', paise: 200000 },
      { paymentId: 'a', paise: 100000 },
    ]);
    expect(() => allocateRefund(ps, 600001)).toThrow(/larger/);
    expect(() => allocateRefund(ps, 0)).toThrow(/positive/);
  });
});

import { describe, expect, it } from 'vitest';
import {
  confirmationGate,
  deriveFulfilmentState,
  derivePassport,
  paymentConditionMet,
  type PaymentSnapshot,
} from '../src/index.js';

const paid = (capturedPaise: number, refundedPaise = 0): PaymentSnapshot => ({
  state: refundedPaise > 0 ? 'PARTIALLY_REFUNDED' : 'SUCCESS',
  capturedPaise,
  refundedPaise,
});
const pending: PaymentSnapshot = { state: 'PENDING', capturedPaise: 0, refundedPaise: 0 };

describe('deriveFulfilmentState', () => {
  const vehicle = { slot: 'vehicle', mandatory: true } as const;
  const hotel = { slot: 'hotel:night-1', mandatory: true } as const;

  it('PENDING → PARTIAL → ALL_REQUIRED_CONFIRMED', () => {
    expect(
      deriveFulfilmentState([
        { ...vehicle, state: 'REQUESTED' },
        { ...hotel, state: 'PENDING' },
      ]),
    ).toBe('PENDING');
    expect(
      deriveFulfilmentState([
        { ...vehicle, state: 'CONFIRMED' },
        { ...hotel, state: 'REQUESTED' },
      ]),
    ).toBe('PARTIAL');
    expect(
      deriveFulfilmentState([
        { ...vehicle, state: 'CONFIRMED' },
        { ...hotel, state: 'CONFIRMED' },
      ]),
    ).toBe('ALL_REQUIRED_CONFIRMED');
  });

  it('ignores optional components', () => {
    expect(
      deriveFulfilmentState([
        { ...vehicle, state: 'CONFIRMED' },
        { slot: 'pooja:TEM-SHA', mandatory: false, state: 'DECLINED' },
      ]),
    ).toBe('ALL_REQUIRED_CONFIRMED');
  });

  it('a declined component replaced in the same slot counts once confirmed', () => {
    expect(
      deriveFulfilmentState([
        { ...hotel, state: 'DECLINED' },
        { ...hotel, state: 'CONFIRMED' },
      ]),
    ).toBe('ALL_REQUIRED_CONFIRMED');
    expect(deriveFulfilmentState([{ ...hotel, state: 'DECLINED' }])).toBe('PENDING');
  });

  it('cancellation and unrecoverable failure override', () => {
    const comps = [{ ...vehicle, state: 'RELEASED' as const }];
    expect(deriveFulfilmentState(comps, { bookingCancelled: true })).toBe('RELEASED');
    expect(
      deriveFulfilmentState([{ ...vehicle, state: 'CANCELLED' }], { bookingCancelled: true }),
    ).toBe('CANCELLED');
    expect(
      deriveFulfilmentState([{ ...hotel, state: 'DECLINED' }], { markedUnrecoverable: true }),
    ).toBe('FAILED');
  });
});

describe('paymentConditionMet', () => {
  it('FULL_PAYMENT (default) needs the whole amount net of refunds', () => {
    expect(paymentConditionMet(10_000_00, [paid(10_000_00)])).toBe(true);
    expect(paymentConditionMet(10_000_00, [paid(9_999_99)])).toBe(false);
    expect(paymentConditionMet(10_000_00, [paid(10_000_00, 1)])).toBe(false);
    expect(paymentConditionMet(10_000_00, [paid(4_000_00), paid(6_000_00)])).toBe(true);
  });

  it('pending and failed payments never count', () => {
    expect(paymentConditionMet(100, [pending, { ...pending, state: 'FAILED' }])).toBe(false);
  });

  it('DEPOSIT_PERCENT rounds the required deposit up', () => {
    const policy = { kind: 'DEPOSIT_PERCENT', percent: 25 } as const;
    expect(paymentConditionMet(1001, [paid(250)], policy)).toBe(false);
    expect(paymentConditionMet(1001, [paid(251)], policy)).toBe(true);
    expect(() => paymentConditionMet(100, [], { kind: 'DEPOSIT_PERCENT', percent: 0 })).toThrow();
  });

  it('NOT_REQUIRED payments satisfy the condition', () => {
    expect(
      paymentConditionMet(500, [{ state: 'NOT_REQUIRED', capturedPaise: 0, refundedPaise: 0 }]),
    ).toBe(true);
  });

  it('rejects non-integer money', () => {
    expect(() => paymentConditionMet(10.5, [])).toThrow();
  });
});

describe('confirmationGate — payment and fulfilment are parallel', () => {
  it('opens only when both hold', () => {
    expect(
      confirmationGate({
        totalPaise: 100,
        payments: [paid(100)],
        fulfilment: 'ALL_REQUIRED_CONFIRMED',
      }),
    ).toEqual({ open: true });
  });

  it('EC-22 / EC-07: payment success alone does not confirm', () => {
    expect(
      confirmationGate({ totalPaise: 100, payments: [paid(100)], fulfilment: 'PARTIAL' }),
    ).toEqual({
      open: false,
      waitingFor: ['FULFILMENT'],
    });
  });

  it('reports everything it is waiting for', () => {
    expect(
      confirmationGate({ totalPaise: 100, payments: [pending], fulfilment: 'PENDING' }),
    ).toEqual({
      open: false,
      waitingFor: ['PAYMENT', 'FULFILMENT'],
    });
  });
});

describe('derivePassport', () => {
  const nine = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9'];

  it('counts distinct completed circuit temples only', () => {
    const p = derivePassport(nine, [
      { templeId: 'T1', state: 'COMPLETED' },
      { templeId: 'T1', state: 'COMPLETED' },
      { templeId: 'T2', state: 'SKIPPED' },
      { templeId: 'T3', state: 'VISITING' },
      { templeId: 'OTHER', state: 'COMPLETED' },
    ]);
    expect(p).toMatchObject({ completed: 1, total: 9, isComplete: false });
    expect(p.remainingTempleIds).toHaveLength(8);
  });

  it('a skipped temple is never treated as completed (FS §13.2)', () => {
    expect(derivePassport(['T1'], [{ templeId: 'T1', state: 'SKIPPED' }]).completed).toBe(0);
  });

  it('accumulates across trips to 9/9', () => {
    const p = derivePassport(
      nine,
      nine.map((templeId) => ({ templeId, state: 'COMPLETED' as const })),
    );
    expect(p).toMatchObject({ completed: 9, isComplete: true });
  });
});

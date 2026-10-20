import { describe, expect, it } from 'vitest';
import {
  ALL_MACHINES,
  ROLES,
  bookingMachine,
  canCreate,
  decide,
  edges,
  itineraryMachine,
  paymentMachine,
  quoteMachine,
  templeVisitMachine,
  tripMachine,
} from '../src/index.js';

describe('canonical machines — cross-cutting guarantees', () => {
  it('every machine reaches every state (no orphan states)', () => {
    for (const m of ALL_MACHINES) {
      const reachable = new Set<string>(m.create.map((c) => c.state));
      for (const e of edges(m)) reachable.add(e.to);
      expect(
        [...m.states].filter((s) => !reachable.has(s)),
        m.name,
      ).toEqual([]);
    }
  });

  it('only uses known roles', () => {
    for (const m of ALL_MACHINES) {
      for (const t of m.transitions) for (const r of t.by) expect(ROLES).toContain(r);
    }
  });

  it('has no AI / planner role — the LLM has no transition authority (FS §8.3)', () => {
    expect(ROLES.some((r) => /AI|LLM|PLANNER/.test(r))).toBe(false);
  });

  it('NFR-18 / EC-45: a customer can never move a TempleVisit', () => {
    for (const e of edges(templeVisitMachine)) expect(e.rule.by).not.toContain('CUSTOMER');
    expect(templeVisitMachine.create.flatMap((c) => c.by)).not.toContain('CUSTOMER');
  });

  it('customer permissions are exactly the approved allow-list', () => {
    const granted = ALL_MACHINES.flatMap((m) => [
      ...m.create
        .filter((c) => c.by.includes('CUSTOMER'))
        .map((c) => `${m.name}:create:${c.state}`),
      ...edges(m)
        .filter((e) => e.rule.by.includes('CUSTOMER'))
        .map((e) => `${m.name}:${e.from}->${e.to}`),
    ]).sort();
    expect(granted).toEqual(
      [
        'Booking:create:REQUESTED',
        'Cancellation:create:REQUESTED',
        'ChangeRequest:REQUESTED->WITHDRAWN',
        'ChangeRequest:REVIEWING->WITHDRAWN',
        'ChangeRequest:create:REQUESTED',
        'Itinerary:PROPOSED->ACCEPTED',
        'PlanningSession:COLLECTING->CANCELLED',
        'PlanningSession:OPEN->CANCELLED',
        'PlanningSession:PLAN_GENERATED->CANCELLED',
        'PlanningSession:READY->CANCELLED',
        'PlanningSession:create:OPEN',
        'Quote:PRESENTED->LOCKED',
      ].sort(),
    );
  });
});

describe('Booking', () => {
  it('only the system can confirm — never a customer or ops shortcut', () => {
    for (const role of ROLES) {
      const d = decide(bookingMachine, { from: 'PENDING_CONFIRMATION', to: 'CONFIRMED', role });
      expect(d.ok, role).toBe(role === 'SYSTEM');
    }
  });

  it('can be cancelled from any open state, but only by the system (via an approved Cancellation)', () => {
    for (const from of ['REQUESTED', 'PENDING_CONFIRMATION', 'CONFIRMED', 'IN_PROGRESS'] as const) {
      expect(decide(bookingMachine, { from, to: 'CANCELLED', role: 'SYSTEM' }).ok).toBe(true);
      expect(decide(bookingMachine, { from, to: 'CANCELLED', role: 'CUSTOMER' }).ok).toBe(false);
    }
  });

  it('dropping back from CONFIRMED needs a reason', () => {
    expect(
      decide(bookingMachine, { from: 'CONFIRMED', to: 'PENDING_CONFIRMATION', role: 'SYSTEM' }),
    ).toMatchObject({ error: 'REASON_REQUIRED' });
  });

  it('ops can create manual bookings (EC-38)', () => {
    expect(canCreate(bookingMachine, 'REQUESTED', 'OPS_COORDINATOR')).toBe(true);
  });
});

describe('Payment', () => {
  it('success comes only from the gateway or server reconciliation', () => {
    for (const role of ROLES) {
      const d = decide(paymentMachine, { from: 'PENDING', to: 'SUCCESS', role });
      expect(d.ok, role).toBe(role === 'PAYMENT_GATEWAY' || role === 'SYSTEM');
    }
  });

  it('accepts a late capture after FAILED, but cannot refund a failed payment', () => {
    expect(
      decide(paymentMachine, { from: 'FAILED', to: 'SUCCESS', role: 'PAYMENT_GATEWAY' }).ok,
    ).toBe(true);
    expect(
      decide(paymentMachine, { from: 'FAILED', to: 'REFUNDED', role: 'SYSTEM' }),
    ).toMatchObject({
      error: 'ILLEGAL_TRANSITION',
    });
  });

  it('finance cannot mark a payment refunded directly — the gateway must confirm', () => {
    expect(
      decide(paymentMachine, { from: 'SUCCESS', to: 'REFUNDED', role: 'FINANCE' }),
    ).toMatchObject({ error: 'ROLE_NOT_ALLOWED' });
  });

  it('REFUNDED is final', () => {
    expect(
      decide(paymentMachine, { from: 'REFUNDED', to: 'PARTIALLY_REFUNDED', role: 'SYSTEM' }),
    ).toMatchObject({ error: 'FROM_TERMINAL_STATE' });
  });
});

describe('Quote', () => {
  it('only the quote engine calculates', () => {
    expect(decide(quoteMachine, { from: 'DRAFT', to: 'CALCULATED', role: 'SYSTEM' }).ok).toBe(true);
    expect(decide(quoteMachine, { from: 'DRAFT', to: 'CALCULATED', role: 'OPS_MANAGER' }).ok).toBe(
      false,
    );
  });

  it('a locked quote cannot be cancelled, only expire', () => {
    expect(decide(quoteMachine, { from: 'LOCKED', to: 'CANCELLED', role: 'SYSTEM' }).ok).toBe(
      false,
    );
    expect(decide(quoteMachine, { from: 'LOCKED', to: 'EXPIRED', role: 'SYSTEM' }).ok).toBe(true);
  });
});

describe('Itinerary', () => {
  it('only the feasibility engine validates', () => {
    expect(
      decide(itineraryMachine, { from: 'DRAFT', to: 'VALIDATED', role: 'OPS_MANAGER' }).ok,
    ).toBe(false);
  });

  it('ops adjustments need a reason', () => {
    expect(
      decide(itineraryMachine, { from: 'VALIDATED', to: 'OPS_ADJUSTED', role: 'OPS_COORDINATOR' }),
    ).toMatchObject({ error: 'REASON_REQUIRED' });
  });
});

describe('Trip', () => {
  it('resuming after an incident is a manager decision', () => {
    const base = { from: 'INCIDENT', to: 'IN_PROGRESS', reason: 'cleared' } as const;
    expect(decide(tripMachine, { ...base, role: 'OPS_MANAGER' }).ok).toBe(true);
    expect(decide(tripMachine, { ...base, role: 'OPS_COORDINATOR' }).ok).toBe(false);
  });

  it('a driver can start the trip but not complete it', () => {
    expect(decide(tripMachine, { from: 'PICKUP_READY', to: 'STARTED', role: 'DRIVER' }).ok).toBe(
      true,
    );
    expect(decide(tripMachine, { from: 'IN_PROGRESS', to: 'COMPLETED', role: 'DRIVER' }).ok).toBe(
      false,
    );
  });
});

describe('TempleVisit', () => {
  it('only an ops manager can correct a false completion (EC-37)', () => {
    const base = { from: 'COMPLETED', to: 'SKIPPED', reason: 'recorded in error' } as const;
    expect(decide(templeVisitMachine, { ...base, role: 'OPS_MANAGER' }).ok).toBe(true);
    expect(decide(templeVisitMachine, { ...base, role: 'OPS_COORDINATOR' }).ok).toBe(false);
    expect(decide(templeVisitMachine, { ...base, role: 'DRIVER' }).ok).toBe(false);
  });

  it('a coordinator recording by phone must leave a note', () => {
    expect(
      decide(templeVisitMachine, { from: 'PLANNED', to: 'COMPLETED', role: 'OPS_COORDINATOR' }),
    ).toMatchObject({ error: 'REASON_REQUIRED' });
    expect(
      decide(templeVisitMachine, { from: 'PLANNED', to: 'COMPLETED', role: 'DRIVER', reason: 'x' }),
    ).toMatchObject({ error: 'ROLE_NOT_ALLOWED' });
  });
});

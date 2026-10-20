import { schema } from '@navagraha/db';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signInAs } from './app.js';
import { NINE, inDays, manualBooking } from './fixtures.js';

const url = process.env.TEST_DATABASE_URL;
const TOTAL = 649500; // the fixture quote

type Booking = {
  id: string;
  reference: string;
  state: string;
  startDate: string;
  template: string;
  travellers: { id: string; fullName: string }[];
  itinerary: { version: number; state: string };
  quote: { version: number; state: string; totalPaise: number };
  payment: {
    paidPaise: number;
    duePaise: number;
    items: { id: string; state: string; refundedPaise?: number }[];
  };
  fulfilment: {
    state: string;
    components: {
      id: string;
      slot: string;
      kind: string;
      state: string;
      capacity: number | null;
    }[];
  };
  confirmation: { open: boolean; waitingFor?: string[] };
  trip: { id: string; state: string } | null;
  changeRequests: {
    id: string;
    state: string;
    proposal: { quote: { totalPaise: number; state: string }; stops: unknown[] } | null;
  }[];
  cancellations: { id: string; state: string; refundPaise: number | null }[];
  refunds: { duePaise: number; items: { id: string; state: string; amountPaise: number }[] };
  history: { machine: string; from: string | null; to: string; reason: string | null }[];
};

describe.skipIf(!url)('change requests, cancellations and refunds (D-04 §4.4, §4.5)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let coordinator: Awaited<ReturnType<typeof signInAs>>;
  let manager: Awaited<ReturnType<typeof signInAs>>;
  let finance: Awaited<ReturnType<typeof signInAs>>;
  let finance2: Awaited<ReturnType<typeof signInAs>>;
  const http = () => request(ctx.app.getHttpServer());
  const post = async (
    who: { header: Record<string, string> },
    path: string,
    body: unknown = {},
    status = 200,
  ) =>
    (
      await http()
        .post(path)
        .set(who.header)
        .send(body as object)
        .expect(status)
    ).body as Booking;

  /** A booking with the vehicle confirmed (7 seats) and the full amount paid: CONFIRMED. */
  async function confirmedBooking(over: Record<string, unknown> = {}) {
    const b = (
      await http()
        .post('/v1/bookings/manual')
        .set(coordinator.header)
        .send(manualBooking(over))
        .expect(201)
    ).body as Booking;
    const v = b.fulfilment.components[0]!.id;
    await post(coordinator, `/v1/fulfilments/${v}/request`);
    await post(coordinator, `/v1/fulfilments/${v}/confirm`, {
      supplierReference: 'V-1',
      capacity: 7,
    });
    const paid = await post(
      coordinator,
      `/v1/bookings/${b.reference}/payments/offline`,
      { method: 'OFFLINE_UPI', amountPaise: TOTAL, reference: 'UPI-1', receivedOn: inDays(0) },
      201,
    );
    const done = await post(finance, `/v1/payments/${paid.payment.items[0]!.id}/confirm`);
    expect(done.state).toBe('CONFIRMED');
    return done;
  }

  const proposal = (over: Record<string, unknown> = {}) => ({
    itinerary: {
      stops: NINE.map((templeCode) => ({ templeCode, day: 1 })),
      timingsCheckedByCoordinator: true,
    },
    quote: {
      lines: [
        {
          kind: 'VEHICLE',
          description: 'Innova Crysta, 1 day',
          quantity: 1,
          unitPricePaise: 600000,
          taxPaise: 49500,
        },
      ],
      validUntil: new Date(Date.now() + 3 * 86400_000).toISOString(),
    },
    ...over,
  });
  const askChange = (b: Booking, kind = 'DATE') =>
    post(
      coordinator,
      `/v1/bookings/${b.reference}/change-request`,
      { kind, description: 'Customer asked to move the trip', requestedVia: 'PHONE' },
      201,
    );

  beforeAll(async () => {
    ctx = await createTestApp(url!);
    coordinator = await signInAs(ctx, ['OPS_COORDINATOR']);
    manager = await signInAs(ctx, ['OPS_MANAGER']);
    finance = await signInAs(ctx, ['FINANCE']);
    finance2 = await signInAs(ctx, ['FINANCE']);
  });
  afterAll(async () => ctx?.close());

  it('EC-20: a date change supersedes the old versions and re-opens supplier confirmation', async () => {
    const b = await confirmedBooking();
    const asked = await askChange(b);
    const cr = asked.changeRequests[0]!;
    expect(cr.state).toBe('REQUESTED');

    const proposed = await post(
      coordinator,
      `/v1/change-requests/${cr.id}/proposal`,
      proposal({ trip: { startDate: inDays(21) } }),
    );
    expect(proposed.changeRequests[0]).toMatchObject({
      state: 'REVIEWING',
      proposal: { quote: { state: 'PRESENTED', totalPaise: TOTAL } },
    });
    // Nothing changes on the booking until the customer accepts.
    expect(proposed).toMatchObject({
      state: 'CONFIRMED',
      startDate: b.startDate,
      itinerary: { version: 1 },
    });

    const applied = await post(coordinator, `/v1/change-requests/${cr.id}/approve`, {
      acceptedVia: 'WHATSAPP',
    });
    expect(applied).toMatchObject({
      startDate: inDays(21),
      itinerary: { version: 2, state: 'ACCEPTED' },
      quote: { version: 2, state: 'LOCKED', totalPaise: TOTAL },
      // Same price, but the supplier must confirm the new date: back to pending.
      state: 'PENDING_CONFIRMATION',
      confirmation: { open: false, waitingFor: ['FULFILMENT'] },
      fulfilment: { state: 'PENDING' },
      changeRequests: [{ state: 'APPLIED' }],
    });
    expect(applied.fulfilment.components.map((c) => [c.slot, c.state, c.capacity])).toEqual([
      ['vehicle', 'RELEASED', 7],
      ['vehicle', 'PENDING', 7],
    ]);
    const old = applied.history.filter(
      (h) => h.to === 'SUPERSEDED' || (h.machine === 'Quote' && h.to === 'EXPIRED'),
    );
    expect(old.map((h) => h.machine)).toEqual(['Itinerary', 'Quote']);
    const [t] = await ctx.db.select().from(schema.trip).where(eq(schema.trip.bookingId, b.id));
    expect(t?.startDate).toBe(inDays(21));

    // Re-confirming the vehicle confirms the booking again.
    const again = applied.fulfilment.components[1]!.id;
    await post(coordinator, `/v1/fulfilments/${again}/request`);
    const back = await post(coordinator, `/v1/fulfilments/${again}/confirm`, {
      supplierReference: 'V-2',
    });
    expect(back.state).toBe('CONFIRMED');
  });

  it('a higher price sends the booking back to pending until the difference is paid', async () => {
    const b = await confirmedBooking();
    const cr = (await askChange(b, 'PRICE')).changeRequests[0]!;
    await post(
      coordinator,
      `/v1/change-requests/${cr.id}/proposal`,
      proposal({
        quote: {
          lines: [
            {
              kind: 'VEHICLE',
              description: 'Tempo Traveller',
              quantity: 1,
              unitPricePaise: 800000,
              taxPaise: 0,
            },
          ],
          validUntil: new Date(Date.now() + 86400_000).toISOString(),
        },
      }),
    );
    const r = await post(coordinator, `/v1/change-requests/${cr.id}/approve`, {
      acceptedVia: 'PHONE',
    });
    expect(r).toMatchObject({
      state: 'PENDING_CONFIRMATION',
      confirmation: { waitingFor: ['PAYMENT'] },
      payment: { paidPaise: TOTAL, duePaise: 800000 - TOTAL },
    });
  });

  it('a lower price leaves an overpayment that is refunded by two people', async () => {
    const b = await confirmedBooking();
    const cr = (await askChange(b, 'ITINERARY')).changeRequests[0]!;
    await post(
      coordinator,
      `/v1/change-requests/${cr.id}/proposal`,
      proposal({
        itinerary: {
          stops: NINE.slice(0, 5).map((templeCode) => ({ templeCode, day: 1 })),
          timingsCheckedByCoordinator: true,
        },
        quote: {
          lines: [
            {
              kind: 'VEHICLE',
              description: 'Half circuit',
              quantity: 1,
              unitPricePaise: 400000,
              taxPaise: 0,
            },
          ],
          validUntil: new Date(Date.now() + 86400_000).toISOString(),
        },
      }),
    );
    const r = await post(coordinator, `/v1/change-requests/${cr.id}/approve`, {
      acceptedVia: 'PHONE',
    });
    expect(r).toMatchObject({ state: 'CONFIRMED', refunds: { duePaise: TOTAL - 400000 } });

    await post(
      finance,
      `/v1/bookings/${b.reference}/refunds`,
      { method: 'OFFLINE_UPI', amountPaise: TOTAL - 399999, reference: 'R-1', paidOn: inDays(0) },
      422,
    );
    const rec = await post(
      finance,
      `/v1/bookings/${b.reference}/refunds`,
      { method: 'OFFLINE_UPI', amountPaise: TOTAL - 400000, reference: 'R-1', paidOn: inDays(0) },
      201,
    );
    const refundId = rec.refunds.items[0]!.id;
    await post(finance, `/v1/refunds/${refundId}/confirm`, {}, 403);
    const done = await post(finance2, `/v1/refunds/${refundId}/confirm`);
    expect(done).toMatchObject({
      state: 'CONFIRMED',
      refunds: { duePaise: 0, items: [{ state: 'CONFIRMED' }] },
      payment: { paidPaise: 400000, duePaise: 0 },
    });
    expect(done.payment.items[0]!.state).toBe('PARTIALLY_REFUNDED');
    await post(
      finance,
      `/v1/bookings/${b.reference}/refunds`,
      { method: 'CASH', amountPaise: 1, reference: 'R-2', paidOn: inDays(0) },
      409,
    );
  });

  it('EC-28: more travellers than the confirmed vehicle seats means asking for a new vehicle', async () => {
    const b = await confirmedBooking();
    const cr = (await askChange(b, 'TRAVELLERS')).changeRequests[0]!;
    const extra = Array.from({ length: 5 }, (_, i) => ({
      fullName: `Cousin ${i + 1}`,
      ageBand: 'ADULT_18_59',
      relationshipToBooker: 'RELATIVE',
    }));
    await post(
      coordinator,
      `/v1/change-requests/${cr.id}/proposal`,
      proposal({
        travellers: [...b.travellers.map((t) => ({ travellerId: t.id })), ...extra],
        quote: {
          lines: [
            {
              kind: 'VEHICLE',
              description: 'Tempo Traveller',
              quantity: 1,
              unitPricePaise: TOTAL,
              taxPaise: 0,
            },
          ],
          validUntil: new Date(Date.now() + 86400_000).toISOString(),
        },
      }),
    );
    const r = await post(coordinator, `/v1/change-requests/${cr.id}/approve`, {
      acceptedVia: 'PHONE',
    });
    expect(r.travellers).toHaveLength(8);
    expect(r.fulfilment.components.map((c) => [c.state, c.capacity])).toEqual([
      ['RELEASED', 7],
      ['PENDING', null],
    ]);
    expect(r.state).toBe('PENDING_CONFIRMATION');
    const v = r.fulfilment.components[1]!.id;
    await post(coordinator, `/v1/fulfilments/${v}/request`);
    await post(
      coordinator,
      `/v1/fulfilments/${v}/confirm`,
      { supplierReference: 'TT-9', capacity: 7 },
      422,
    );
  });

  it('one day to two days adds a hotel night to confirm', async () => {
    const b = await confirmedBooking();
    const cr = (await askChange(b, 'ITINERARY')).changeRequests[0]!;
    await post(
      coordinator,
      `/v1/change-requests/${cr.id}/proposal`,
      proposal({
        trip: { template: '2D1N' },
        itinerary: {
          stops: NINE.map((templeCode, i) => ({ templeCode, day: i < 5 ? 1 : 2 })),
          timingsCheckedByCoordinator: true,
        },
      }),
    );
    const r = await post(coordinator, `/v1/change-requests/${cr.id}/approve`, {
      acceptedVia: 'PHONE',
    });
    expect(r.template).toBe('2D1N');
    expect(r.fulfilment.components.map((c) => [c.slot, c.state])).toEqual([
      ['vehicle', 'CONFIRMED'],
      ['hotel:night-1', 'PENDING'],
    ]);
  });

  it('one open change at a time; rejected and withdrawn proposals are discarded, not deleted', async () => {
    const b = await confirmedBooking();
    const cr = (await askChange(b)).changeRequests[0]!;
    await http()
      .post(`/v1/bookings/${b.reference}/change-request`)
      .set(coordinator.header)
      .send({ kind: 'DATE', description: 'x', requestedVia: 'PHONE' })
      .expect(409);

    await post(coordinator, `/v1/change-requests/${cr.id}/proposal`, proposal());
    // Re-proposing replaces the earlier proposal.
    const second = await post(
      coordinator,
      `/v1/change-requests/${cr.id}/proposal`,
      proposal({ trip: { startDate: inDays(30) } }),
    );
    await post(coordinator, `/v1/change-requests/${cr.id}/reject`, {}, 400);
    const rejected = await post(coordinator, `/v1/change-requests/${cr.id}/reject`, {
      reason: 'Vehicle not available that week',
    });
    expect(rejected.changeRequests[0]).toMatchObject({ state: 'REJECTED', proposal: null });
    expect(rejected).toMatchObject({
      state: 'CONFIRMED',
      itinerary: { version: 1 },
      quote: { version: 1 },
    });
    const discarded = rejected.history.filter(
      (h) => h.to === 'ABANDONED' || (h.machine === 'Quote' && h.to === 'CANCELLED'),
    );
    expect(discarded).toHaveLength(4); // two proposals × (itinerary + quote)
    expect(second.changeRequests[0]!.state).toBe('REVIEWING');

    const next = (await askChange(b)).changeRequests[0]!;
    const w = await post(coordinator, `/v1/change-requests/${next.id}/withdraw`);
    expect(w.changeRequests[0]!.state).toBe('WITHDRAWN');
    await post(finance, `/v1/change-requests/${next.id}/withdraw`, {}, 403);
  });

  it('cancels a paid booking: refund proposed, manager approves, two people refund', async () => {
    const b = await confirmedBooking();
    const open = (await askChange(b)).changeRequests[0]!;
    const asked = await post(
      coordinator,
      `/v1/bookings/${b.reference}/cancel-request`,
      { reason: 'Family emergency', requestedVia: 'PHONE' },
      201,
    );
    const c = asked.cancellations[0]!;
    await post(
      coordinator,
      `/v1/bookings/${b.reference}/cancel-request`,
      { reason: 'again', requestedVia: 'PHONE' },
      409,
    );

    await post(manager, `/v1/cancellations/${c.id}/approve`, {}, 409); // not reviewed yet
    await post(
      coordinator,
      `/v1/cancellations/${c.id}/review`,
      { refundPaise: TOTAL + 1, refundNote: 'x' },
      422,
    );
    await post(coordinator, `/v1/cancellations/${c.id}/review`, {
      refundPaise: 400000,
      refundNote: 'Vehicle advance kept',
    });
    await post(coordinator, `/v1/cancellations/${c.id}/approve`, {}, 403);
    const cancelled = await post(manager, `/v1/cancellations/${c.id}/approve`);
    expect(cancelled).toMatchObject({
      state: 'CANCELLED',
      trip: { state: 'CANCELLED' },
      fulfilment: { state: 'RELEASED', components: [{ state: 'RELEASED' }] },
      itinerary: { state: 'ABANDONED' },
      cancellations: [{ state: 'REFUND_PENDING', refundPaise: 400000 }],
      changeRequests: [{ id: open.id, state: 'WITHDRAWN' }],
      refunds: { duePaise: 400000 },
    });

    const rec = await post(
      finance,
      `/v1/bookings/${b.reference}/refunds`,
      {
        method: 'OFFLINE_BANK_TRANSFER',
        amountPaise: 400000,
        reference: 'NEFT-77',
        paidOn: inDays(0),
      },
      201,
    );
    const done = await post(manager, `/v1/refunds/${rec.refunds.items[0]!.id}/confirm`);
    expect(done).toMatchObject({
      cancellations: [{ state: 'REFUNDED' }],
      refunds: { duePaise: 0 },
    });
    expect(done.payment.items[0]).toMatchObject({ state: 'PARTIALLY_REFUNDED' });
    await post(
      coordinator,
      `/v1/bookings/${b.reference}/change-request`,
      { kind: 'DATE', description: 'x', requestedVia: 'PHONE' },
      409,
    );
  });

  it('cancels an unpaid booking with no refund; blocks while a payment awaits confirmation', async () => {
    const b = (
      await http()
        .post('/v1/bookings/manual')
        .set(coordinator.header)
        .send(manualBooking())
        .expect(201)
    ).body as Booking;
    await post(
      coordinator,
      `/v1/bookings/${b.reference}/payments/offline`,
      { method: 'CASH', amountPaise: 1000, reference: 'C-1', receivedOn: inDays(0) },
      201,
    );
    const c = (
      await post(
        coordinator,
        `/v1/bookings/${b.reference}/cancel-request`,
        { reason: 'Changed plans', requestedVia: 'WHATSAPP' },
        201,
      )
    ).cancellations[0]!;
    await post(coordinator, `/v1/cancellations/${c.id}/review`, {
      refundPaise: 0,
      refundNote: 'Nothing received yet',
    });
    await post(manager, `/v1/cancellations/${c.id}/approve`, {}, 409);

    const pending = (
      await http().get(`/v1/bookings/${b.reference}`).set(manager.header).expect(200)
    ).body as Booking;
    await post(finance, `/v1/payments/${pending.payment.items[0]!.id}/reject`, {
      reason: 'Never received',
    });
    const r = await post(manager, `/v1/cancellations/${c.id}/approve`);
    expect(r).toMatchObject({
      state: 'CANCELLED',
      cancellations: [{ state: 'CLOSED_NO_REFUND' }],
      fulfilment: { components: [{ state: 'CANCELLED' }] },
    });
  });

  it('a manager can reject a cancellation request', async () => {
    const b = await confirmedBooking();
    const c = (
      await post(
        coordinator,
        `/v1/bookings/${b.reference}/cancel-request`,
        { reason: 'Maybe', requestedVia: 'PHONE' },
        201,
      )
    ).cancellations[0]!;
    const r = await post(manager, `/v1/cancellations/${c.id}/reject`, {
      reason: 'Customer called back to keep the trip',
    });
    expect(r).toMatchObject({ state: 'CONFIRMED', cancellations: [{ state: 'REJECTED' }] });
  });
});

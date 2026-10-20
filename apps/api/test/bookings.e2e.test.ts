import { schema } from '@navagraha/db';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signInAs } from './app.js';

const url = process.env.TEST_DATABASE_URL;
const NINE = [
  'TEM-SUR',
  'TEM-CHA',
  'TEM-ANG',
  'TEM-BUD',
  'TEM-GUR',
  'TEM-SHU',
  'TEM-SHA',
  'TEM-RAH',
  'TEM-KET',
];

function inDays(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

let bookerSeq = 0;
function manualBooking(overrides: Record<string, unknown> = {}) {
  bookerSeq++;
  return {
    booker: { phone: `98400${String(bookerSeq).padStart(5, '0')}`, name: 'Priya' },
    travellers: [
      { fullName: 'Priya', ageBand: 'ADULT_18_59', relationshipToBooker: 'SELF' },
      { fullName: 'Kamala', ageBand: 'SENIOR_60_74', relationshipToBooker: 'PARENT', isLead: true },
      {
        fullName: 'Raghavan',
        ageBand: 'SENIOR_75_PLUS',
        relationshipToBooker: 'PARENT',
        needsWheelchair: true,
      },
    ],
    trip: {
      startDate: inDays(14),
      template: '1D',
      mode: 'BALANCED',
      pickupLocation: 'Kumbakonam railway station',
      pickupTime: '05:30',
    },
    source: { channel: 'PHONE', reference: 'Call from Priya' },
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
          unitPricePaise: 450000,
          taxPaise: 22500,
        },
        {
          kind: 'SERVICE_FEE',
          description: 'Coordination',
          quantity: 1,
          unitPricePaise: 150000,
          taxPaise: 27000,
        },
      ],
      validUntil: new Date(Date.now() + 7 * 86400_000).toISOString(),
      acceptedVia: 'PHONE',
    },
    ...overrides,
  };
}

describe.skipIf(!url)('concierge bookings (FS §12.1, D-19, D-20)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let coordinator: Awaited<ReturnType<typeof signInAs>>;
  let manager: Awaited<ReturnType<typeof signInAs>>;
  let finance: Awaited<ReturnType<typeof signInAs>>;
  let customer: Awaited<ReturnType<typeof signInAs>>;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp(url!);
    coordinator = await signInAs(ctx, ['OPS_COORDINATOR']);
    manager = await signInAs(ctx, ['OPS_MANAGER']);
    finance = await signInAs(ctx, ['FINANCE']);
    customer = await signInAs(ctx, ['CUSTOMER']);
  });
  afterAll(async () => ctx?.close());

  const create = (body = manualBooking(), who = coordinator) =>
    http().post('/v1/bookings/manual').set(who.header).send(body);

  it('creates a booking with itinerary, locked quote and supplier items', async () => {
    const r = await create().expect(201);
    const b = r.body;
    expect(b.reference).toMatch(/^NAV-\d{6}$/);
    expect(b).toMatchObject({
      state: 'PENDING_CONFIRMATION',
      seniorFriendly: true,
      source: { channel: 'PHONE' },
      booker: { name: 'Priya', phone: expect.stringMatching(/^\+9198400/) },
      itinerary: {
        version: 1,
        state: 'ACCEPTED',
        origin: 'MANUAL',
        validation: {
          level: 'STRUCTURAL_WITH_OPS_SIGN_OFF',
          engineChecked: false,
          signedOffBy: coordinator.userId,
        },
      },
      quote: {
        version: 1,
        state: 'LOCKED',
        subtotalPaise: 600000,
        taxPaise: 49500,
        totalPaise: 649500,
        acceptedVia: 'PHONE',
      },
      payment: { totalPaise: 649500, paidPaise: 0, duePaise: 649500 },
      fulfilment: {
        state: 'PENDING',
        components: [{ slot: 'vehicle', kind: 'VEHICLE', mandatory: true, state: 'PENDING' }],
      },
      confirmation: { open: false, waitingFor: ['PAYMENT', 'FULFILMENT'] },
      trip: null,
    });
    expect(b.travellers).toHaveLength(3);
    expect(b.travellers.find((t: { fullName: string }) => t.fullName === 'Kamala').isLead).toBe(
      true,
    );
    expect(b.itinerary.stops.map((s: { templeCode: string }) => s.templeCode)).toEqual(NINE);

    // D-04: every step is in the history, made by the right kind of actor.
    const steps = b.history.map(
      (h: { machine: string; from: string | null; to: string; actorRole: string }) =>
        `${h.machine}:${h.from ?? '∅'}→${h.to}:${h.actorRole}`,
    );
    expect(steps).toEqual([
      'Itinerary:∅→DRAFT:OPS_COORDINATOR',
      'Itinerary:DRAFT→VALIDATED:SYSTEM',
      'Itinerary:VALIDATED→PROPOSED:OPS_COORDINATOR',
      'Itinerary:PROPOSED→ACCEPTED:OPS_COORDINATOR',
      'Quote:∅→DRAFT:OPS_COORDINATOR',
      'Quote:DRAFT→CALCULATED:SYSTEM',
      'Quote:CALCULATED→PRESENTED:OPS_COORDINATOR',
      'Quote:PRESENTED→LOCKED:OPS_COORDINATOR',
      'Booking:∅→REQUESTED:OPS_COORDINATOR',
      'Booking:REQUESTED→PENDING_CONFIRMATION:SYSTEM',
      'FulfilmentComponent:∅→PENDING:OPS_COORDINATOR',
    ]);
  });

  it('only operations can create bookings', async () => {
    await http().post('/v1/bookings/manual').send(manualBooking()).expect(401);
    await create(manualBooking(), customer).expect(403);
    await create(manualBooking(), finance).expect(403);
    await create(manualBooking(), manager).expect(201);
  });

  it('D-20: the coordinator must sign off and the structure must be sound', async () => {
    const noSignOff = manualBooking();
    (noSignOff.itinerary as Record<string, unknown>).timingsCheckedByCoordinator = false;
    const r1 = await create(noSignOff).expect(400);
    expect(JSON.stringify(r1.body.message)).toMatch(/D-20/);

    const bad = manualBooking({
      itinerary: {
        stops: [
          { templeCode: 'TEM-SUR', day: 1 },
          { templeCode: 'tem-sur', day: 1 },
          { templeCode: 'TEM-XXX', day: 1 },
        ],
        timingsCheckedByCoordinator: true,
      },
      fulfilment: [{ slot: 'vehicle', kind: 'VEHICLE', mandatory: true, capacity: 2 }],
    });
    const r2 = await create(bad).expect(422);
    expect(r2.body).toMatchObject({
      message: 'The itinerary has problems',
      errors: [
        { code: 'VEHICLE_TOO_SMALL' },
        { code: 'DUPLICATE_TEMPLE', stop: 2 },
        { code: 'NOT_IN_CIRCUIT', stop: 3 },
      ],
    });

    const past = manualBooking();
    (past.trip as Record<string, unknown>).startDate = inDays(-1);
    await create(past).expect(422);
  });

  it('rejects bad money and expired quotes before writing anything', async () => {
    const before = await ctx.db.select().from(schema.booking);
    const frac = manualBooking();
    (frac.quote.lines[0] as Record<string, unknown>).unitPricePaise = 10.5;
    await create(frac).expect(400);
    const expired = manualBooking();
    expired.quote.validUntil = new Date(Date.now() - 1000).toISOString();
    await create(expired).expect(400);
    expect(await ctx.db.select().from(schema.booking)).toHaveLength(before.length);
  });

  it('confirms when payment and supplier items are both done — in either order', async () => {
    const b = (await create().expect(201)).body;
    const vehicle = b.fulfilment.components[0].id;

    // Supplier first.
    await http()
      .post(`/v1/fulfilments/${vehicle}/request`)
      .set(coordinator.header)
      .send({ supplierName: 'Sri Travels' })
      .expect(200);
    await http()
      .post(`/v1/fulfilments/${vehicle}/confirm`)
      .set(coordinator.header)
      .send({ supplierReference: 'ST-881' })
      .expect(400);
    const afterVehicle = await http()
      .post(`/v1/fulfilments/${vehicle}/confirm`)
      .set(coordinator.header)
      .send({ supplierReference: 'ST-881', capacity: 7 })
      .expect(200);
    expect(afterVehicle.body).toMatchObject({
      state: 'PENDING_CONFIRMATION',
      fulfilment: { state: 'ALL_REQUIRED_CONFIRMED' },
      confirmation: { open: false, waitingFor: ['PAYMENT'] },
    });

    // Payment: recorded by the coordinator, confirmed by finance (D-19).
    const recorded = await http()
      .post(`/v1/bookings/${b.reference}/payments/offline`)
      .set(coordinator.header)
      .send({
        method: 'OFFLINE_UPI',
        amountPaise: 649500,
        reference: 'UPI-4182930',
        receivedOn: inDays(0),
      })
      .expect(201);
    expect(recorded.body.payment.items[0]).toMatchObject({
      state: 'PENDING',
      recordedBy: coordinator.userId,
    });
    expect(recorded.body.state).toBe('PENDING_CONFIRMATION');
    const paymentId = recorded.body.payment.items[0].id;

    await http().post(`/v1/payments/${paymentId}/confirm`).set(coordinator.header).expect(403);
    const confirmed = await http()
      .post(`/v1/payments/${paymentId}/confirm`)
      .set(finance.header)
      .expect(200);
    expect(confirmed.body).toMatchObject({
      state: 'CONFIRMED',
      payment: {
        paidPaise: 649500,
        duePaise: 0,
        items: [{ state: 'SUCCESS', confirmedBy: finance.userId }],
      },
      confirmation: { open: true },
      trip: { state: 'SCHEDULED' },
    });
    const tail = confirmed.body.history
      .slice(-3)
      .map((h: { machine: string; to: string; actorRole: string; actorUserId: string }) => [
        h.machine,
        h.to,
        h.actorRole,
        h.actorUserId,
      ]);
    expect(tail).toEqual([
      ['Payment', 'SUCCESS', 'SYSTEM', finance.userId],
      ['Booking', 'CONFIRMED', 'SYSTEM', finance.userId],
      ['Trip', 'SCHEDULED', 'SYSTEM', finance.userId],
    ]);
    // A second confirm is a conflict, not a second payment.
    await http().post(`/v1/payments/${paymentId}/confirm`).set(finance.header).expect(409);
  });

  it('D-19: the person who recorded a payment cannot confirm it', async () => {
    const b = (await create().expect(201)).body;
    const r = await http()
      .post(`/v1/bookings/${b.reference}/payments/offline`)
      .set(finance.header)
      .send({ method: 'CASH', amountPaise: 100000, reference: 'RCPT-0042', receivedOn: inDays(0) })
      .expect(201);
    const id = r.body.payment.items[0].id;
    const denied = await http().post(`/v1/payments/${id}/confirm`).set(finance.header).expect(403);
    expect(denied.body.message).toMatch(/different person/);
    const blocked = await ctx.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'security.two_person_rule_blocked'));
    expect(blocked.some((a) => a.entityId === id)).toBe(true);
    await http().post(`/v1/payments/${id}/confirm`).set(manager.header).expect(200);
  });

  it('never accepts more than the balance due, counting receipts awaiting confirmation', async () => {
    const b = (await create().expect(201)).body;
    const pay = (amountPaise: number) =>
      http()
        .post(`/v1/bookings/${b.reference}/payments/offline`)
        .set(coordinator.header)
        .send({
          method: 'OFFLINE_BANK_TRANSFER',
          amountPaise,
          reference: 'NEFT-1',
          receivedOn: inDays(0),
        });
    await pay(649501).expect(422);
    await pay(400000).expect(201);
    await pay(249501).expect(422);
    await pay(249500).expect(201);
    const future = await http()
      .post(`/v1/bookings/${b.reference}/payments/offline`)
      .set(coordinator.header)
      .send({ method: 'CASH', amountPaise: 1, reference: 'X-1', receivedOn: inDays(1) });
    expect(future.status).toBe(400);
  });

  it('a rejected receipt fails and can be recorded again', async () => {
    const b = (await create().expect(201)).body;
    const rec = async () =>
      (
        await http()
          .post(`/v1/bookings/${b.reference}/payments/offline`)
          .set(coordinator.header)
          .send({
            method: 'OFFLINE_UPI',
            amountPaise: 649500,
            reference: 'UPI-WRONG',
            receivedOn: inDays(0),
          })
          .expect(201)
      ).body.payment.items.at(-1).id;
    const first = await rec();
    await http().post(`/v1/payments/${first}/reject`).set(finance.header).send({}).expect(400);
    const r = await http()
      .post(`/v1/payments/${first}/reject`)
      .set(finance.header)
      .send({ reason: 'Not in bank statement' })
      .expect(200);
    expect(r.body.payment.items[0]).toMatchObject({
      state: 'FAILED',
      reason: 'Not in bank statement',
    });
    await rec();
  });

  it('EC-08: a declined hotel is replaced in the same slot', async () => {
    const twoDay = manualBooking();
    twoDay.trip = { ...twoDay.trip, template: '2D1N' };
    twoDay.itinerary.stops = NINE.map((templeCode, i) => ({ templeCode, day: i < 5 ? 1 : 2 }));
    const b = (await create(twoDay).expect(201)).body;
    expect(b.fulfilment.components.map((c: { slot: string }) => c.slot)).toEqual([
      'vehicle',
      'hotel:night-1',
    ]);
    const hotel = b.fulfilment.components[1].id;

    await http()
      .post(`/v1/fulfilments/${hotel}/request`)
      .set(coordinator.header)
      .send({ supplierName: 'Hotel A' })
      .expect(200);
    await http()
      .post(`/v1/bookings/${b.reference}/fulfilments`)
      .set(coordinator.header)
      .send({ slot: 'hotel:night-1', kind: 'HOTEL', mandatory: true })
      .expect(409);
    await http()
      .post(`/v1/fulfilments/${hotel}/decline`)
      .set(coordinator.header)
      .send({ reason: 'Fully booked' })
      .expect(200);
    const added = await http()
      .post(`/v1/bookings/${b.reference}/fulfilments`)
      .set(coordinator.header)
      .send({ slot: 'hotel:night-1', kind: 'HOTEL', mandatory: true, supplierName: 'Hotel B' })
      .expect(201);
    const replacement = added.body.fulfilment.components.at(-1).id;
    await http()
      .post(`/v1/fulfilments/${replacement}/request`)
      .set(coordinator.header)
      .send({})
      .expect(200);
    const r = await http()
      .post(`/v1/fulfilments/${replacement}/confirm`)
      .set(coordinator.header)
      .send({ supplierReference: 'HB-77' })
      .expect(200);
    expect(r.body.fulfilment.state).toBe('PARTIAL');
    // A confirmed component cannot be declined; it must be released instead.
    await http()
      .post(`/v1/fulfilments/${replacement}/decline`)
      .set(coordinator.header)
      .send({ reason: 'x' })
      .expect(409);
  });

  it('an operations manager can waive the balance; others cannot', async () => {
    const b = (await create().expect(201)).body;
    await http()
      .post(`/v1/bookings/${b.reference}/payments/waive`)
      .set(coordinator.header)
      .send({ reason: 'Pilot' })
      .expect(403);
    const r = await http()
      .post(`/v1/bookings/${b.reference}/payments/waive`)
      .set(manager.header)
      .send({ reason: 'Complimentary pilot trip' })
      .expect(201);
    expect(r.body).toMatchObject({
      payment: {
        paidPaise: 649500,
        duePaise: 0,
        items: [{ state: 'NOT_REQUIRED', method: 'WAIVER' }],
      },
      confirmation: { open: false, waitingFor: ['FULFILMENT'] },
    });
    await http()
      .post(`/v1/bookings/${b.reference}/payments/waive`)
      .set(manager.header)
      .send({ reason: 'again' })
      .expect(409);
  });

  it('reuses an existing traveller profile, but only the booker’s own', async () => {
    const first = (await create().expect(201)).body;
    const kamala = first.travellers.find((t: { fullName: string }) => t.fullName === 'Kamala').id;
    const again = manualBooking({ travellers: [{ travellerId: kamala, isLead: true }] });
    (again.booker as Record<string, unknown>).phone = first.booker.phone;
    const r = await create(again).expect(201);
    expect(r.body.booker.id).toBe(first.booker.id);
    expect(r.body.travellers).toEqual([expect.objectContaining({ id: kamala, isLead: true })]);

    const stranger = manualBooking({ travellers: [{ travellerId: kamala }] });
    await create(stranger).expect(400);
  });

  it('lists bookings for a date range and shows detail by reference', async () => {
    const b = (
      await create(
        manualBooking({ trip: { startDate: inDays(30), template: '1D', mode: 'FAST' } }),
      ).expect(201)
    ).body;
    const list = await http()
      .get(`/v1/bookings?from=${inDays(30)}&to=${inDays(30)}`)
      .set(finance.header)
      .expect(200);
    expect(list.body.bookings.map((x: { reference: string }) => x.reference)).toContain(
      b.reference,
    );
    expect(list.body.bookings[0]).toMatchObject({ totalPaise: 649500, travellers: 3 });
    await http().get(`/v1/bookings/${b.reference}`).set(coordinator.header).expect(200);
    await http().get(`/v1/bookings/${b.reference}`).set(customer.header).expect(403);
    await http().get('/v1/bookings/NAV-999999').set(coordinator.header).expect(404);
    await http().get('/v1/bookings/drop-table').set(coordinator.header).expect(400);
  });

  it('the database itself refuses a payment confirmed by the person who recorded it', async () => {
    const b = (await create().expect(201)).body;
    const [p] = await ctx.db
      .insert(schema.payment)
      .values({
        bookingId: b.id,
        state: 'PENDING',
        method: 'CASH',
        amountPaise: 1,
        recordedByUserId: finance.userId,
      })
      .returning();
    await expect(
      ctx.db
        .update(schema.payment)
        .set({ confirmedByUserId: finance.userId })
        .where(eq(schema.payment.id, p!.id)),
    ).rejects.toThrow();
  });
});

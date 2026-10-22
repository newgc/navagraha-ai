import { schema } from '@navagraha/db';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WhatsAppMessenger } from '../src/messaging/whatsapp.js';
import type { CreateLinkInput, GatewayLink, PaymentGateway } from '../src/payments/gateway.js';
import { createTestApp, signInAs } from './app.js';
import { NINE, inDays, manualBooking } from './fixtures.js';

const url = process.env.TEST_DATABASE_URL;

const tripRequest = (overrides: Record<string, unknown> = {}) => ({
  startDate: inDays(20),
  days: 'RECOMMEND',
  pickup: { location: 'Chennai, Anna Nagar', time: '05:00' },
  travellers: [
    { fullName: 'Meena', ageBand: 'ADULT_18_59', relationshipToBooker: 'SELF' },
    {
      fullName: 'Lakshmi',
      ageBand: 'SENIOR_75_PLUS',
      relationshipToBooker: 'PARENT',
      needsWheelchair: true,
    },
  ],
  purpose: 'ALL_NINE',
  hotelRequired: true,
  notes: 'Mother walks slowly',
  contact: { name: 'Meena', email: 'meena@example.com' },
  ...overrides,
});

/** The plan operations send back: the manual-booking body without booker, source, acceptance. */
function proposal(totalLines = manualBooking().quote.lines) {
  const m = manualBooking();
  return {
    trip: { ...m.trip, startDate: inDays(20), template: '2D1N', mode: 'RELAXED' },
    travellers: tripRequest().travellers,
    itinerary: {
      stops: NINE.map((templeCode, i) => ({ templeCode, day: i < 5 ? 1 : 2 })),
      timingsCheckedByCoordinator: true,
    },
    quote: { lines: totalLines, validUntil: new Date(Date.now() + 3 * 86400_000).toISOString() },
  };
}

class LinkOnlyGateway implements PaymentGateway {
  readonly provider = 'cashfree' as const;
  readonly label = 'Cashfree';
  readonly links: CreateLinkInput[] = [];
  async createLink(input: CreateLinkInput): Promise<GatewayLink> {
    this.links.push(input);
    return {
      linkId: input.linkId,
      url: `https://payments-test.cashfree.com/links/${input.linkId}`,
      status: 'ACTIVE',
      amountPaidPaise: 0,
      raw: {},
    };
  }
  getLink = async (): Promise<GatewayLink> => {
    throw new Error('unused');
  };
  successfulPayments = async () => [];
  cancelLink = async (): Promise<GatewayLink> => {
    throw new Error('unused');
  };
  createRefund = async () => {
    throw new Error('unused');
  };
  getRefund = async () => {
    throw new Error('unused');
  };
  verifyWebhook = () => false;
  webhookEvent = () => ({ eventKey: null, eventType: null, linkId: null, refundId: null });
}

describe.skipIf(!url)('self-service trip requests (request → proposal → accept → pay)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let coordinator: Awaited<ReturnType<typeof signInAs>>;
  let customer: Awaited<ReturnType<typeof signInAs>>;
  let stranger: Awaited<ReturnType<typeof signInAs>>;
  const gateway = new LinkOnlyGateway();
  const sent: { phone: string; text: string }[] = [];
  const whatsapp: WhatsAppMessenger = {
    sendText: async (phone, text) => void sent.push({ phone, text }),
  };
  const http = () => request(ctx.app.getHttpServer());
  const as = (who: { header: Record<string, string> }) => ({
    get: (path: string) => http().get(path).set(who.header),
    post: (path: string, body: object = {}) => http().post(path).set(who.header).send(body),
  });

  beforeAll(async () => {
    ctx = await createTestApp(
      url!,
      {
        PAYMENT_GATEWAY: 'cashfree',
        CASHFREE_CLIENT_ID: 'id',
        CASHFREE_CLIENT_SECRET: 's',
        PUBLIC_WEB_URL: 'https://navagrahayathra.in',
      },
      { gateway, whatsapp },
    );
    coordinator = await signInAs(ctx, ['OPS_COORDINATOR']);
    customer = await signInAs(ctx, ['CUSTOMER']);
    stranger = await signInAs(ctx, ['CUSTOMER']);
  });
  afterAll(async () => ctx?.close());

  it('runs from a website request to a booking paid through the gateway', async () => {
    // 1. The customer sends a request (signed in with their phone).
    await http().post('/v1/trip-requests').send(tripRequest()).expect(401);
    await as(customer)
      .post('/v1/trip-requests', tripRequest({ startDate: inDays(0) }))
      .expect(400);
    const sentReq = await as(customer).post('/v1/trip-requests', tripRequest()).expect(201);
    const ref = sentReq.body.reference;
    expect(ref).toMatch(/^REQ-\d{6}$/);
    expect(sent.at(-1)!.text).toContain(ref);

    const mine = await as(customer).get('/v1/my/trips').expect(200);
    expect(mine.body.requests[0]).toMatchObject({
      reference: ref,
      status: 'RECEIVED',
      proposal: null,
    });

    // 2. Operations see it and send a plan; customers cannot.
    await as(customer).get('/v1/trip-requests').expect(403);
    const list = await as(coordinator).get('/v1/trip-requests?state=NEW').expect(200);
    expect(list.body.find((r: { reference: string }) => r.reference === ref)).toMatchObject({
      state: 'NEW',
      travellers: 2,
      days: 'RECOMMEND',
    });
    await as(customer).post(`/v1/trip-requests/${ref}/proposals`, proposal()).expect(403);
    const noSignOff = proposal();
    (noSignOff.itinerary as { timingsCheckedByCoordinator: boolean }).timingsCheckedByCoordinator =
      false;
    await as(coordinator).post(`/v1/trip-requests/${ref}/proposals`, noSignOff).expect(400);

    const v1 = await as(coordinator)
      .post(`/v1/trip-requests/${ref}/proposals`, proposal())
      .expect(201);
    expect(v1.body).toMatchObject({
      state: 'QUOTED',
      proposals: [{ version: 1, totalPaise: 649500 }],
    });
    expect(sent.at(-1)!.text).toContain(`https://navagrahayathra.in/trips/${ref}`);
    expect(
      v1.body.history.map((h: { to: string; actorRole: string }) => `${h.to}:${h.actorRole}`),
    ).toEqual(['NEW:SYSTEM', 'PLANNING:OPS_COORDINATOR', 'QUOTED:SYSTEM']);

    // A revision replaces it; only the newest can be accepted.
    const cheaper = proposal([
      {
        kind: 'VEHICLE',
        description: 'Innova, 2 days',
        quantity: 1,
        unitPricePaise: 800000,
        taxPaise: 40000,
      },
    ]);
    await as(coordinator).post(`/v1/trip-requests/${ref}/proposals`, cheaper).expect(201);

    // 3. The customer sees the plan (only their own) and accepts it.
    await as(stranger).get(`/v1/my/trip-requests/${ref}`).expect(404);
    const view = await as(customer).get(`/v1/my/trip-requests/${ref}`).expect(200);
    expect(view.body).toMatchObject({
      status: 'PLAN_READY',
      proposal: {
        version: 2,
        totalPaise: 840000,
        expired: false,
        trip: { template: '2D1N' },
      },
    });
    expect(view.body.proposal.stops).toHaveLength(9);
    expect(view.body.proposal.stops[0].temple).not.toMatch(/^TEM-/);

    await as(stranger).post(`/v1/my/trip-requests/${ref}/accept`, { version: 2 }).expect(404);
    await as(customer).post(`/v1/my/trip-requests/${ref}/accept`, { version: 1 }).expect(409);
    const accepted = await as(customer)
      .post(`/v1/my/trip-requests/${ref}/accept`, { version: 2 })
      .expect(200);
    const bookingRef = accepted.body.bookingReference;
    expect(bookingRef).toMatch(/^NAV-\d{6}$/);
    await as(customer).post(`/v1/my/trip-requests/${ref}/accept`, { version: 2 }).expect(409);

    // The booking: prepared by the coordinator, accepted by the customer on the web (D-04).
    const ops = await as(coordinator).get(`/v1/bookings/${bookingRef}`).expect(200);
    expect(ops.body).toMatchObject({
      state: 'PENDING_CONFIRMATION',
      source: { channel: 'WEB', reference: ref },
      quote: { totalPaise: 840000, acceptedVia: 'WEB', state: 'LOCKED' },
      itinerary: {
        state: 'ACCEPTED',
        validation: { level: 'STRUCTURAL_WITH_OPS_SIGN_OFF', signedOffBy: coordinator.userId },
      },
      fulfilment: { components: [{ kind: 'VEHICLE' }, { kind: 'HOTEL' }] },
    });
    const steps = ops.body.history.map(
      (h: { machine: string; to: string; actorRole: string }) =>
        `${h.machine}:${h.to}:${h.actorRole}`,
    );
    expect(steps).toEqual(
      expect.arrayContaining([
        'Itinerary:PROPOSED:OPS_COORDINATOR',
        'Itinerary:ACCEPTED:CUSTOMER',
        'Quote:LOCKED:CUSTOMER',
        'Booking:REQUESTED:CUSTOMER',
      ]),
    );
    const [l] = await ctx.db.select().from(schema.lead).where(eq(schema.lead.reference, ref));
    expect(l!.state).toBe('CONVERTED');

    // 4. The customer's view and "Pay now".
    const mineAfter = await as(customer).get('/v1/my/trips').expect(200);
    expect(mineAfter.body.requests).toHaveLength(0);
    expect(mineAfter.body.bookings[0]).toMatchObject({ reference: bookingRef });
    await as(stranger).get(`/v1/my/bookings/${bookingRef}`).expect(404);
    const b = await as(customer).get(`/v1/my/bookings/${bookingRef}`).expect(200);
    expect(b.body).toMatchObject({
      payment: { duePaise: 840000, payable: true, openLink: null },
      arrangements: { confirmed: 0, total: 2 },
    });
    expect(JSON.stringify(b.body)).not.toContain('supplierReference');

    const pay = await as(customer).post(`/v1/my/bookings/${bookingRef}/pay`).expect(200);
    expect(pay.body.url).toContain('cashfree.com/links/nav_');
    expect(gateway.links.at(-1)!.amountPaise).toBe(840000);
    const messagesBefore = sent.length;
    // Paying again reuses the open link instead of creating another.
    const again = await as(customer).post(`/v1/my/bookings/${bookingRef}/pay`).expect(200);
    expect(again.body.url).toBe(pay.body.url);
    expect(gateway.links).toHaveLength(1);
    expect(sent.length).toBe(messagesBefore);
  });

  it('expired plans cannot be accepted, and operations can close a request', async () => {
    const ref = (await as(customer).post('/v1/trip-requests', tripRequest()).expect(201)).body
      .reference;
    await as(coordinator).post(`/v1/trip-requests/${ref}/planning`).expect(200);
    await as(coordinator).post(`/v1/trip-requests/${ref}/proposals`, proposal()).expect(201);
    await ctx.db
      .update(schema.leadProposal)
      .set({ validUntil: new Date(Date.now() - 1000) })
      .where(eq(schema.leadProposal.version, 1));
    await as(customer).post(`/v1/my/trip-requests/${ref}/accept`, { version: 1 }).expect(410);

    const lost = await as(coordinator)
      .post(`/v1/trip-requests/${ref}/lost`, { reason: 'Customer chose another date' })
      .expect(200);
    expect(lost.body).toMatchObject({ state: 'LOST', lostReason: 'Customer chose another date' });
    const view = await as(customer).get(`/v1/my/trip-requests/${ref}`).expect(200);
    expect(view.body).toMatchObject({ status: 'CLOSED', proposal: null });
  });
});

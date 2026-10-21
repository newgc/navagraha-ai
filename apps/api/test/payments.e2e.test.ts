import { createHmac } from 'node:crypto';
import { schema } from '@navagraha/db';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WhatsAppMessenger } from '../src/messaging/whatsapp.js';
import {
  CashfreeGateway,
  GATEWAY_WEBHOOK_TYPE,
  GatewayError,
  type CreateLinkInput,
  type CreateRefundInput,
  type GatewayRefund,
  type GatewayCapture,
  type GatewayLink,
  type PaymentGateway,
} from '../src/payments/gateway.js';
import { createTestApp, signInAs } from './app.js';
import { manualBooking } from './fixtures.js';

const url = process.env.TEST_DATABASE_URL;
const SECRET = 'cashfree-test-secret';

/** Stands in for Cashfree: links and captures live in memory; signatures are the real scheme. */
class FakeGateway implements PaymentGateway {
  readonly provider = 'cashfree' as const;
  readonly links = new Map<string, GatewayLink & { input: CreateLinkInput }>();
  readonly captures = new Map<string, GatewayCapture[]>();
  readonly refunds = new Map<string, GatewayRefund & { input: CreateRefundInput }>();
  failNextCreate = false;
  /** What the gateway answers when a refund is sent; changed by tests. */
  refundStatusOnCreate = 'PENDING';
  refuseNextRefund = false;
  private readonly signer = new CashfreeGateway({
    env: 'sandbox',
    clientId: 'id',
    clientSecret: SECRET,
    apiVersion: '2026-01-01',
  });

  async createLink(input: CreateLinkInput) {
    if (this.failNextCreate) {
      this.failNextCreate = false;
      throw new Error('link_id_invalid');
    }
    const link = {
      linkId: input.linkId,
      url: `https://payments-test.cashfree.com/links/${input.linkId}`,
      status: 'ACTIVE',
      amountPaidPaise: 0,
      raw: { link_id: input.linkId },
      input,
    };
    this.links.set(input.linkId, link);
    return link;
  }
  async getLink(linkId: string) {
    return this.links.get(linkId)!;
  }
  async successfulPayments(linkId: string) {
    return this.captures.get(linkId) ?? [];
  }
  async cancelLink(linkId: string) {
    const link = this.links.get(linkId)!;
    link.status = 'CANCELLED';
    return link;
  }
  async createRefund(input: CreateRefundInput) {
    if (this.refuseNextRefund) {
      this.refuseNextRefund = false;
      throw new GatewayError(
        'Cashfree POST /orders/x/refunds failed (HTTP 400: amount too large)',
        400,
      );
    }
    const existing = this.refunds.get(input.refundId);
    if (existing) return existing;
    const r = {
      refundId: input.refundId,
      status: this.refundStatusOnCreate,
      gatewayRefundId: `cf_ref_${this.refunds.size + 1}`,
      raw: { refund_id: input.refundId },
      input,
    };
    this.refunds.set(input.refundId, r);
    return r;
  }
  async getRefund(_orderId: string, refundId: string) {
    return this.refunds.get(refundId)!;
  }
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | undefined>) {
    return this.signer.verifyWebhook(rawBody, headers);
  }

  pay(linkId: string, paise: number, id = 'cf_pay_1') {
    this.captures.set(linkId, [
      {
        orderId: `CFPay_${id}`,
        paymentId: id,
        amountPaise: paise,
        method: 'upi',
        completedAt: '2026-10-21T10:00:00+05:30',
        raw: { cf_payment_id: id },
      },
    ]);
    this.links.get(linkId)!.status = 'PAID';
  }
}

describe.skipIf(!url)('payment links through the gateway (D-11, MR-19, EC-25)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let coordinator: Awaited<ReturnType<typeof signInAs>>;
  let customer: Awaited<ReturnType<typeof signInAs>>;
  let manager: Awaited<ReturnType<typeof signInAs>>;
  let finance: Awaited<ReturnType<typeof signInAs>>;
  const gateway = new FakeGateway();
  const sent: { phone: string; text: string }[] = [];
  const whatsapp: WhatsAppMessenger = {
    sendText: async (phone, text) => void sent.push({ phone, text }),
  };
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp(
      url!,
      { PAYMENT_GATEWAY: 'cashfree', CASHFREE_CLIENT_ID: 'id', CASHFREE_CLIENT_SECRET: SECRET },
      { gateway, whatsapp },
    );
    coordinator = await signInAs(ctx, ['OPS_COORDINATOR']);
    customer = await signInAs(ctx, ['CUSTOMER']);
    manager = await signInAs(ctx, ['OPS_MANAGER']);
    finance = await signInAs(ctx, ['FINANCE']);
  });
  afterAll(async () => ctx?.close());

  const newBooking = async () =>
    (
      await http()
        .post('/v1/bookings/manual')
        .set(coordinator.header)
        .send(manualBooking())
        .expect(201)
    ).body;
  const sendLink = (reference: string, body: object = {}) =>
    http().post(`/v1/bookings/${reference}/payments/link`).set(coordinator.header).send(body);
  const webhook = (payload: object, secret = SECRET, key?: string) => {
    const body = JSON.stringify(payload);
    const ts = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', secret)
      .update(ts + body)
      .digest('base64');
    return http()
      .post('/v1/payments/webhook/cashfree')
      .set('content-type', GATEWAY_WEBHOOK_TYPE)
      .set('x-webhook-signature', signature)
      .set('x-webhook-timestamp', ts)
      .set(key ? { 'x-idempotency-key': key } : {})
      .send(body);
  };
  const paymentWebhook = (linkId: string, status = 'SUCCESS') => ({
    type: status === 'SUCCESS' ? 'PAYMENT_SUCCESS_WEBHOOK' : 'PAYMENT_FAILED_WEBHOOK',
    data: {
      order: { order_id: 'CFPay_x', order_tags: { link_id: linkId } },
      payment: { cf_payment_id: 'cf_pay_1', payment_status: status },
    },
  });
  const detail = async (reference: string) =>
    (await http().get(`/v1/bookings/${reference}`).set(coordinator.header).expect(200)).body;
  const until = async <T>(check: () => Promise<T | undefined>) => {
    for (let i = 0; i < 50; i++) {
      const v = await check();
      if (v) return v;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('timed out');
  };

  it('creates a link for the balance due and sends it to the booker on WhatsApp', async () => {
    const b = await newBooking();
    await sendLink(b.reference).set(customer.header).expect(403);
    const r = await sendLink(b.reference).expect(201);
    expect(r.body.linkDelivery).toEqual({
      paymentId: expect.any(String),
      url: expect.stringContaining('cashfree.com'),
      delivery: 'WHATSAPP',
    });
    const item = r.body.payment.items[0];
    expect(item).toMatchObject({
      state: 'PENDING',
      method: 'GATEWAY',
      amountPaise: 649500,
      link: { url: expect.stringContaining('cashfree.com/links/nav_') },
    });
    expect(r.body.payment.gatewayEnabled).toBe(true);
    const link = [...gateway.links.values()].at(-1)!;
    expect(link.input).toMatchObject({ amountPaise: 649500, customer: { phone: b.booker.phone } });
    expect(sent.at(-1)!.phone).toBe(b.booker.phone);
    expect(sent.at(-1)!.text).toContain(link.url);
    expect(sent.at(-1)!.text).toContain(b.reference);
    expect(sent.at(-1)!.text).toContain('₹6,495.00');

    // The open link holds the balance: nothing more is due until it is paid or ends.
    await sendLink(b.reference).expect(409);
  });

  it('records the payment only from the gateway, once, and confirms the booking', async () => {
    const b = await newBooking();
    const r = await sendLink(b.reference).expect(201);
    const paymentId = r.body.linkDelivery.paymentId;
    const linkId = [...gateway.links.keys()].at(-1)!;

    // Forged or unsigned notifications are refused.
    await webhook(paymentWebhook(linkId), 'wrong-secret').expect(401);
    await http()
      .post('/v1/payments/webhook/cashfree')
      .set('content-type', 'application/json')
      .send(paymentWebhook(linkId))
      .expect(400);

    // A signed notification whose payment the gateway does not confirm changes nothing.
    await webhook(paymentWebhook(linkId), SECRET, 'evt-early').expect(200);
    await until(async () => {
      const [e] = await ctx.db.select().from(schema.gatewayEvent);
      return e?.processedAt ?? undefined;
    });
    expect((await detail(b.reference)).payment.items[0].state).toBe('PENDING');

    // The customer pays; the gateway says so.
    gateway.pay(linkId, 649500);
    await webhook(paymentWebhook(linkId), SECRET, 'evt-paid').expect(200);
    const paid = await until(async () => {
      const d = await detail(b.reference);
      return d.payment.items[0].state === 'SUCCESS' ? d : undefined;
    });
    expect(paid.payment.items[0]).toMatchObject({
      capturedPaise: 649500,
      reference: 'cf_pay_1',
      link: { gatewayPaymentId: 'cf_pay_1' },
    });
    expect(paid.payment).toMatchObject({ paidPaise: 649500, duePaise: 0 });
    expect(paid.confirmation).toEqual({ open: false, waitingFor: ['FULFILMENT'] });
    const step = paid.history.find(
      (h: { entityId: string; to: string }) => h.entityId === paymentId && h.to === 'SUCCESS',
    );
    expect(step.actorRole).toBe('PAYMENT_GATEWAY');

    // Duplicate delivery: acknowledged, not stored or processed again (NFR-09).
    const before = (await ctx.db.select().from(schema.gatewayEvent)).length;
    await webhook(paymentWebhook(linkId), SECRET, 'evt-paid').expect(200);
    expect((await ctx.db.select().from(schema.gatewayEvent)).length).toBe(before);

    // Supplier confirmed → booking confirmed.
    const vehicle = paid.fulfilment.components[0].id;
    await http()
      .post(`/v1/fulfilments/${vehicle}/request`)
      .set(coordinator.header)
      .send({})
      .expect(200);
    const confirmed = await http()
      .post(`/v1/fulfilments/${vehicle}/confirm`)
      .set(coordinator.header)
      .send({ supplierReference: 'ST-1', capacity: 7 })
      .expect(200);
    expect(confirmed.body.state).toBe('CONFIRMED');
  });

  it('a cancelled link fails the payment; a late capture still counts (EC-25)', async () => {
    const b = await newBooking();
    const paymentId = (await sendLink(b.reference, { amountPaise: 100000 }).expect(201)).body
      .linkDelivery.paymentId;
    const linkId = [...gateway.links.keys()].at(-1)!;

    const cancelled = await http()
      .post(`/v1/payments/${paymentId}/cancel-link`)
      .set(coordinator.header)
      .expect(200);
    expect(cancelled.body.payment.items[0]).toMatchObject({
      state: 'FAILED',
      reason: 'Payment link cancelled without payment',
    });

    gateway.pay(linkId, 100000, 'cf_pay_late');
    const after = await http()
      .post(`/v1/payments/${paymentId}/reconcile`)
      .set(coordinator.header)
      .expect(200);
    expect(after.body.payment.items[0]).toMatchObject({ state: 'SUCCESS', capturedPaise: 100000 });
    // Running it again changes nothing.
    await http().post(`/v1/payments/${paymentId}/reconcile`).set(coordinator.header).expect(200);
    expect((await detail(b.reference)).payment.paidPaise).toBe(100000);
  });

  it('a link the gateway refuses is recorded as failed and frees the balance', async () => {
    const b = await newBooking();
    gateway.failNextCreate = true;
    const r = await sendLink(b.reference).expect(502);
    expect(r.body.message).toMatch(/link_id_invalid/);
    const d = await detail(b.reference);
    expect(d.payment.items[0]).toMatchObject({ state: 'FAILED', method: 'GATEWAY' });
    await sendLink(b.reference).expect(201);
  });

  it('refuses amounts above the balance due', async () => {
    const b = await newBooking();
    await sendLink(b.reference, { amountPaise: 649501 }).expect(422);
    await sendLink(b.reference, { amountPaise: 0 }).expect(400);
  });

  describe('refunds through the gateway (D-11, D-19 extension)', () => {
    const post = (who: { header: Record<string, string> }, path: string, body: object = {}) =>
      http().post(path).set(who.header).send(body);

    /** A booking paid in full by link, then cancelled with a refund approved by a manager. */
    async function cancelledPaidBooking(refundPaise: number) {
      const b = await newBooking();
      const paymentId = (await sendLink(b.reference).expect(201)).body.linkDelivery.paymentId;
      gateway.pay([...gateway.links.keys()].at(-1)!, 649500, `cf_pay_${b.reference}`);
      await post(coordinator, `/v1/payments/${paymentId}/reconcile`).expect(200);
      const asked = await post(coordinator, `/v1/bookings/${b.reference}/cancel-request`, {
        reason: 'Family emergency',
        requestedVia: 'PHONE',
      }).expect(201);
      const c = asked.body.cancellations[0];
      await post(coordinator, `/v1/cancellations/${c.id}/review`, {
        refundPaise,
        refundNote: 'Full refund, more than 7 days before travel',
      }).expect(200);
      const done = await post(manager, `/v1/cancellations/${c.id}/approve`).expect(200);
      expect(done.body.refunds).toMatchObject({
        duePaise: refundPaise,
        gatewayRefundablePaise: 649500,
      });
      return { b, paymentId };
    }

    it('needs a second person, then the gateway, before money counts as returned', async () => {
      const { b, paymentId } = await cancelledPaidBooking(649500);
      await post(coordinator, `/v1/bookings/${b.reference}/refunds/gateway`, {
        amountPaise: 1000,
        reason: 'x',
      }).expect(403);
      await post(finance, `/v1/bookings/${b.reference}/refunds/gateway`, {
        amountPaise: 649501,
        reason: 'Cancelled',
      }).expect(422);
      const asked = await post(finance, `/v1/bookings/${b.reference}/refunds/gateway`, {
        amountPaise: 649500,
        reason: 'Cancelled by the family',
      }).expect(201);
      const r = asked.body.refunds.items[0];
      expect(r).toMatchObject({
        state: 'INITIATED',
        method: 'GATEWAY',
        gateway: { paymentId, approvedBy: null, sentAt: null },
      });
      // The amount is held: nothing more can be asked for.
      expect(asked.body.refunds).toMatchObject({ duePaise: 0, gatewayRefundablePaise: 0 });
      expect(gateway.refunds.size).toBe(0);

      // The person who asked cannot approve; a hand confirmation is not allowed either.
      await post(finance, `/v1/refunds/${r.id}/approve`).expect(403);
      await post(manager, `/v1/refunds/${r.id}/confirm`).expect(409);

      const sent = await post(manager, `/v1/refunds/${r.id}/approve`).expect(200);
      const item = sent.body.refunds.items[0];
      expect(item).toMatchObject({
        state: 'INITIATED',
        gateway: { approvedBy: manager.userId, status: 'PENDING', sentAt: expect.any(String) },
      });
      const created = [...gateway.refunds.values()].at(-1)!;
      expect(created.input).toMatchObject({
        orderId: `CFPay_cf_pay_${b.reference}`,
        refundId: item.gateway.refundId,
        amountPaise: 649500,
        note: 'Cancelled by the family',
      });
      // Already sent: cannot be approved again or rejected.
      await post(manager, `/v1/refunds/${r.id}/approve`).expect(409);
      await post(manager, `/v1/refunds/${r.id}/reject`, { reason: 'no' }).expect(409);

      // The gateway finishes it; its refund webhook triggers the check.
      created.status = 'SUCCESS';
      await webhook(
        { type: 'REFUND_STATUS_WEBHOOK', data: { refund: { refund_id: item.gateway.refundId } } },
        SECRET,
        `evt-refund-${r.id}`,
      ).expect(200);
      const done = await until(async () => {
        const d = await detail(b.reference);
        // Wait for the whole settlement (the page reads outside the settling transaction).
        return d.refunds.items[0].state === 'CONFIRMED' && d.cancellations[0].state === 'REFUNDED'
          ? d
          : undefined;
      });
      expect(done.payment.items[0]).toMatchObject({ state: 'REFUNDED', refundedPaise: 649500 });
      expect(done.cancellations[0].state).toBe('REFUNDED');
      const steps = done.history
        .filter((h: { machine: string }) => h.machine === 'Refund' || h.machine === 'Payment')
        .map(
          (h: { machine: string; to: string; actorRole: string }) =>
            `${h.machine}:${h.to}:${h.actorRole}`,
        );
      expect(steps).toEqual(
        expect.arrayContaining([
          'Refund:INITIATED:FINANCE',
          'Refund:CONFIRMED:PAYMENT_GATEWAY',
          'Payment:REFUNDED:PAYMENT_GATEWAY',
        ]),
      );
    });

    it('a refund the gateway refuses fails and frees the amount; check status settles the rest', async () => {
      const { b } = await cancelledPaidBooking(300000);
      const ask = (amountPaise: number) =>
        post(finance, `/v1/bookings/${b.reference}/refunds/gateway`, {
          amountPaise,
          reason: 'Partial refund',
        }).expect(201);

      const first = (await ask(300000)).body.refunds.items[0];
      gateway.refuseNextRefund = true;
      const refused = await post(manager, `/v1/refunds/${first.id}/approve`).expect(502);
      expect(refused.body.message).toMatch(/amount too large/);
      const after = await detail(b.reference);
      expect(after.refunds.items[0]).toMatchObject({ state: 'FAILED' });
      expect(after.refunds.duePaise).toBe(300000);

      const second = (await ask(300000)).body.refunds.items.at(-1);
      await post(manager, `/v1/refunds/${second.id}/approve`).expect(200);
      const created = [...gateway.refunds.values()].at(-1)!;
      await post(finance, `/v1/refunds/${second.id}/check`).expect(200);
      expect((await detail(b.reference)).refunds.items.at(-1).state).toBe('INITIATED');
      created.status = 'SUCCESS';
      const checked = await post(finance, `/v1/refunds/${second.id}/check`).expect(200);
      expect(checked.body.refunds.items.at(-1).state).toBe('CONFIRMED');
      expect(checked.body.payment.items[0]).toMatchObject({
        state: 'PARTIALLY_REFUNDED',
        refundedPaise: 300000,
      });
    });

    it('is refused without an online payment', async () => {
      const b = await newBooking();
      await post(finance, `/v1/bookings/${b.reference}/refunds/gateway`, {
        amountPaise: 100,
        reason: 'x',
      }).expect(409);
    });
  });
});

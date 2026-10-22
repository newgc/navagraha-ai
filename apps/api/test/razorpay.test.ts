import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GatewayError, RazorpayGateway } from '../src/payments/gateway.js';

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
type Reply = unknown | ((body: unknown) => { status: number; body: unknown });

function fakeFetch(replies: Record<string, Reply>) {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const path = url.replace('https://api.razorpay.com/v1', '');
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    calls.push({
      url,
      method: init.method!,
      headers: init.headers as Record<string, string>,
      body,
    });
    const reply = replies[`${init.method} ${path}`];
    if (reply === undefined) {
      return new Response(JSON.stringify({ error: { description: 'not found' } }), {
        status: 404,
      });
    }
    if (typeof reply === 'function') {
      const r = (reply as (b: unknown) => { status: number; body: unknown })(body);
      return new Response(JSON.stringify(r.body), { status: r.status });
    }
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const LINK = `nav_${'a'.repeat(32)}`;
const REFUND = `r${'b'.repeat(32)}`;
const gateway = (fetch: typeof globalThis.fetch) =>
  new RazorpayGateway({
    keyId: 'rzp_test_key',
    keySecret: 'ksecret',
    webhookSecret: 'whsecret',
    fetch,
  });

const plink = (over: Record<string, unknown> = {}) => ({
  id: 'plink_1',
  reference_id: LINK,
  short_url: 'https://rzp.io/rzp/abc',
  status: 'created',
  amount_paid: 0,
  payments: null,
  ...over,
});

describe('Razorpay gateway (D-11)', () => {
  it('creates a link in paise with our id as reference, the full number and no Razorpay SMS', async () => {
    const { fetch, calls } = fakeFetch({ 'POST /payment_links': plink() });
    const link = await gateway(fetch).createLink({
      linkId: LINK,
      amountPaise: 649550,
      purpose: 'Booking NAV-000001',
      customer: { phone: '+919876543210', name: 'Priya' },
      expiresAt: new Date('2026-10-23T10:00:00Z'),
      returnUrl: 'https://navagrahayathra.in/paid',
    });
    expect(link).toMatchObject({ linkId: LINK, url: 'https://rzp.io/rzp/abc', status: 'ACTIVE' });
    const call = calls[0]!;
    expect(call.headers.authorization).toBe(
      `Basic ${Buffer.from('rzp_test_key:ksecret').toString('base64')}`,
    );
    expect(call.body).toEqual({
      amount: 649550,
      currency: 'INR',
      accept_partial: false,
      reference_id: LINK,
      description: 'Booking NAV-000001',
      customer: { contact: '+919876543210', name: 'Priya' },
      expire_by: Math.floor(Date.parse('2026-10-23T10:00:00Z') / 1000),
      notify: { sms: false, email: false },
      reminder_enable: false,
      notes: { link_id: LINK },
      callback_url: 'https://navagrahayathra.in/paid',
      callback_method: 'get',
    });
  });

  it('a retried create returns the link Razorpay already has instead of failing', async () => {
    const { fetch } = fakeFetch({
      'POST /payment_links': () => ({
        status: 400,
        body: { error: { description: 'reference_id already exists' } },
      }),
      [`GET /payment_links?reference_id=${LINK}`]: { payment_links: [plink()] },
    });
    const link = await gateway(fetch).createLink({
      linkId: LINK,
      amountPaise: 100,
      purpose: 'x',
      customer: { phone: '+919876543210' },
      expiresAt: new Date(Date.now() + 86400_000),
    });
    expect(link.url).toBe('https://rzp.io/rzp/abc');
  });

  it('reads the link by our reference and counts only captured payments', async () => {
    const { fetch } = fakeFetch({
      [`GET /payment_links?reference_id=${LINK}`]: {
        payment_links: [
          plink({
            status: 'paid',
            amount_paid: 649550,
            payments: [
              { payment_id: 'pay_x', amount: 649550, method: 'upi', status: 'failed' },
              {
                payment_id: 'pay_y',
                amount: 649550,
                method: 'upi',
                status: 'captured',
                created_at: 1761040800,
              },
            ],
          }),
        ],
      },
    });
    const g = gateway(fetch);
    expect(await g.getLink(LINK)).toMatchObject({ status: 'PAID', amountPaidPaise: 649550 });
    expect(await g.successfulPayments(LINK)).toEqual([
      {
        orderId: 'pay_y',
        paymentId: 'pay_y',
        amountPaise: 649550,
        method: 'upi',
        completedAt: new Date(1761040800 * 1000).toISOString(),
        raw: expect.any(Object),
      },
    ]);
  });

  it('an unknown link is a 404, so a link from another gateway stops holding the balance', async () => {
    const { fetch } = fakeFetch({
      [`GET /payment_links?reference_id=${LINK}`]: { payment_links: [] },
    });
    await expect(gateway(fetch).getLink(LINK)).rejects.toMatchObject({ status: 404 });
  });

  it('cancels by Razorpay id', async () => {
    const { fetch, calls } = fakeFetch({
      [`GET /payment_links?reference_id=${LINK}`]: { payment_links: [plink()] },
      'POST /payment_links/plink_1/cancel': plink({ status: 'cancelled' }),
    });
    expect((await gateway(fetch).cancelLink(LINK)).status).toBe('CANCELLED');
    expect(calls.at(-1)!.url).toBe('https://api.razorpay.com/v1/payment_links/plink_1/cancel');
  });

  it('refunds with our id as receipt, and never twice for the same receipt', async () => {
    const refunds: Record<string, unknown>[] = [];
    const { fetch, calls } = fakeFetch({
      'GET /payments/pay_y/refunds?count=100': () => ({ status: 200, body: { items: refunds } }),
      'POST /payments/pay_y/refund': (body: unknown) => {
        const r = { id: 'rfnd_1', status: 'pending', ...(body as object) };
        refunds.push(r);
        return { status: 200, body: r };
      },
    });
    const g = gateway(fetch);
    const input = {
      orderId: 'pay_y',
      refundId: REFUND,
      amountPaise: 5000,
      note: 'Cancelled\nearly',
    };
    const first = await g.createRefund(input);
    expect(first).toMatchObject({ refundId: REFUND, status: 'PENDING', gatewayRefundId: 'rfnd_1' });
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      amount: 5000,
      speed: 'normal',
      receipt: REFUND,
      notes: { reason: 'Cancelled early' },
    });
    // "Send again": finds the refund by receipt and does not post a second one.
    await g.createRefund(input);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);

    refunds[0]!.status = 'processed';
    expect((await g.getRefund('pay_y', REFUND)).status).toBe('SUCCESS');
    refunds[0]!.status = 'failed';
    expect((await g.getRefund('pay_y', REFUND)).status).toBe('REJECTED');
  });

  it('refuses to refund a payment that was not taken through Razorpay', async () => {
    const { fetch, calls } = fakeFetch({});
    const err = await gateway(fetch)
      .createRefund({ orderId: 'CFPay_a', refundId: REFUND, amountPaise: 1, note: 'x' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect((err as GatewayError).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('accepts only webhooks signed with the webhook secret (hex HMAC-SHA256 of the body)', () => {
    const g = gateway(fakeFetch({}).fetch);
    const body = Buffer.from('{"event":"payment_link.paid","amount":170.00}');
    const sig = createHmac('sha256', 'whsecret').update(body).digest('hex');
    expect(g.verifyWebhook(body, { 'x-razorpay-signature': sig })).toBe(true);
    expect(
      g.verifyWebhook(Buffer.from('{"event":"payment_link.paid"}'), {
        'x-razorpay-signature': sig,
      }),
    ).toBe(false);
    const wrong = createHmac('sha256', 'ksecret').update(body).digest('hex');
    expect(g.verifyWebhook(body, { 'x-razorpay-signature': wrong })).toBe(false);
    expect(g.verifyWebhook(body, {})).toBe(false);
    const noSecret = new RazorpayGateway({ keyId: 'rzp_test_k', keySecret: 's' });
    expect(noSecret.verifyWebhook(body, { 'x-razorpay-signature': sig })).toBe(false);
  });

  it('finds our link and refund ids in webhooks only when they are ours', () => {
    const g = gateway(fakeFetch({}).fetch);
    expect(
      g.webhookEvent(
        {
          event: 'payment_link.paid',
          payload: { payment_link: { entity: { reference_id: LINK } } },
        },
        { 'x-razorpay-event-id': 'evt_1' },
      ),
    ).toEqual({ eventKey: 'evt_1', eventType: 'payment_link.paid', linkId: LINK, refundId: null });
    expect(
      g.webhookEvent(
        { event: 'refund.processed', payload: { refund: { entity: { receipt: REFUND } } } },
        {},
      ),
    ).toEqual({ eventKey: null, eventType: 'refund.processed', linkId: null, refundId: REFUND });
    expect(
      g.webhookEvent(
        {
          event: 'payment_link.paid',
          payload: { payment_link: { entity: { reference_id: 'other' } } },
        },
        {},
      ).linkId,
    ).toBeNull();
  });
});

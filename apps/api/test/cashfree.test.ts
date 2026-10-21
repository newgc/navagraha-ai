import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { linkIdOf } from '../src/bookings/payment-links.service.js';
import { CashfreeGateway, istIso, toPaise, toRupees } from '../src/payments/gateway.js';

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function fakeFetch(replies: Record<string, unknown>) {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const path = url.replace('https://sandbox.cashfree.com/pg', '');
    calls.push({
      url,
      method: init.method!,
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    });
    const reply = replies[`${init.method} ${path}`];
    if (reply === undefined)
      return new Response(JSON.stringify({ message: 'not found' }), { status: 404 });
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const gateway = (fetch: typeof globalThis.fetch) =>
  new CashfreeGateway({
    env: 'sandbox',
    clientId: 'cid',
    clientSecret: 'csecret',
    apiVersion: '2026-01-01',
    fetch,
  });

describe('Cashfree gateway (D-11)', () => {
  it('converts money and times the way Cashfree expects', () => {
    expect(toRupees(649500)).toBe(6495);
    expect(toRupees(12345)).toBe(123.45);
    expect(toPaise('200.12')).toBe(20012);
    expect(toPaise(55)).toBe(5500);
    expect(istIso(new Date('2026-10-21T10:00:00Z'))).toBe('2026-10-21T15:30:00+05:30');
  });

  it('creates a link with our id, rupees, the Indian number and no Cashfree SMS', async () => {
    const { fetch, calls } = fakeFetch({
      'POST /links': {
        link_id: 'nav_1',
        link_url: 'https://payments-test.cashfree.com/links/abc',
        link_status: 'ACTIVE',
        link_amount_paid: 0,
      },
    });
    const link = await gateway(fetch).createLink({
      linkId: 'nav_1',
      amountPaise: 649500,
      purpose: 'Booking NAV-000001',
      customer: { phone: '+919876543210', name: 'Priya' },
      expiresAt: new Date('2026-10-23T10:00:00Z'),
      returnUrl: 'https://navagrahayathra.in/paid',
    });
    expect(link).toMatchObject({
      url: 'https://payments-test.cashfree.com/links/abc',
      status: 'ACTIVE',
    });
    const call = calls[0]!;
    expect(call.url).toBe('https://sandbox.cashfree.com/pg/links');
    expect(call.headers).toMatchObject({
      'x-client-id': 'cid',
      'x-client-secret': 'csecret',
      'x-api-version': '2026-01-01',
      'x-idempotency-key': 'nav_1',
    });
    expect(call.body).toEqual({
      link_id: 'nav_1',
      link_amount: 6495,
      link_currency: 'INR',
      link_purpose: 'Booking NAV-000001',
      customer_details: { customer_phone: '9876543210', customer_name: 'Priya' },
      link_expiry_time: '2026-10-23T15:30:00+05:30',
      link_partial_payments: false,
      link_notify: { send_sms: false, send_email: false },
      link_meta: { return_url: 'https://navagrahayathra.in/paid' },
    });
  });

  it('reads captures from paid orders, counting only SUCCESS payments', async () => {
    const { fetch } = fakeFetch({
      'GET /links/nav_1/orders': [{ order_id: 'CFPay_a', order_status: 'PAID' }],
      'GET /orders/CFPay_a/payments': [
        { cf_payment_id: 11, payment_status: 'FAILED', payment_amount: 6495 },
        {
          cf_payment_id: 12,
          payment_status: 'SUCCESS',
          payment_amount: 6495,
          payment_group: 'upi',
          payment_completion_time: '2026-10-21T10:00:00+05:30',
        },
      ],
    });
    const captures = await gateway(fetch).successfulPayments('nav_1');
    expect(captures).toEqual([
      {
        orderId: 'CFPay_a',
        paymentId: '12',
        amountPaise: 649500,
        method: 'upi',
        completedAt: '2026-10-21T10:00:00+05:30',
        raw: expect.any(Object),
      },
    ]);
  });

  it('sends refunds with our id as the idempotency key; sandbox asks for a simulated success', async () => {
    const reply = {
      refund_id: 'rabc',
      cf_refund_id: 991,
      refund_status: 'PENDING',
    };
    const { fetch, calls } = fakeFetch({
      'POST /orders/CFPay_a/refunds': reply,
      'GET /orders/CFPay_a/refunds/rabc': { ...reply, refund_status: 'SUCCESS' },
    });
    const g = gateway(fetch);
    const sent = await g.createRefund({
      orderId: 'CFPay_a',
      refundId: 'rabc',
      amountPaise: 300050,
      note: 'Cancelled\nby family',
    });
    expect(sent).toMatchObject({ refundId: 'rabc', status: 'PENDING', gatewayRefundId: '991' });
    expect(calls[0]!.headers['x-idempotency-key']).toBe('rabc');
    expect(calls[0]!.body).toEqual({
      refund_id: 'rabc',
      refund_amount: 3000.5,
      refund_note: 'SUCCESS',
      refund_speed: 'STANDARD',
    });
    expect((await g.getRefund('CFPay_a', 'rabc')).status).toBe('SUCCESS');

    const live = new CashfreeGateway({
      env: 'production',
      clientId: 'cid',
      clientSecret: 'csecret',
      apiVersion: '2026-01-01',
      fetch: (async (_url: string, init: RequestInit) => {
        calls.push({
          url: _url,
          method: init.method!,
          headers: {},
          body: JSON.parse(init.body as string),
        });
        return new Response(JSON.stringify(reply), { status: 200 });
      }) as unknown as typeof globalThis.fetch,
    });
    await live.createRefund({
      orderId: 'o',
      refundId: 'rabc',
      amountPaise: 100,
      note: 'Cancelled\nby family',
    });
    expect(calls.at(-1)!.url).toBe('https://api.cashfree.com/pg/orders/o/refunds');
    expect((calls.at(-1)!.body as { refund_note: string }).refund_note).toBe('Cancelled by family');
  });

  it('reports gateway errors without credentials', async () => {
    const { fetch } = fakeFetch({});
    const err = await gateway(fetch)
      .getLink('nav_x')
      .catch((e: Error) => e);
    expect((err as Error).message).toMatch(/GET \/links\/nav_x failed \(HTTP 404: not found\)/);
    expect((err as Error).message).not.toContain('csecret');
  });

  it('verifies webhook signatures over timestamp + raw body', () => {
    const { fetch } = fakeFetch({});
    const g = gateway(fetch);
    const body = Buffer.from('{"data":{"payment":{"payment_amount":170.00}}}');
    const ts = '1729500000';
    const sig = createHmac('sha256', 'csecret').update(ts).update(body).digest('base64');
    expect(g.verifyWebhook(body, { 'x-webhook-signature': sig, 'x-webhook-timestamp': ts })).toBe(
      true,
    );
    // The exact bytes matter (170.00 vs 170).
    const changed = Buffer.from('{"data":{"payment":{"payment_amount":170}}}');
    expect(
      g.verifyWebhook(changed, { 'x-webhook-signature': sig, 'x-webhook-timestamp': ts }),
    ).toBe(false);
    expect(g.verifyWebhook(body, { 'x-webhook-signature': sig, 'x-webhook-timestamp': '1' })).toBe(
      false,
    );
    expect(g.verifyWebhook(body, {})).toBe(false);
  });

  it('finds our link id in payment and payment-link webhooks only', () => {
    const id = `nav_${'a'.repeat(32)}`;
    expect(linkIdOf({ data: { order: { order_tags: { link_id: id } } } })).toBe(id);
    expect(linkIdOf({ data: { link_id: id } })).toBe(id);
    expect(linkIdOf({ data: { order: { order_tags: { link_id: 'someone_else' } } } })).toBeNull();
    expect(linkIdOf({})).toBeNull();
  });
});

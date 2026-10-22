import 'server-only';

/**
 * Payment gateway webhooks (D-11, FS §32 POST /payments/webhook). The API only listens on the
 * server itself, so the website receives the notification and hands the exact bytes to the
 * API with the gateway's signature headers; the API verifies the signature and does the rest.
 * Configure in the gateway's dashboard:
 *   Razorpay: Settings → Webhooks → https://<site>/webhooks/razorpay
 *     (payment_link.paid, payment_link.expired, payment_link.cancelled, refund.processed,
 *     refund.failed), with a secret that is also RAZORPAY_WEBHOOK_SECRET
 *   Cashfree: Payment Gateway → Developers → Webhooks → https://<site>/webhooks/cashfree
 */
const API_URL = process.env.API_URL ?? 'http://localhost:4000';
const PROVIDERS = ['razorpay', 'cashfree'];
const FORWARDED = [
  'x-webhook-signature',
  'x-webhook-timestamp',
  'x-webhook-version',
  'x-idempotency-key',
  'x-razorpay-signature',
  'x-razorpay-event-id',
];

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  if (!PROVIDERS.includes(provider))
    return Response.json({ message: 'Not found' }, { status: 404 });
  const body = new Uint8Array(await req.arrayBuffer());
  const headers: Record<string, string> = {
    'content-type': 'application/vnd.navagraha.gateway-webhook',
  };
  for (const name of FORWARDED) {
    const value = req.headers.get(name);
    if (value) headers[name] = value;
  }
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) headers['x-forwarded-for'] = forwardedFor;
  try {
    const res = await fetch(`${API_URL}/v1/payments/webhook/${provider}`, {
      method: 'POST',
      headers,
      body,
      cache: 'no-store',
    });
    // Gateways retry anything but 2xx, which is what we want when the API refused or failed.
    return new Response(await res.text(), {
      status: res.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch {
    return Response.json({ message: 'Temporarily unavailable' }, { status: 503 });
  }
}

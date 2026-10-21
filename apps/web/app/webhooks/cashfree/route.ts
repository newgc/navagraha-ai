import 'server-only';

/**
 * Cashfree webhooks (D-11, FS §32 POST /payments/webhook). The API only listens on the
 * server itself, so the website receives the notification and hands the exact bytes to the
 * API with Cashfree's signature headers; the API verifies the signature and does the rest.
 * Configure in Cashfree: Payment Gateway → Developers → Webhooks → https://<site>/webhooks/cashfree
 */
const API_URL = process.env.API_URL ?? 'http://localhost:4000';
const FORWARDED = [
  'x-webhook-signature',
  'x-webhook-timestamp',
  'x-webhook-version',
  'x-idempotency-key',
];

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
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
    const res = await fetch(`${API_URL}/v1/payments/webhook/cashfree`, {
      method: 'POST',
      headers,
      body,
      cache: 'no-store',
    });
    // Cashfree retries anything but 200, which is what we want when the API refused or failed.
    return new Response(await res.text(), {
      status: res.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch {
    return Response.json({ message: 'Temporarily unavailable' }, { status: 503 });
  }
}

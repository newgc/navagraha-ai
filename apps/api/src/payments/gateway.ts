import { createHmac, timingSafeEqual } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../config.js';

export type GatewayProvider = 'cashfree' | 'razorpay';

/** What we need from a payment gateway for payment links (D-11): Razorpay, or Cashfree. */
export interface PaymentGateway {
  readonly provider: GatewayProvider;
  /** Name shown to customers and staff, e.g. "Razorpay". */
  readonly label: string;
  createLink(input: CreateLinkInput): Promise<GatewayLink>;
  getLink(linkId: string): Promise<GatewayLink>;
  /** Captured payments made through the link, read from the gateway's own records. */
  successfulPayments(linkId: string): Promise<GatewayCapture[]>;
  cancelLink(linkId: string): Promise<GatewayLink>;
  /** Sends money back for one captured order; safe to retry with the same refund id. */
  createRefund(input: CreateRefundInput): Promise<GatewayRefund>;
  getRefund(orderId: string, refundId: string): Promise<GatewayRefund>;
  /** True when a webhook really comes from the gateway (signature over the raw body). */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): boolean;
  /** What a verified webhook is about: our link id or our refund id, and its delivery id. */
  webhookEvent(
    payload: Record<string, unknown>,
    headers: Record<string, string | undefined>,
  ): WebhookEvent;
}

export interface WebhookEvent {
  /** The gateway's delivery id (same on retries); null to fall back to a hash of the body. */
  eventKey: string | null;
  eventType: string | null;
  linkId: string | null;
  refundId: string | null;
}

/** Our ids: `nav_` + 32 hex for links, `r` + 32 hex for refunds. Anything else is not ours. */
const OUR_LINK = /^nav_[0-9a-f]{32}$/;
const OUR_REFUND = /^r[0-9a-f]{32}$/;
const ours = (re: RegExp, ...candidates: unknown[]) =>
  (candidates.find((c) => typeof c === 'string' && re.test(c)) as string | undefined) ?? null;
const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

export interface CreateLinkInput {
  linkId: string;
  amountPaise: number;
  purpose: string;
  customer: { phone: string; name?: string | null };
  expiresAt: Date;
  returnUrl?: string;
}

export interface CreateRefundInput {
  orderId: string;
  /** Ours; 3–40 alphanumeric characters at Cashfree. */
  refundId: string;
  amountPaise: number;
  note: string;
}

/** SUCCESS and the two failure states are final; anything else is still in progress. */
export type RefundStatus =
  'SUCCESS' | 'PENDING' | 'PENDING_APPROVAL' | 'ONHOLD' | 'CANCELLED' | 'REJECTED';

export interface GatewayRefund {
  refundId: string;
  status: RefundStatus | string;
  gatewayRefundId: string | null;
  raw: unknown;
}

export type LinkStatus = 'ACTIVE' | 'PAID' | 'PARTIALLY_PAID' | 'EXPIRED' | 'CANCELLED';

export interface GatewayLink {
  linkId: string;
  url: string;
  status: LinkStatus | string;
  amountPaidPaise: number;
  raw: unknown;
}

export interface GatewayCapture {
  orderId: string;
  paymentId: string;
  amountPaise: number;
  /** e.g. upi, credit_card, net_banking */
  method: string | null;
  completedAt: string | null;
  raw: unknown;
}

/**
 * Content type the website uses when it forwards a gateway webhook to the API, so the API
 * receives the exact bytes the signature was computed over.
 */
export const GATEWAY_WEBHOOK_TYPE = 'application/vnd.navagraha.gateway-webhook';

/** Injection token; resolves to null when PAYMENT_GATEWAY is none. */
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** Gateways take rupees with up to two decimals; we keep integer paise everywhere else. */
export const toRupees = (paise: number) => Number((paise / 100).toFixed(2));
export const toPaise = (rupees: unknown) => Math.round(Number(rupees) * 100);

/** Cashfree wants the Indian 10-digit number; other countries as digits without "+". */
function cashfreePhone(e164: string) {
  return e164.startsWith('+91') ? e164.slice(3) : e164.replace(/^\+/, '');
}

/** ISO 8601 in India time, the format the Cashfree docs show (2021-10-14T15:04:05+05:30). */
export function istIso(date: Date) {
  const ist = new Date(date.getTime() + 330 * 60_000);
  return `${ist.toISOString().slice(0, 19)}+05:30`;
}

export interface CashfreeOptions {
  env: 'sandbox' | 'production';
  clientId: string;
  clientSecret: string;
  apiVersion: string;
  fetch?: typeof fetch;
}

/**
 * Cashfree Payment Gateway API (docs scraped 21 Oct 2026, x-api-version 2026-01-01):
 * payment links (/pg/links), their orders and payments, and webhook signatures
 * (base64 HMAC-SHA256 of timestamp + raw body, keyed by the client secret).
 */
export class CashfreeGateway implements PaymentGateway {
  readonly provider = 'cashfree' as const;
  readonly label = 'Cashfree';
  private readonly base: string;
  private readonly fetch: typeof fetch;

  constructor(private readonly options: CashfreeOptions) {
    this.base =
      options.env === 'production'
        ? 'https://api.cashfree.com/pg'
        : 'https://sandbox.cashfree.com/pg';
    this.fetch = options.fetch ?? fetch;
  }

  async createLink(input: CreateLinkInput): Promise<GatewayLink> {
    const body = {
      link_id: input.linkId,
      link_amount: toRupees(input.amountPaise),
      link_currency: 'INR',
      link_purpose: input.purpose.slice(0, 500),
      customer_details: {
        customer_phone: cashfreePhone(input.customer.phone),
        ...(input.customer.name ? { customer_name: input.customer.name } : {}),
      },
      link_expiry_time: istIso(input.expiresAt),
      link_partial_payments: false,
      // We send the link on WhatsApp ourselves.
      link_notify: { send_sms: false, send_email: false },
      ...(input.returnUrl ? { link_meta: { return_url: input.returnUrl } } : {}),
    };
    // The same link id makes a retried create safe (x-idempotency-key).
    const link = await this.call('POST', '/links', body, input.linkId);
    return this.link(link);
  }

  async getLink(linkId: string) {
    return this.link(await this.call('GET', `/links/${encodeURIComponent(linkId)}`));
  }

  async cancelLink(linkId: string) {
    return this.link(await this.call('POST', `/links/${encodeURIComponent(linkId)}/cancel`));
  }

  async successfulPayments(linkId: string): Promise<GatewayCapture[]> {
    // Paid orders only (the default); a new order is created for every attempt.
    const orders = (await this.call('GET', `/links/${encodeURIComponent(linkId)}/orders`)) as {
      order_id: string;
      order_status?: string;
    }[];
    const captures: GatewayCapture[] = [];
    for (const order of Array.isArray(orders) ? orders : []) {
      const payments = (await this.call(
        'GET',
        `/orders/${encodeURIComponent(order.order_id)}/payments`,
      )) as Record<string, unknown>[];
      for (const p of Array.isArray(payments) ? payments : []) {
        if (p.payment_status !== 'SUCCESS') continue;
        captures.push({
          orderId: order.order_id,
          paymentId: String(p.cf_payment_id),
          amountPaise: toPaise(p.payment_amount),
          method: typeof p.payment_group === 'string' ? p.payment_group : null,
          completedAt:
            typeof p.payment_completion_time === 'string' ? p.payment_completion_time : null,
          raw: p,
        });
      }
    }
    return captures;
  }

  async createRefund(input: CreateRefundInput): Promise<GatewayRefund> {
    // Sandbox simulates the outcome from the note (Cashfree docs); live refunds carry ours.
    const note =
      this.options.env === 'sandbox' ? 'SUCCESS' : input.note.replace(/\s+/g, ' ').slice(0, 100);
    const refund = await this.call(
      'POST',
      `/orders/${encodeURIComponent(input.orderId)}/refunds`,
      {
        refund_id: input.refundId,
        refund_amount: toRupees(input.amountPaise),
        refund_note: note.length >= 3 ? note : 'Refund',
        refund_speed: 'STANDARD',
      },
      input.refundId,
    );
    return this.refund(refund);
  }

  async getRefund(orderId: string, refundId: string) {
    return this.refund(
      await this.call(
        'GET',
        `/orders/${encodeURIComponent(orderId)}/refunds/${encodeURIComponent(refundId)}`,
      ),
    );
  }

  private refund(raw: unknown): GatewayRefund {
    const r = raw as Record<string, unknown>;
    return {
      refundId: String(r.refund_id),
      status: String(r.refund_status ?? ''),
      gatewayRefundId: r.cf_refund_id == null ? null : String(r.cf_refund_id),
      raw,
    };
  }

  verifyWebhook(rawBody: Buffer, headers: Record<string, string | undefined>) {
    const signature = headers['x-webhook-signature'];
    const timestamp = headers['x-webhook-timestamp'];
    if (!signature || !timestamp) return false;
    const expected = createHmac('sha256', this.options.clientSecret)
      .update(timestamp)
      .update(rawBody)
      .digest();
    const given = Buffer.from(signature, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  /**
   * Payment webhooks carry our link id in order_tags (2025-01-01+), payment-link webhooks at
   * data.link_id; refund webhooks our refund id at data.refund.refund_id.
   */
  webhookEvent(payload: Record<string, unknown>, headers: Record<string, string | undefined>) {
    const data = obj(payload.data);
    const tags = obj(obj(data.order).order_tags);
    return {
      eventKey: headers['x-idempotency-key'] ?? null,
      eventType: typeof payload.type === 'string' ? payload.type : null,
      linkId: ours(OUR_LINK, tags.link_id, data.link_id),
      refundId: ours(OUR_REFUND, obj(data.refund).refund_id),
    };
  }

  private link(raw: unknown): GatewayLink {
    const l = raw as Record<string, unknown>;
    return {
      linkId: String(l.link_id),
      url: String(l.link_url ?? ''),
      status: String(l.link_status ?? ''),
      amountPaidPaise: toPaise(l.link_amount_paid ?? 0),
      raw,
    };
  }

  private async call(method: string, path: string, body?: unknown, idempotencyKey?: string) {
    let res: Response;
    try {
      res = await this.fetch(`${this.base}${path}`, {
        method,
        headers: {
          'x-client-id': this.options.clientId,
          'x-client-secret': this.options.clientSecret,
          'x-api-version': this.options.apiVersion,
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new GatewayError(`Cashfree could not be reached: ${(err as Error).message}`);
    }
    const reply: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const message = (reply as { message?: unknown } | null)?.message;
      const detail = typeof message === 'string' ? `: ${message}` : '';
      throw new GatewayError(
        `Cashfree ${method} ${path} failed (HTTP ${res.status}${detail})`,
        res.status,
      );
    }
    return reply;
  }
}

export interface RazorpayOptions {
  keyId: string;
  keySecret: string;
  /** Set when adding the webhook in the Razorpay dashboard; without it webhooks are refused. */
  webhookSecret?: string;
  fetch?: typeof fetch;
}

/** Razorpay's refund states mapped onto ours: processed is paid, failed is final. */
const RAZORPAY_REFUND: Record<string, RefundStatus> = {
  processed: 'SUCCESS',
  pending: 'PENDING',
  failed: 'REJECTED',
};

/**
 * Razorpay API v1 (docs read 22 Oct 2026): payment links (/v1/payment_links, our link id as
 * reference_id), refunds on a payment (/v1/payments/{id}/refund, our refund id as receipt)
 * and webhook signatures (hex HMAC-SHA256 of the raw body, keyed by the webhook secret).
 * Test and live mode are chosen by the key (rzp_test_ / rzp_live_), not by the address.
 */
export class RazorpayGateway implements PaymentGateway {
  readonly provider = 'razorpay' as const;
  readonly label = 'Razorpay';
  private readonly base = 'https://api.razorpay.com/v1';
  private readonly fetch: typeof fetch;

  constructor(private readonly options: RazorpayOptions) {
    this.fetch = options.fetch ?? fetch;
  }

  async createLink(input: CreateLinkInput): Promise<GatewayLink> {
    const body = {
      amount: input.amountPaise,
      currency: 'INR',
      accept_partial: false,
      // Unique per link at Razorpay (40 characters at most), so a retried create cannot make a
      // second link for the same payment.
      reference_id: input.linkId,
      description: input.purpose.slice(0, 2048),
      customer: {
        contact: input.customer.phone,
        ...(input.customer.name ? { name: input.customer.name } : {}),
      },
      expire_by: Math.floor(input.expiresAt.getTime() / 1000),
      // We send the link on WhatsApp ourselves.
      notify: { sms: false, email: false },
      reminder_enable: false,
      notes: { link_id: input.linkId },
      ...(input.returnUrl ? { callback_url: input.returnUrl, callback_method: 'get' } : {}),
    };
    try {
      return this.link(await this.call('POST', '/payment_links', body));
    } catch (err) {
      // A create that reached Razorpay but whose reply was lost: the link is already there.
      if (err instanceof GatewayError && err.status === 400) {
        const existing = await this.find(input.linkId).catch(() => null);
        if (existing) return this.link(existing);
      }
      throw err;
    }
  }

  async getLink(linkId: string) {
    const raw = await this.find(linkId);
    if (!raw) throw new GatewayError(`Razorpay has no payment link ${linkId}`, 404);
    return this.link(raw);
  }

  async cancelLink(linkId: string) {
    const raw = await this.find(linkId);
    if (!raw) throw new GatewayError(`Razorpay has no payment link ${linkId}`, 404);
    return this.link(
      await this.call('POST', `/payment_links/${encodeURIComponent(String(raw.id))}/cancel`),
    );
  }

  async successfulPayments(linkId: string): Promise<GatewayCapture[]> {
    const raw = await this.find(linkId);
    const payments = Array.isArray(raw?.payments)
      ? (raw.payments as Record<string, unknown>[])
      : [];
    return payments
      .filter((p) => p.status === 'captured')
      .map((p) => ({
        // Razorpay refunds a payment, not an order, so the payment id is what refunds need.
        orderId: String(p.payment_id),
        paymentId: String(p.payment_id),
        amountPaise: Number(p.amount),
        method: typeof p.method === 'string' ? p.method : null,
        completedAt:
          typeof p.created_at === 'number' ? new Date(p.created_at * 1000).toISOString() : null,
        raw: p,
      }));
  }

  async createRefund(input: CreateRefundInput): Promise<GatewayRefund> {
    if (!input.orderId.startsWith('pay_')) {
      // A payment taken through the gateway used before Razorpay: refund it outside Razorpay.
      throw new GatewayError(`${input.orderId} was not paid through Razorpay`, 400);
    }
    // The receipt is Razorpay's duplicate check: look first, so "Send again" never refunds twice.
    const existing = await this.findRefund(input.orderId, input.refundId);
    if (existing) return this.refund(existing);
    try {
      return this.refund(
        await this.call('POST', `/payments/${encodeURIComponent(input.orderId)}/refund`, {
          amount: input.amountPaise,
          speed: 'normal',
          receipt: input.refundId,
          notes: { reason: input.note.replace(/\s+/g, ' ').slice(0, 256) },
        }),
      );
    } catch (err) {
      if (err instanceof GatewayError && err.status === 400) {
        const made = await this.findRefund(input.orderId, input.refundId).catch(() => null);
        if (made) return this.refund(made);
      }
      throw err;
    }
  }

  async getRefund(orderId: string, refundId: string) {
    const raw = await this.findRefund(orderId, refundId);
    if (!raw) throw new GatewayError(`Razorpay has no refund ${refundId}`, 404);
    return this.refund(raw);
  }

  verifyWebhook(rawBody: Buffer, headers: Record<string, string | undefined>) {
    const signature = headers['x-razorpay-signature'];
    if (!signature || !this.options.webhookSecret) return false;
    const expected = createHmac('sha256', this.options.webhookSecret).update(rawBody).digest();
    const given = Buffer.from(signature, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  /** payment_link.* events carry the link (reference_id); refund.* the refund (receipt). */
  webhookEvent(payload: Record<string, unknown>, headers: Record<string, string | undefined>) {
    const body = obj(payload.payload);
    const link = obj(obj(body.payment_link).entity);
    const refund = obj(obj(body.refund).entity);
    return {
      eventKey: headers['x-razorpay-event-id'] ?? null,
      eventType: typeof payload.event === 'string' ? payload.event : null,
      linkId: ours(OUR_LINK, link.reference_id, obj(link.notes).link_id),
      refundId: ours(OUR_REFUND, refund.receipt),
    };
  }

  /** Our link by its reference id; null when Razorpay has none. */
  private async find(linkId: string) {
    const reply = obj(
      await this.call('GET', `/payment_links?reference_id=${encodeURIComponent(linkId)}`),
    );
    const links = Array.isArray(reply.payment_links)
      ? (reply.payment_links as Record<string, unknown>[])
      : [];
    return links.find((l) => l.reference_id === linkId) ?? null;
  }

  private async findRefund(paymentId: string, refundId: string) {
    const reply = obj(
      await this.call('GET', `/payments/${encodeURIComponent(paymentId)}/refunds?count=100`),
    );
    const items = Array.isArray(reply.items) ? (reply.items as Record<string, unknown>[]) : [];
    return items.find((r) => r.receipt === refundId) ?? null;
  }

  private link(raw: unknown): GatewayLink {
    const l = obj(raw);
    const status = String(l.status ?? '');
    return {
      linkId: String(l.reference_id),
      url: String(l.short_url ?? ''),
      // Ours are Cashfree's words; Razorpay's "created" is a link still waiting to be paid.
      status: status === 'created' ? 'ACTIVE' : status.toUpperCase(),
      amountPaidPaise: Number(l.amount_paid ?? 0),
      raw,
    };
  }

  private refund(raw: unknown): GatewayRefund {
    const r = obj(raw);
    const status = String(r.status ?? '');
    return {
      refundId: String(r.receipt ?? ''),
      status: RAZORPAY_REFUND[status] ?? status.toUpperCase(),
      gatewayRefundId: r.id == null ? null : String(r.id),
      raw,
    };
  }

  private async call(method: string, path: string, body?: unknown) {
    let res: Response;
    try {
      res = await this.fetch(`${this.base}${path}`, {
        method,
        headers: {
          authorization: `Basic ${Buffer.from(`${this.options.keyId}:${this.options.keySecret}`).toString('base64')}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new GatewayError(`Razorpay could not be reached: ${(err as Error).message}`);
    }
    const reply: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const message = obj(obj(reply).error).description;
      const detail = typeof message === 'string' ? `: ${message}` : '';
      throw new GatewayError(
        `Razorpay ${method} ${path.split('?')[0]} failed (HTTP ${res.status}${detail})`,
        res.status,
      );
    }
    return reply;
  }
}

export function gatewayFromConfig(config: AppConfig): PaymentGateway | null {
  if (config.PAYMENT_GATEWAY === 'razorpay') {
    return new RazorpayGateway({
      keyId: config.RAZORPAY_KEY_ID!,
      keySecret: config.RAZORPAY_KEY_SECRET!,
      webhookSecret: config.RAZORPAY_WEBHOOK_SECRET,
    });
  }
  if (config.PAYMENT_GATEWAY !== 'cashfree') return null;
  return new CashfreeGateway({
    env: config.CASHFREE_ENV,
    clientId: config.CASHFREE_CLIENT_ID!,
    clientSecret: config.CASHFREE_CLIENT_SECRET!,
    apiVersion: config.CASHFREE_API_VERSION,
  });
}

export const gatewayProvider = {
  provide: PAYMENT_GATEWAY,
  useFactory: gatewayFromConfig,
  inject: [APP_CONFIG],
};

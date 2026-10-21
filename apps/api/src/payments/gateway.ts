import { createHmac, timingSafeEqual } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../config.js';

/** What we need from a payment gateway for payment links (D-11). Cashfree today. */
export interface PaymentGateway {
  readonly provider: 'cashfree';
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
}

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

export function gatewayFromConfig(config: AppConfig): PaymentGateway | null {
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

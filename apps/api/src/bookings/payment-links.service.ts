import { createHash, randomUUID } from 'node:crypto';
import { schema, type Database } from '@navagraha/db';
import { maskPhone, paymentMachine } from '@navagraha/domain';
import {
  BadGatewayException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { and, eq, gt, isNotNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { DB } from '../db/db.module.js';
import { WHATSAPP, type WhatsAppMessenger } from '../messaging/whatsapp.js';
import { PAYMENT_GATEWAY, type GatewayCapture, type PaymentGateway } from '../payments/gateway.js';
import { systemActor, TransitionService, type Actor } from '../state/transition.service.js';
import { BookingCore, OPEN_STATES } from './booking-core.js';
import { GatewayRefundsService, refundIdOf } from './gateway-refunds.service.js';

const { booking, payment, appUser, gatewayEvent } = schema;

/** The gateway itself is the actor for captures it reports (D-04 §2.2). */
const gatewayActor: Actor = { userId: null, roles: ['PAYMENT_GATEWAY'] };

/** How often unpaid links are checked against the gateway, in case a webhook is lost (MR-19). */
const RECONCILE_EVERY_MS = 10 * 60_000;

export type LinkDelivery = 'WHATSAPP' | 'NOT_SENT';

/**
 * Payment links through the gateway (D-11 Cashfree, FS §11.2, MR-19, EC-22–EC-25).
 *
 * Money is only ever recorded from the gateway's own API: a webhook (verified, stored once)
 * just triggers a reconciliation that reads the link's paid orders and their payments. A
 * client redirect, a webhook body or a person can never mark a link paid.
 */
@Injectable()
export class PaymentLinksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('PaymentLinks');
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway | null,
    @Inject(WHATSAPP) private readonly whatsapp: WhatsAppMessenger | null,
    @Inject(TransitionService) private readonly transitions: TransitionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(BookingCore) private readonly core: BookingCore,
    @Inject(GatewayRefundsService) private readonly refunds: GatewayRefundsService,
  ) {}

  onModuleInit() {
    if (!this.gateway || this.config.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      void this.reconcileOpenLinks().then(() => this.refunds.reconcileOpen());
    }, RECONCILE_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private requireGateway() {
    if (!this.gateway) {
      throw new ServiceUnavailableException('No payment gateway is configured on this server');
    }
    return this.gateway;
  }

  // ---------------------------------------------------------------- create and send

  /** Creates a link for the balance still due (or a smaller amount) and sends it on WhatsApp. */
  async create(
    bookingId: string,
    input: { amountPaise?: number },
    auth: AuthContext,
    correlationId: string,
    /** The customer paying on the website is sent straight to the link instead. */
    options: { notify?: boolean } = {},
  ): Promise<{ paymentId: string; url: string; delivery: LinkDelivery; deliveryError?: string }> {
    const gateway = this.requireGateway();
    const expiresAt = new Date(Date.now() + this.config.PAYMENT_LINK_EXPIRY_HOURS * 3_600_000);

    const { paymentId, linkId, amountPaise, b } = await this.db.transaction(async (tx) => {
      const b = await this.core.lockBooking(tx, bookingId);
      if (!(OPEN_STATES as readonly string[]).includes(b.state)) {
        throw new ConflictException(`Booking is ${b.state}`);
      }
      const { dueAfterPending } = await this.core.balance(tx, b);
      const amountPaise = input.amountPaise ?? dueAfterPending;
      if (amountPaise <= 0) {
        throw new ConflictException(
          'Nothing is due (after payments and links awaiting the customer)',
        );
      }
      if (amountPaise > dueAfterPending) {
        throw new UnprocessableEntityException(
          `Amount is more than the balance still due (${dueAfterPending} paise, after payments and links awaiting the customer)`,
        );
      }
      const paymentId = randomUUID();
      // Our own id doubles as the gateway's link id: alphanumeric and _, under 50 characters.
      const linkId = `nav_${paymentId.replaceAll('-', '')}`;
      await tx.insert(payment).values({
        id: paymentId,
        bookingId,
        state: 'PENDING',
        method: 'GATEWAY',
        amountPaise,
        recordedByUserId: auth.userId,
        recordedAt: new Date(),
        gatewayLinkId: linkId,
        gatewayLinkExpiresAt: expiresAt,
      });
      await this.transitions.created(
        tx,
        paymentMachine,
        paymentId,
        'PENDING',
        systemActor(auth.userId),
        { correlationId, reason: `Payment link for ${amountPaise} paise (${gateway.provider})` },
      );
      await this.audit.record(
        {
          action: 'payment.link_created',
          correlationId,
          actorUserId: auth.userId,
          entityType: 'payment',
          entityId: paymentId,
          metadata: { bookingId, amountPaise, provider: gateway.provider, linkId },
        },
        tx,
      );
      return { paymentId, linkId, amountPaise, b };
    });

    const [booker] = await this.db.select().from(appUser).where(eq(appUser.id, b.bookerUserId));
    if (!booker?.phone) {
      await this.failLink(paymentId, 'The booker has no phone number', null, correlationId);
      throw new UnprocessableEntityException('The booker needs a phone number for a payment link');
    }

    let url: string;
    try {
      const link = await gateway.createLink({
        linkId,
        amountPaise,
        purpose: `Navagraha pilgrimage booking ${b.reference}`,
        customer: { phone: booker.phone, name: booker.displayName },
        expiresAt,
        returnUrl: this.config.PUBLIC_WEB_URL
          ? `${this.config.PUBLIC_WEB_URL.replace(/\/+$/, '')}/paid`
          : undefined,
      });
      url = link.url;
    } catch (err) {
      const message = (err as Error).message;
      await this.failLink(
        paymentId,
        `The gateway did not create the link: ${message}`,
        auth.userId,
        correlationId,
      );
      throw new BadGatewayException(`The payment gateway did not create the link: ${message}`);
    }
    await this.db.update(payment).set({ gatewayLinkUrl: url }).where(eq(payment.id, paymentId));

    if (!this.whatsapp || options.notify === false) return { paymentId, url, delivery: 'NOT_SENT' };
    const rupees = (amountPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });
    const until = expiresAt.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    const greeting = booker.displayName ? `Namaste ${booker.displayName},` : 'Namaste,';
    try {
      await this.whatsapp.sendText(
        booker.phone,
        `${greeting}\n\nPlease pay ₹${rupees} for your Navagraha pilgrimage booking ${b.reference}:\n${url}\n\n` +
          `This secure link (Cashfree) works until ${until}. Your booking is confirmed once ` +
          'the payment is received and every arrangement is in place.',
      );
    } catch (err) {
      const message = (err as Error).message;
      this.logger.warn(`Payment link WhatsApp to ${maskPhone(booker.phone)} failed: ${message}`);
      await this.audit.record({
        action: 'payment.link_send_failed',
        correlationId,
        actorUserId: auth.userId,
        entityType: 'payment',
        entityId: paymentId,
        metadata: { channel: 'WHATSAPP', error: message },
      });
      return { paymentId, url, delivery: 'NOT_SENT', deliveryError: message };
    }
    await this.audit.record({
      action: 'payment.link_sent',
      correlationId,
      actorUserId: auth.userId,
      entityType: 'payment',
      entityId: paymentId,
      metadata: { channel: 'WHATSAPP', to: maskPhone(booker.phone) },
    });
    return { paymentId, url, delivery: 'WHATSAPP' };
  }

  private async failLink(
    paymentId: string,
    reason: string,
    userId: string | null,
    correlationId: string,
  ) {
    await this.db.transaction(async (tx) => {
      await this.transitions.move(
        tx,
        paymentMachine,
        paymentId,
        'PENDING',
        'FAILED',
        systemActor(userId),
        {
          correlationId,
          reason,
        },
      );
      await tx.update(payment).set({ reason }).where(eq(payment.id, paymentId));
    });
  }

  // ---------------------------------------------------------------- cancel

  /** Stops an unpaid link. If the customer paid meanwhile, the payment is recorded instead. */
  async cancel(paymentId: string, auth: AuthContext, correlationId: string) {
    const gateway = this.requireGateway();
    const p = await this.linkPayment(paymentId);
    if (p.state !== 'PENDING') throw new ConflictException(`Payment is ${p.state}`);
    try {
      await gateway.cancelLink(p.gatewayLinkId!);
    } catch (err) {
      // A link that was paid or expired meanwhile cannot be cancelled; reconcile tells which.
      this.logger.warn(`Cancel of ${p.gatewayLinkId} refused: ${(err as Error).message}`);
    }
    await this.audit.record({
      action: 'payment.link_cancel_requested',
      correlationId,
      actorUserId: auth.userId,
      entityType: 'payment',
      entityId: paymentId,
    });
    return this.reconcile(paymentId, correlationId, auth.userId);
  }

  // ---------------------------------------------------------------- reconcile

  /**
   * Reads the link, its paid orders and their payments from the gateway and moves our
   * payment to match. Idempotent: running it again changes nothing (NFR-09).
   */
  async reconcile(paymentId: string, correlationId: string, triggeredBy: string | null = null) {
    const gateway = this.requireGateway();
    const p = await this.linkPayment(paymentId);
    if (p.state !== 'PENDING' && p.state !== 'FAILED') return { state: p.state, changed: false };

    let link;
    let captures: GatewayCapture[];
    try {
      link = await gateway.getLink(p.gatewayLinkId!);
      captures = await gateway.successfulPayments(p.gatewayLinkId!);
    } catch (err) {
      throw new BadGatewayException(
        `Could not read the payment from the gateway: ${(err as Error).message}`,
      );
    }
    const capturedPaise = captures.reduce((sum, c) => sum + c.amountPaise, 0);

    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(payment)
        .where(eq(payment.id, paymentId))
        .for('update');
      const state = current!.state;
      if (state !== 'PENDING' && state !== 'FAILED') return { state, changed: false };

      if (capturedPaise > 0) {
        await this.core.lockBooking(tx, current!.bookingId);
        const last = captures.at(-1)!;
        // EC-25: a UPI payment that completes after the link was marked failed still counts.
        await this.transitions.move(tx, paymentMachine, paymentId, state, 'SUCCESS', gatewayActor, {
          correlationId,
          reason: `Gateway reports ${capturedPaise} paise captured (${last.method ?? 'payment'} ${last.paymentId})`,
        });
        await tx
          .update(payment)
          .set({
            capturedPaise,
            gatewayOrderId: last.orderId,
            gatewayPaymentId: last.paymentId,
            reference: last.paymentId,
            receivedOn: (last.completedAt ?? new Date().toISOString()).slice(0, 10),
            gatewayResponse: { link: link.raw, payments: captures.map((c) => c.raw) },
            confirmedAt: new Date(),
          })
          .where(eq(payment.id, paymentId));
        await this.audit.record(
          {
            action: 'payment.gateway_captured',
            correlationId,
            actorUserId: triggeredBy,
            entityType: 'payment',
            entityId: paymentId,
            metadata: {
              bookingId: current!.bookingId,
              amountPaise: current!.amountPaise,
              capturedPaise,
              gatewayPaymentId: last.paymentId,
            },
          },
          tx,
        );
        if (capturedPaise !== current!.amountPaise) {
          this.logger.warn(
            `Payment ${paymentId}: captured ${capturedPaise} paise against a link for ${current!.amountPaise}`,
          );
        }
        await this.core.reevaluate(tx, current!.bookingId, triggeredBy, correlationId);
        return { state: 'SUCCESS' as const, changed: true };
      }

      if (state === 'PENDING' && (link.status === 'EXPIRED' || link.status === 'CANCELLED')) {
        const reason = `Payment link ${link.status.toLowerCase()} without payment`;
        await this.transitions.move(
          tx,
          paymentMachine,
          paymentId,
          'PENDING',
          'FAILED',
          gatewayActor,
          {
            correlationId,
            reason,
          },
        );
        await tx
          .update(payment)
          .set({ reason, gatewayResponse: { link: link.raw } })
          .where(eq(payment.id, paymentId));
        return { state: 'FAILED' as const, changed: true };
      }
      return { state, changed: false };
    });
  }

  /** Safety net for lost webhooks: every unpaid link that has not expired long ago. */
  async reconcileOpenLinks() {
    if (!this.gateway) return;
    const since = new Date(Date.now() - 2 * 24 * 3_600_000);
    const open = await this.db
      .select({ id: payment.id })
      .from(payment)
      .where(
        and(
          eq(payment.state, 'PENDING'),
          isNotNull(payment.gatewayLinkId),
          gt(payment.gatewayLinkExpiresAt, since),
        ),
      );
    for (const { id } of open) {
      try {
        await this.reconcile(id, `reconcile-${randomUUID()}`);
      } catch (err) {
        this.logger.warn(`Reconcile of payment ${id} failed: ${(err as Error).message}`);
      }
    }
  }

  // ---------------------------------------------------------------- webhooks

  /**
   * Gateway webhook (FS §32 POST /payments/webhook). Verified and stored once; returns quickly
   * (NFR-06) and reconciles afterwards. Returns false when the signature does not match.
   */
  async receiveWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
    correlationId: string,
  ): Promise<boolean> {
    const gateway = this.requireGateway();
    if (!gateway.verifyWebhook(rawBody, headers)) {
      await this.audit.record({
        action: 'security.webhook_signature_invalid',
        correlationId,
        entityType: 'gateway_event',
        metadata: { provider: gateway.provider },
      });
      return false;
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    } catch {
      payload = { unparsed: rawBody.toString('utf8').slice(0, 10_000) };
    }
    const linkId = linkIdOf(payload);
    const eventKey =
      headers['x-idempotency-key'] ?? createHash('sha256').update(rawBody).digest('hex');
    const [stored] = await this.db
      .insert(gatewayEvent)
      .values({
        provider: gateway.provider,
        eventKey,
        eventType: typeof payload.type === 'string' ? payload.type : null,
        linkId,
        payload,
      })
      .onConflictDoNothing()
      .returning({ id: gatewayEvent.id });
    // A repeat delivery: already handled (NFR-09).
    if (!stored) return true;

    const refundId = refundIdOf(payload);
    setImmediate(() => void this.processEvent(stored.id, linkId, refundId, correlationId));
    return true;
  }

  private async processEvent(
    eventId: string,
    linkId: string | null,
    gatewayRefundId: string | null,
    correlationId: string,
  ) {
    let error: string | null = null;
    try {
      if (gatewayRefundId) {
        // REFUND_STATUS_WEBHOOK: check the refund with the gateway.
        const id = await this.refunds.idByGatewayRefundId(gatewayRefundId);
        if (id) await this.refunds.reconcile(id, correlationId);
        else error = `No refund ${gatewayRefundId}`;
        return;
      }
      const [p] = linkId
        ? await this.db
            .select({ id: payment.id })
            .from(payment)
            .where(eq(payment.gatewayLinkId, linkId))
        : [];
      if (p) await this.reconcile(p.id, correlationId);
      else error = linkId ? `No payment for link ${linkId}` : 'Not a payment-link event';
    } catch (err) {
      error = (err as Error).message;
      this.logger.warn(`Webhook event ${eventId} failed: ${error}`);
    } finally {
      await this.db
        .update(gatewayEvent)
        .set({ processedAt: new Date(), error })
        .where(eq(gatewayEvent.id, eventId));
    }
  }

  private async linkPayment(paymentId: string) {
    const [p] = await this.db.select().from(payment).where(eq(payment.id, paymentId));
    if (!p || !p.gatewayLinkId) throw new NotFoundException('Payment link not found');
    return p;
  }

  /** Booking id of a payment, for the controller to return the refreshed booking. */
  async bookingOf(paymentId: string) {
    return (await this.linkPayment(paymentId)).bookingId;
  }
}

/**
 * Our link id from a Cashfree webhook: payment webhooks carry it in order_tags
 * (2025-01-01+), payment-link webhooks at data.link_id. Only `nav_` ids are ours.
 */
export function linkIdOf(payload: Record<string, unknown>): string | null {
  const data = (payload.data ?? {}) as Record<string, unknown>;
  const order = (data.order ?? {}) as Record<string, unknown>;
  const tags = (order.order_tags ?? {}) as Record<string, unknown>;
  for (const candidate of [tags.link_id, data.link_id]) {
    if (typeof candidate === 'string' && /^nav_[0-9a-f]{32}$/.test(candidate)) return candidate;
  }
  return null;
}

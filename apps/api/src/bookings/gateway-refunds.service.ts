import { randomUUID } from 'node:crypto';
import { schema, type Database } from '@navagraha/db';
import { checkOfflineConfirmation, inActingOrder, refundMachine } from '@navagraha/domain';
import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, eq, gt, isNotNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { formatPaise } from '../common/money.js';
import { DB } from '../db/db.module.js';
import {
  GatewayError,
  PAYMENT_GATEWAY,
  type GatewayRefund,
  type PaymentGateway,
} from '../payments/gateway.js';
import {
  systemActor,
  TransitionService,
  type Actor,
  type Tx,
} from '../state/transition.service.js';
import { BookingCore } from './booking-core.js';
import { CancellationsService } from './cancellations.service.js';

const { payment, refund } = schema;

const gatewayActor: Actor = { userId: null, roles: ['PAYMENT_GATEWAY'] };
const FINAL_FAILURE = ['CANCELLED', 'REJECTED'];

type RefundRow = typeof refund.$inferSelect;

/**
 * Refunds through the payment gateway (D-11 Cashfree, D-04 §2.2, D-19 extension).
 *
 * 1. Finance or a manager asks for a refund to the customer's online payment (INITIATED).
 * 2. A different Finance / manager user approves it; only then is it sent to the gateway.
 * 3. The gateway's own record of the refund (webhook-triggered, periodic or on request)
 *    moves it to CONFIRMED — or FAILED if the gateway cancels or rejects it.
 */
@Injectable()
export class GatewayRefundsService {
  private readonly logger = new Logger('GatewayRefunds');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway | null,
    @Inject(TransitionService) private readonly transitions: TransitionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(BookingCore) private readonly core: BookingCore,
    @Inject(CancellationsService) private readonly cancellations: CancellationsService,
  ) {}

  private requireGateway() {
    if (!this.gateway) {
      throw new ServiceUnavailableException('No payment gateway is configured on this server');
    }
    return this.gateway;
  }

  /** Online payments on a booking and how much of each can still go back through the gateway. */
  async refundable(tx: Database | Tx, bookingId: string, except?: string) {
    const ps = await tx.select().from(payment).where(eq(payment.bookingId, bookingId));
    const rs = await tx.select().from(refund).where(eq(refund.bookingId, bookingId));
    return ps
      .filter(
        (p) =>
          p.method === 'GATEWAY' &&
          p.gatewayOrderId &&
          (p.state === 'SUCCESS' || p.state === 'PARTIALLY_REFUNDED'),
      )
      .map((p) => {
        const inFlight = rs
          .filter((r) => r.paymentId === p.id && r.state === 'INITIATED' && r.id !== except)
          .reduce((s, r) => s + r.amountPaise, 0);
        return { payment: p, availablePaise: p.capturedPaise - p.refundedPaise - inFlight };
      })
      .sort((a, b) => b.payment.createdAt.getTime() - a.payment.createdAt.getTime());
  }

  // ---------------------------------------------------------------- 1. request

  async request(
    bookingId: string,
    input: { amountPaise: number; reason: string },
    auth: AuthContext,
    correlationId: string,
  ) {
    this.requireGateway();
    await this.db.transaction(async (tx) => {
      const b = await this.core.lockBooking(tx, bookingId);
      const { limit, cancellationId } = await this.core.refundRoom(tx, b);
      if (limit <= 0) throw new ConflictException('Nothing is due to be refunded on this booking');
      if (input.amountPaise > limit) {
        throw new UnprocessableEntityException(`At most ${formatPaise(limit)} can be refunded`);
      }
      const sources = await this.refundable(tx, bookingId);
      if (!sources.length) {
        throw new ConflictException('There is no online payment on this booking to refund to');
      }
      // Newest online payment that can take the whole amount: one gateway refund per order.
      const source = sources.find((s) => s.availablePaise >= input.amountPaise);
      if (!source) {
        const most = Math.max(...sources.map((s) => s.availablePaise));
        throw new UnprocessableEntityException(
          `At most ${formatPaise(Math.max(0, most))} can go back to one online payment; refund the rest separately`,
        );
      }
      const id = randomUUID();
      await tx.insert(refund).values({
        id,
        bookingId,
        cancellationId,
        state: 'INITIATED',
        method: 'GATEWAY',
        amountPaise: input.amountPaise,
        initiatedByUserId: auth.userId,
        reason: input.reason,
        paymentId: source.payment.id,
        // Cashfree: 3–40 alphanumeric characters.
        gatewayRefundId: `r${id.replaceAll('-', '')}`,
      });
      await this.transitions.created(tx, refundMachine, id, 'INITIATED', this.actor(auth), {
        correlationId,
        reason: 'Refund through the gateway requested; a second person must approve it (D-19)',
      });
      await this.audit.record(
        {
          action: 'refund.gateway_requested',
          correlationId,
          actorUserId: auth.userId,
          entityType: 'refund',
          entityId: id,
          metadata: { bookingId, amountPaise: input.amountPaise, paymentId: source.payment.id },
        },
        tx,
      );
    });
  }

  // ---------------------------------------------------------------- 2. approve and send

  /** A different Finance / manager user approves; the refund is then sent to the gateway. */
  async approve(refundId: string, auth: AuthContext, correlationId: string) {
    this.requireGateway();
    await this.db.transaction(async (tx) => {
      const r = await this.gatewayRefund(tx, refundId);
      if (r.state !== 'INITIATED' || r.approvedByUserId) {
        throw new ConflictException('This refund was already approved or closed');
      }
      await this.core.lockBooking(tx, r.bookingId);
      const check = checkOfflineConfirmation({
        recordedByUserId: r.initiatedByUserId!,
        confirmerUserId: auth.userId,
        confirmerRoles: auth.roles,
      });
      if (!check.ok) {
        await this.audit.record({
          action: 'security.two_person_rule_blocked',
          correlationId,
          actorUserId: auth.userId,
          entityType: 'refund',
          entityId: r.id,
          metadata: { reason: check.reason },
        });
        throw new ForbiddenException(
          check.reason === 'SAME_PERSON'
            ? 'A different person must approve a refund you asked for (D-19)'
            : 'Only Finance or an Operations Manager can approve refunds',
        );
      }
      const source = (await this.refundable(tx, r.bookingId, r.id)).find(
        (s) => s.payment.id === r.paymentId,
      );
      if (!source || source.availablePaise < r.amountPaise) {
        throw new ConflictException('The online payment no longer has that much to refund');
      }
      await tx
        .update(refund)
        .set({ approvedByUserId: auth.userId, approvedAt: new Date() })
        .where(eq(refund.id, r.id));
      await this.audit.record(
        {
          action: 'refund.gateway_approved',
          correlationId,
          actorUserId: auth.userId,
          entityType: 'refund',
          entityId: r.id,
          metadata: { bookingId: r.bookingId, amountPaise: r.amountPaise },
        },
        tx,
      );
    });
    await this.send(refundId, auth.userId, correlationId);
  }

  /**
   * Sends an approved refund. Safe to repeat: the gateway refund id doubles as the idempotency
   * key, so "Send again" after a network failure cannot refund twice.
   */
  async send(refundId: string, triggeredBy: string | null, correlationId: string) {
    const gateway = this.requireGateway();
    const r = await this.gatewayRefund(this.db, refundId);
    if (r.state !== 'INITIATED' || !r.approvedByUserId) {
      throw new ConflictException('Only an approved, open refund can be sent');
    }
    const [p] = await this.db.select().from(payment).where(eq(payment.id, r.paymentId!));
    let result: GatewayRefund;
    try {
      result = await gateway.createRefund({
        orderId: p!.gatewayOrderId!,
        refundId: r.gatewayRefundId!,
        amountPaise: r.amountPaise,
        note: r.reason ?? 'Refund',
      });
    } catch (err) {
      const message = (err as Error).message;
      const refused = err instanceof GatewayError && !!err.status && err.status < 500;
      if (refused) {
        // The gateway said no: nothing went out.
        await this.db.transaction((tx) =>
          this.fail(
            tx,
            r,
            `The gateway refused the refund: ${message}`,
            systemActor(triggeredBy),
            correlationId,
          ),
        );
        throw new BadGatewayException(`The payment gateway refused the refund: ${message}`);
      }
      // Unknown outcome (network, 5xx): keep it open; "Send again" or the next check settles it.
      await this.db.update(refund).set({ gatewayStatus: 'NOT_SENT' }).where(eq(refund.id, r.id));
      throw new BadGatewayException(`Could not reach the payment gateway: ${message}`);
    }
    await this.db
      .update(refund)
      .set({ sentAt: new Date(), gatewayStatus: result.status, gatewayResponse: result.raw })
      .where(eq(refund.id, r.id));
    await this.audit.record({
      action: 'refund.gateway_sent',
      correlationId,
      actorUserId: triggeredBy,
      entityType: 'refund',
      entityId: r.id,
      metadata: { status: result.status, gatewayRefundId: result.gatewayRefundId },
    });
    await this.apply(r.id, result, correlationId);
  }

  // ---------------------------------------------------------------- 3. gateway status

  /** Reads the refund from the gateway and settles it when the gateway says it is final. */
  async reconcile(refundId: string, correlationId: string) {
    const gateway = this.requireGateway();
    const r = await this.gatewayRefund(this.db, refundId);
    if (r.state !== 'INITIATED' || !r.sentAt) return { state: r.state, changed: false };
    const [p] = await this.db.select().from(payment).where(eq(payment.id, r.paymentId!));
    let result: GatewayRefund;
    try {
      result = await gateway.getRefund(p!.gatewayOrderId!, r.gatewayRefundId!);
    } catch (err) {
      throw new BadGatewayException(
        `Could not read the refund from the gateway: ${(err as Error).message}`,
      );
    }
    return this.apply(r.id, result, correlationId);
  }

  private async apply(refundId: string, result: GatewayRefund, correlationId: string) {
    return this.db.transaction(async (tx) => {
      const [r] = await tx.select().from(refund).where(eq(refund.id, refundId)).for('update');
      if (!r || r.state !== 'INITIATED') return { state: r?.state, changed: false };
      await this.core.lockBooking(tx, r.bookingId);
      await tx
        .update(refund)
        .set({ gatewayStatus: result.status, gatewayResponse: result.raw })
        .where(eq(refund.id, r.id));
      if (result.status === 'SUCCESS') {
        await this.cancellations.settleRefund(tx, r, gatewayActor, {
          correlationId,
          reason: `Gateway reports the refund paid (${result.gatewayRefundId ?? r.gatewayRefundId})`,
          confirmedByUserId: null,
        });
        return { state: 'CONFIRMED' as const, changed: true };
      }
      if (FINAL_FAILURE.includes(result.status)) {
        await this.fail(
          tx,
          r,
          `Gateway ${result.status.toLowerCase()} the refund`,
          gatewayActor,
          correlationId,
        );
        return { state: 'FAILED' as const, changed: true };
      }
      return { state: r.state, changed: false };
    });
  }

  private async fail(tx: Tx, r: RefundRow, reason: string, actor: Actor, correlationId: string) {
    await this.transitions.move(tx, refundMachine, r.id, 'INITIATED', 'FAILED', actor, {
      correlationId,
      reason,
    });
    await tx.update(refund).set({ reason }).where(eq(refund.id, r.id));
    await this.audit.record(
      {
        action: 'refund.gateway_failed',
        correlationId,
        actorUserId: actor.userId,
        entityType: 'refund',
        entityId: r.id,
        metadata: { reason },
      },
      tx,
    );
  }

  /** Safety net for lost webhooks: refunds sent in the last 30 days and not final yet. */
  async reconcileOpen() {
    if (!this.gateway) return;
    const since = new Date(Date.now() - 30 * 24 * 3_600_000);
    const open = await this.db
      .select({ id: refund.id })
      .from(refund)
      .where(
        and(eq(refund.state, 'INITIATED'), isNotNull(refund.sentAt), gt(refund.sentAt, since)),
      );
    for (const { id } of open) {
      try {
        await this.reconcile(id, `reconcile-${randomUUID()}`);
      } catch (err) {
        this.logger.warn(`Reconcile of refund ${id} failed: ${(err as Error).message}`);
      }
    }
  }

  /** For webhooks: our refund by its gateway refund id. */
  async idByGatewayRefundId(gatewayRefundId: string) {
    const [r] = await this.db
      .select({ id: refund.id })
      .from(refund)
      .where(eq(refund.gatewayRefundId, gatewayRefundId));
    return r?.id ?? null;
  }

  async bookingOf(refundId: string) {
    return (await this.gatewayRefund(this.db, refundId)).bookingId;
  }

  private async gatewayRefund(tx: Database | Tx, refundId: string) {
    const [r] = await tx.select().from(refund).where(eq(refund.id, refundId));
    if (!r || r.method !== 'GATEWAY') throw new NotFoundException('Gateway refund not found');
    return r;
  }

  private actor(auth: AuthContext): Actor {
    return { userId: auth.userId, roles: inActingOrder(auth.roles) };
  }
}

/** Our refund id from a Cashfree refund webhook (data.refund.refund_id). */
export function refundIdOf(payload: Record<string, unknown>): string | null {
  const data = (payload.data ?? {}) as Record<string, unknown>;
  const r = (data.refund ?? {}) as Record<string, unknown>;
  return typeof r.refund_id === 'string' && /^r[0-9a-f]{32}$/.test(r.refund_id)
    ? r.refund_id
    : null;
}

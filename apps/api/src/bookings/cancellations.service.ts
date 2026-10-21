import { randomUUID } from 'node:crypto';
import { schema, type Database } from '@navagraha/db';
import {
  allocateRefund,
  bookingMachine,
  cancellationMachine,
  checkOfflineConfirmation,
  fulfilmentComponentMachine,
  inActingOrder,
  itineraryMachine,
  paymentMachine,
  refundMachine,
  tripMachine,
} from '@navagraha/domain';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { DB } from '../db/db.module.js';
import {
  TransitionService,
  systemActor,
  type Actor,
  type Tx,
} from '../state/transition.service.js';
import { formatPaise } from '../common/money.js';
import { BookingCore, today, type BookingRow } from './booking-core.js';
import type { CancellationInput, CancellationReviewInput, RefundInput } from './booking.schemas.js';
import { ChangesService } from './changes.service.js';

const {
  booking,
  cancellation,
  refund,
  payment,
  fulfilmentComponent: component,
  itinerary,
  trip,
} = schema;
const CANCELLABLE = ['REQUESTED', 'PENDING_CONFIRMATION', 'CONFIRMED'];
/** Trips that have not started yet; once a trip is under way it is handled as an incident. */
const NOT_STARTED = ['SCHEDULED', 'DRIVER_ASSIGNED', 'PICKUP_READY'];

/**
 * Cancellations (D-04 §4.5) and refunds (D-04 §2.2, D-19 extension). Until D-06 sets refund
 * tiers, the refund amount is proposed by a coordinator and approved by an Operations Manager.
 */
@Injectable()
export class CancellationsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(TransitionService) private readonly transitions: TransitionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(BookingCore) private readonly core: BookingCore,
    @Inject(ChangesService) private readonly changes: ChangesService,
  ) {}

  async request(
    bookingId: string,
    input: z.infer<typeof CancellationInput>,
    auth: AuthContext,
    correlationId: string,
  ) {
    await this.db.transaction(async (tx) => {
      const b = await this.core.lockBooking(tx, bookingId);
      await this.assertCancellable(tx, b);
      const [open] = await tx
        .select({ id: cancellation.id })
        .from(cancellation)
        .where(
          and(
            eq(cancellation.bookingId, bookingId),
            inArray(cancellation.state, ['REQUESTED', 'REVIEWING', 'APPROVED', 'REFUND_PENDING']),
          ),
        );
      if (open) throw new ConflictException('This booking already has an open cancellation');
      const id = randomUUID();
      await tx.insert(cancellation).values({
        id,
        bookingId,
        state: 'REQUESTED',
        reason: input.reason,
        requestedVia: input.requestedVia,
        requestedByUserId: auth.userId,
      });
      await this.transitions.created(tx, cancellationMachine, id, 'REQUESTED', this.actor(auth), {
        correlationId,
        sourceChannel: input.requestedVia,
        reason: input.reason,
      });
      await this.audit.record(
        {
          action: 'cancellation.requested',
          correlationId,
          actorUserId: auth.userId,
          entityType: 'cancellation',
          entityId: id,
          metadata: { bookingId },
        },
        tx,
      );
    });
    return bookingId;
  }

  /** The coordinator proposes the refund. Can be repeated while under review. */
  async review(
    id: string,
    input: z.infer<typeof CancellationReviewInput>,
    auth: AuthContext,
    correlationId: string,
  ) {
    return this.db.transaction(async (tx) => {
      const c = await this.load(tx, id);
      const b = await this.core.lockBooking(tx, c.bookingId);
      const { refundablePaise } = await this.core.balance(tx, b);
      if (input.refundPaise > refundablePaise) {
        throw new UnprocessableEntityException(
          `The refund cannot be more than the money received (${formatPaise(refundablePaise)})`,
        );
      }
      if (c.state === 'REQUESTED') {
        await this.transitions.move(
          tx,
          cancellationMachine,
          c.id,
          'REQUESTED',
          'REVIEWING',
          this.actor(auth),
          { correlationId },
        );
      } else if (c.state !== 'REVIEWING') {
        throw new ConflictException(
          `This cancellation is ${c.state.toLowerCase().replace('_', ' ')}`,
        );
      }
      await tx
        .update(cancellation)
        .set({
          refundPaise: input.refundPaise,
          refundNote: input.refundNote,
          reviewedByUserId: auth.userId,
        })
        .where(eq(cancellation.id, c.id));
      await this.audit.record(
        {
          action: 'cancellation.reviewed',
          correlationId,
          actorUserId: auth.userId,
          entityType: 'cancellation',
          entityId: c.id,
          metadata: { refundPaise: input.refundPaise },
        },
        tx,
      );
      return c.bookingId;
    });
  }

  /** An Operations Manager approves: the booking is cancelled and suppliers released. */
  async approve(id: string, auth: AuthContext, correlationId: string) {
    const actor = this.actor(auth);
    const sys = systemActor(auth.userId);
    return this.db.transaction(async (tx) => {
      const c = await this.load(tx, id);
      const b = await this.core.lockBooking(tx, c.bookingId);
      if (c.state !== 'REVIEWING' || c.refundPaise == null)
        throw new ConflictException('Review the cancellation and set the refund first');
      await this.assertCancellable(tx, b);
      const bal = await this.core.balance(tx, b);
      if (bal.pendingPaise > 0)
        throw new ConflictException('Confirm or reject the payments awaiting confirmation first');
      if (c.refundPaise > bal.refundablePaise) {
        throw new UnprocessableEntityException(
          `The refund cannot be more than the money received (${formatPaise(bal.refundablePaise)})`,
        );
      }

      await this.transitions.move(tx, cancellationMachine, c.id, 'REVIEWING', 'APPROVED', actor, {
        correlationId,
        reason: c.reason,
      });
      await tx
        .update(cancellation)
        .set({ decidedByUserId: auth.userId })
        .where(eq(cancellation.id, c.id));

      const opts = { correlationId, reason: `Booking cancelled: ${c.reason}` };
      await this.changes.withdrawOpen(
        tx,
        b.id,
        actor,
        auth.userId,
        correlationId,
        'Booking cancelled',
      );
      await this.transitions.move(tx, bookingMachine, b.id, b.state, 'CANCELLED', sys, opts);
      for (const x of await tx.select().from(component).where(eq(component.bookingId, b.id))) {
        if (x.state === 'CONFIRMED')
          await this.transitions.move(
            tx,
            fulfilmentComponentMachine,
            x.id,
            'CONFIRMED',
            'RELEASED',
            sys,
            opts,
          );
        else if (x.state === 'PENDING' || x.state === 'REQUESTED')
          await this.transitions.move(
            tx,
            fulfilmentComponentMachine,
            x.id,
            x.state,
            'CANCELLED',
            sys,
            opts,
          );
      }
      if (b.activeItineraryId) {
        const [it] = await tx.select().from(itinerary).where(eq(itinerary.id, b.activeItineraryId));
        if (it && !(itineraryMachine.terminal as readonly string[]).includes(it.state)) {
          await this.transitions.move(
            tx,
            itineraryMachine,
            it.id,
            it.state,
            'ABANDONED',
            sys,
            opts,
          );
        }
      }
      const [t] = await tx.select().from(trip).where(eq(trip.bookingId, b.id));
      if (t) await this.transitions.move(tx, tripMachine, t.id, t.state, 'CANCELLED', sys, opts);

      if (c.refundPaise > 0) {
        await this.transitions.move(
          tx,
          cancellationMachine,
          c.id,
          'APPROVED',
          'REFUND_PENDING',
          sys,
          { correlationId, reason: `Refund of ${formatPaise(c.refundPaise)} to be paid` },
        );
      } else {
        await this.transitions.move(
          tx,
          cancellationMachine,
          c.id,
          'APPROVED',
          'CLOSED_NO_REFUND',
          sys,
          { correlationId, reason: 'No refund due' },
        );
      }
      await this.audit.record(
        {
          action: 'booking.cancelled',
          correlationId,
          actorUserId: auth.userId,
          entityType: 'booking',
          entityId: b.id,
          metadata: { cancellationId: c.id, refundPaise: c.refundPaise },
        },
        tx,
      );
      return b.id;
    });
  }

  async reject(id: string, reason: string, auth: AuthContext, correlationId: string) {
    const actor = this.actor(auth);
    return this.db.transaction(async (tx) => {
      const c = await this.load(tx, id);
      await this.core.lockBooking(tx, c.bookingId);
      if (c.state === 'REQUESTED') {
        await this.transitions.move(
          tx,
          cancellationMachine,
          c.id,
          'REQUESTED',
          'REVIEWING',
          actor,
          { correlationId },
        );
      } else if (c.state !== 'REVIEWING') {
        throw new ConflictException(
          `This cancellation is ${c.state.toLowerCase().replace('_', ' ')}`,
        );
      }
      await this.transitions.move(tx, cancellationMachine, c.id, 'REVIEWING', 'REJECTED', actor, {
        correlationId,
        reason,
      });
      await tx
        .update(cancellation)
        .set({ decisionReason: reason, decidedByUserId: auth.userId })
        .where(eq(cancellation.id, c.id));
      return c.bookingId;
    });
  }

  // ---------------------------------------------------------------- refunds (D-19 extension)

  /**
   * Step 1: Finance or a manager records a refund they paid. Allowed up to the approved
   * cancellation refund, or — on a live booking — up to what was overpaid after a change.
   */
  async recordRefund(
    bookingId: string,
    input: z.infer<typeof RefundInput>,
    auth: AuthContext,
    correlationId: string,
  ) {
    if (input.paidOn > today()) throw new BadRequestException('paidOn cannot be in the future');
    await this.db.transaction(async (tx) => {
      const b = await this.core.lockBooking(tx, bookingId);
      const { limit, cancellationId } = await this.core.refundRoom(tx, b);
      if (limit <= 0) throw new ConflictException('Nothing is due to be refunded on this booking');
      if (input.amountPaise > limit)
        throw new UnprocessableEntityException(`At most ${formatPaise(limit)} can be refunded`);
      const id = randomUUID();
      await tx.insert(refund).values({
        id,
        bookingId,
        cancellationId,
        state: 'INITIATED',
        method: input.method,
        amountPaise: input.amountPaise,
        reference: input.reference,
        paidOn: input.paidOn,
        initiatedByUserId: auth.userId,
      });
      await this.transitions.created(tx, refundMachine, id, 'INITIATED', this.actor(auth), {
        correlationId,
        reason: 'Refund paid out, awaiting second-person confirmation (D-19)',
      });
      await this.audit.record(
        {
          action: 'refund.recorded',
          correlationId,
          actorUserId: auth.userId,
          entityType: 'refund',
          entityId: id,
          metadata: { bookingId, amountPaise: input.amountPaise, method: input.method },
        },
        tx,
      );
    });
    return bookingId;
  }

  /** Step 2: a different Finance / manager user confirms the money went back. */
  async confirmRefund(refundId: string, auth: AuthContext, correlationId: string) {
    return this.db.transaction(async (tx) => {
      const r = await this.loadRefund(tx, refundId);
      if (r.method === 'GATEWAY') {
        throw new ConflictException('Refunds through the gateway are confirmed by the gateway');
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
            ? 'A different person must confirm a refund you recorded (D-19)'
            : 'Only Finance or an Operations Manager can confirm refunds',
        );
      }
      await this.settleRefund(tx, r, systemActor(auth.userId), {
        correlationId,
        reason: 'Refund confirmed by a second person (D-19)',
        confirmedByUserId: auth.userId,
      });
      return r.bookingId;
    });
  }

  /**
   * Money is back with the customer: the refund is CONFIRMED, the payments it came from are
   * marked (partially) refunded, and the cancellation closes or the gate is re-checked.
   * Offline refunds are split newest payment first; a gateway refund comes from its payment.
   */
  async settleRefund(
    tx: Tx,
    r: typeof refund.$inferSelect,
    actor: Actor,
    opts: { correlationId: string; reason: string; confirmedByUserId: string | null },
  ) {
    const { correlationId } = opts;
    await this.transitions.move(tx, refundMachine, r.id, 'INITIATED', 'CONFIRMED', actor, {
      correlationId,
      reason: opts.reason,
    });

    const ps = (
      await tx
        .select()
        .from(payment)
        .where(eq(payment.bookingId, r.bookingId))
        .orderBy(asc(payment.createdAt))
    ).filter((p) => p.state === 'SUCCESS' || p.state === 'PARTIALLY_REFUNDED');
    let allocations: { paymentId: string; paise: number }[];
    try {
      allocations = r.paymentId
        ? allocateRefund(
            ps.filter((p) => p.id === r.paymentId),
            r.amountPaise,
          )
        : allocateRefund(ps, r.amountPaise);
    } catch (e) {
      throw new ConflictException((e as Error).message);
    }
    for (const a of allocations) {
      const p = ps.find((x) => x.id === a.paymentId)!;
      const refunded = p.refundedPaise + a.paise;
      const to = refunded === p.capturedPaise ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
      await this.transitions.move(tx, paymentMachine, p.id, p.state, to, actor, {
        correlationId,
        reason: `Refund of ${formatPaise(a.paise)} confirmed`,
      });
      await tx.update(payment).set({ refundedPaise: refunded }).where(eq(payment.id, p.id));
    }
    await tx
      .update(refund)
      .set({ confirmedByUserId: opts.confirmedByUserId, confirmedAt: new Date(), allocations })
      .where(eq(refund.id, r.id));

    if (r.cancellationId) {
      const [c] = await tx.select().from(cancellation).where(eq(cancellation.id, r.cancellationId));
      const confirmed = (
        await tx
          .select()
          .from(refund)
          .where(and(eq(refund.cancellationId, r.cancellationId), eq(refund.state, 'CONFIRMED')))
      ).reduce((s, x) => s + x.amountPaise, 0);
      if (c?.state === 'REFUND_PENDING' && confirmed >= (c.refundPaise ?? 0)) {
        await this.transitions.move(
          tx,
          cancellationMachine,
          c.id,
          'REFUND_PENDING',
          'REFUNDED',
          systemActor(actor.userId),
          { correlationId, reason: 'Full refund paid' },
        );
      }
    } else {
      await this.core.reevaluate(tx, r.bookingId, actor.userId, correlationId);
    }
    await this.audit.record(
      {
        action: 'refund.confirmed',
        correlationId,
        actorUserId: opts.confirmedByUserId,
        entityType: 'refund',
        entityId: r.id,
        metadata: { bookingId: r.bookingId, allocations, method: r.method },
      },
      tx,
    );
  }

  async rejectRefund(refundId: string, reason: string, auth: AuthContext, correlationId: string) {
    return this.db.transaction(async (tx) => {
      const r = await this.loadRefund(tx, refundId);
      if (r.method === 'GATEWAY' && (r.sentAt || r.gatewayStatus)) {
        throw new ConflictException('This refund was already sent to the gateway');
      }
      await this.core.lockBooking(tx, r.bookingId);
      await this.transitions.move(
        tx,
        refundMachine,
        r.id,
        'INITIATED',
        'FAILED',
        systemActor(auth.userId),
        { correlationId, reason: `Refund rejected: ${reason}` },
      );
      await tx.update(refund).set({ reason }).where(eq(refund.id, r.id));
      await this.audit.record(
        {
          action: 'refund.rejected',
          correlationId,
          actorUserId: auth.userId,
          entityType: 'refund',
          entityId: r.id,
          metadata: { reason },
        },
        tx,
      );
      return r.bookingId;
    });
  }

  // ---------------------------------------------------------------- internals

  private actor(auth: AuthContext): Actor {
    return { userId: auth.userId, roles: inActingOrder(auth.roles) };
  }

  private async load(tx: Tx, id: string) {
    const [c] = await tx.select().from(cancellation).where(eq(cancellation.id, id));
    if (!c) throw new NotFoundException('Cancellation not found');
    return c;
  }

  async loadRefund(tx: Tx, id: string) {
    const [r] = await tx.select().from(refund).where(eq(refund.id, id));
    if (!r) throw new NotFoundException('Refund not found');
    return r;
  }

  private async assertCancellable(tx: Tx, b: BookingRow) {
    if (!CANCELLABLE.includes(b.state))
      throw new ConflictException(
        `A ${b.state.toLowerCase().replace('_', ' ')} booking cannot be cancelled`,
      );
    const [t] = await tx.select().from(trip).where(eq(trip.bookingId, b.id));
    if (t && !NOT_STARTED.includes(t.state)) {
      throw new ConflictException('The trip has started; handle it as an incident instead');
    }
  }
}

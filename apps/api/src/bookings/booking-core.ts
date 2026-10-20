import { randomUUID } from 'node:crypto';
import { schema, type Database } from '@navagraha/db';
import {
  bookingMachine,
  calculateQuote,
  confirmationGate,
  deriveFulfilmentState,
  itineraryMachine,
  netPaidPaise,
  normalizePhone,
  quoteMachine,
  tripMachine,
  validateConciergeItinerary,
  type AcceptanceChannel,
  type PaymentConditionPolicy,
  type PaymentSnapshot,
  type TemplateCode,
} from '@navagraha/domain';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import {
  TransitionService,
  systemActor,
  type Actor,
  type Tx,
} from '../state/transition.service.js';
import type { ManualBookingInput, QuoteLinesInput, StopsInput } from './booking.schemas.js';

const { booking, itinerary, quote, payment, fulfilmentComponent: component, trip } = schema;

export const today = () => new Date().toISOString().slice(0, 10);
export type BookingRow = typeof booking.$inferSelect;
export type PaymentRow = typeof payment.$inferSelect;

/** For the confirmation gate a waived (NOT_REQUIRED) amount counts like money received. */
export function snapshot(p: PaymentRow): PaymentSnapshot {
  return {
    state: p.state,
    capturedPaise: p.state === 'NOT_REQUIRED' ? p.amountPaise : p.capturedPaise,
    refundedPaise: p.refundedPaise,
  };
}

/** Real money received and not yet refunded — waivers excluded. This is the most that can be refunded. */
export function refundablePaise(payments: readonly PaymentRow[]) {
  return payments
    .filter((p) => p.state === 'SUCCESS' || p.state === 'PARTIALLY_REFUNDED')
    .reduce((s, p) => s + p.capturedPaise - p.refundedPaise, 0);
}

interface Ctx {
  actor: Actor;
  correlationId: string;
  sourceChannel?: string;
}

/**
 * Pieces shared by bookings, change requests and cancellations: travellers, versioned
 * itineraries and quotes, the booking lock and the confirmation gate (FS §33, D-04).
 */
@Injectable()
export class BookingCore {
  constructor(
    @Inject(TransitionService) private readonly transitions: TransitionService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async circuitTemples(tx: Tx | Database, circuitId: string) {
    return tx
      .select({ id: schema.temple.id, code: schema.temple.code })
      .from(schema.circuitTemple)
      .innerJoin(schema.temple, eq(schema.temple.id, schema.circuitTemple.templeId))
      .where(eq(schema.circuitTemple.circuitId, circuitId))
      .orderBy(asc(schema.circuitTemple.displayOrder));
  }

  /** New profiles, or existing ones that belong to this booker. */
  async resolveTravellers(tx: Tx, bookerUserId: string, inputs: ManualBookingInput['travellers']) {
    const travellers: { id: string; ageBand: string; isLead: boolean }[] = [];
    for (const t of inputs) {
      if ('travellerId' in t) {
        const [existing] = await tx
          .select()
          .from(schema.traveller)
          .where(
            and(
              eq(schema.traveller.id, t.travellerId),
              eq(schema.traveller.bookerUserId, bookerUserId),
            ),
          );
        if (!existing)
          throw new BadRequestException(`Traveller ${t.travellerId} not found for this booker`);
        travellers.push({ id: existing.id, ageBand: existing.ageBand, isLead: !!t.isLead });
        continue;
      }
      const tPhone = t.phone ? normalizePhone(t.phone) : null;
      const ePhone = t.emergencyContactPhone ? normalizePhone(t.emergencyContactPhone) : null;
      if (t.phone && !tPhone) throw new BadRequestException(`${t.fullName}: invalid phone`);
      if (t.emergencyContactPhone && !ePhone) {
        throw new BadRequestException(`${t.fullName}: invalid emergency contact phone`);
      }
      const [row] = await tx
        .insert(schema.traveller)
        .values({
          bookerUserId,
          fullName: t.fullName,
          ageBand: t.ageBand,
          relationshipToBooker: t.relationshipToBooker,
          phone: tPhone,
          mobilityNotes: t.mobilityNotes ?? null,
          needsWheelchair: t.needsWheelchair ?? false,
          foodPreference: t.foodPreference ?? null,
          emergencyContactName: t.emergencyContactName ?? null,
          emergencyContactPhone: ePhone,
          contactConsentAt: t.contactConsent ? new Date() : null,
        })
        .returning();
      travellers.push({ id: row!.id, ageBand: row!.ageBand, isLead: !!t.isLead });
    }
    if (new Set(travellers.map((t) => t.id)).size !== travellers.length) {
      throw new BadRequestException('The same traveller is listed twice');
    }
    if (travellers.filter((t) => t.isLead).length > 1) {
      throw new BadRequestException('Only one traveller can be the lead traveller');
    }
    return travellers;
  }

  /** D-20 structural check, raising 422 with every finding. */
  checkItinerary(input: {
    template: TemplateCode;
    startDate: string;
    circuitTempleCodes: string[];
    stops: StopsInput;
    travellerCount: number;
    vehicleSeats: number | null;
  }) {
    const check = validateConciergeItinerary({
      ...input,
      today: today(),
      stops: input.stops.map((s) => ({ ...s, templeCode: s.templeCode.toUpperCase() })),
    });
    if (!check.ok) {
      throw new UnprocessableEntityException({
        message: 'The itinerary has problems',
        errors: check.errors,
        warnings: check.warnings,
      });
    }
    return check;
  }

  price(lines: QuoteLinesInput) {
    try {
      return calculateQuote(lines);
    } catch (e) {
      throw new BadRequestException(`quote: ${(e as Error).message}`);
    }
  }

  /**
   * A new itinerary version: DRAFT → VALIDATED (system, D-20) → PROPOSED, and on to
   * ACCEPTED when the customer has already agreed.
   */
  async createItinerary(
    tx: Tx,
    ctx: Ctx,
    v: {
      bookingId: string;
      version: number;
      parentId: string | null;
      origin: 'MANUAL' | 'CHANGE_REQUEST';
      stops: StopsInput;
      templeIdByCode: Map<string, string>;
      warnings: unknown[];
      acceptedVia?: AcceptanceChannel;
      reason?: string;
    },
  ) {
    const opts = { correlationId: ctx.correlationId, sourceChannel: ctx.sourceChannel };
    const sys = systemActor(ctx.actor.userId);
    const id = randomUUID();
    await tx.insert(itinerary).values({
      id,
      bookingId: v.bookingId,
      version: v.version,
      parentId: v.parentId,
      state: 'DRAFT',
      origin: v.origin,
      reason: v.reason ?? null,
      createdByUserId: ctx.actor.userId,
    });
    await tx.insert(schema.itineraryStop).values(
      v.stops.map((s, i) => ({
        itineraryId: id,
        seq: i + 1,
        day: s.day,
        templeId: v.templeIdByCode.get(s.templeCode.toUpperCase())!,
        plannedArrival: s.plannedArrival ?? null,
        notes: s.notes ?? null,
      })),
    );
    await this.transitions.created(tx, itineraryMachine, id, 'DRAFT', ctx.actor, opts);
    await this.transitions.move(tx, itineraryMachine, id, 'DRAFT', 'VALIDATED', sys, {
      ...opts,
      reason: 'Structural check passed; timings checked by coordinator (D-20)',
    });
    await tx
      .update(itinerary)
      .set({
        validation: {
          level: 'STRUCTURAL_WITH_OPS_SIGN_OFF',
          engineChecked: false,
          warnings: v.warnings,
          signedOffBy: ctx.actor.userId,
          signedOffAt: new Date().toISOString(),
        },
      })
      .where(eq(itinerary.id, id));
    await this.transitions.move(tx, itineraryMachine, id, 'VALIDATED', 'PROPOSED', ctx.actor, opts);
    if (v.acceptedVia) await this.acceptItinerary(tx, ctx, id, v.acceptedVia);
    return id;
  }

  async acceptItinerary(tx: Tx, ctx: Ctx, id: string, via: AcceptanceChannel) {
    await this.transitions.move(tx, itineraryMachine, id, 'PROPOSED', 'ACCEPTED', ctx.actor, {
      correlationId: ctx.correlationId,
      reason: `Accepted by the customer via ${via.toLowerCase().replace('_', ' ')}`,
    });
  }

  /** A new quote version: DRAFT → CALCULATED (system) → PRESENTED, and LOCKED when accepted. */
  async createQuote(
    tx: Tx,
    ctx: Ctx,
    v: {
      bookingId: string;
      version: number;
      priced: ReturnType<typeof calculateQuote>;
      validUntil: Date;
      acceptedVia?: AcceptanceChannel;
    },
  ) {
    const opts = { correlationId: ctx.correlationId, sourceChannel: ctx.sourceChannel };
    const id = randomUUID();
    await tx.insert(quote).values({
      id,
      bookingId: v.bookingId,
      version: v.version,
      state: 'DRAFT',
      subtotalPaise: v.priced.subtotalPaise,
      taxPaise: v.priced.taxPaise,
      totalPaise: v.priced.totalPaise,
      pricingSource: 'MANUAL',
      validUntil: v.validUntil,
      createdByUserId: ctx.actor.userId,
    });
    await tx.insert(schema.quoteLine).values(
      v.priced.lines.map((l) => ({
        quoteId: id,
        seq: l.seq,
        kind: l.kind as QuoteLinesInput[number]['kind'],
        description: l.description,
        quantity: l.quantity,
        unitPricePaise: l.unitPricePaise,
        taxPaise: l.taxPaise,
        lineTotalPaise: l.lineTotalPaise,
      })),
    );
    await this.transitions.created(tx, quoteMachine, id, 'DRAFT', ctx.actor, opts);
    await this.transitions.move(
      tx,
      quoteMachine,
      id,
      'DRAFT',
      'CALCULATED',
      systemActor(ctx.actor.userId),
      opts,
    );
    await this.transitions.move(tx, quoteMachine, id, 'CALCULATED', 'PRESENTED', ctx.actor, opts);
    if (v.acceptedVia) await this.lockQuote(tx, ctx, id, v.acceptedVia);
    return id;
  }

  async lockQuote(tx: Tx, ctx: Ctx, id: string, via: AcceptanceChannel) {
    await this.transitions.move(tx, quoteMachine, id, 'PRESENTED', 'LOCKED', ctx.actor, {
      correlationId: ctx.correlationId,
      reason: `Accepted by the customer via ${via.toLowerCase().replace('_', ' ')}`,
    });
    await tx.update(quote).set({ lockedAt: new Date(), acceptedVia: via }).where(eq(quote.id, id));
  }

  /** Serialises changes to one booking so the gate is evaluated on consistent data. */
  async lockBooking(tx: Tx, bookingId: string) {
    const [b] = await tx.select().from(booking).where(eq(booking.id, bookingId)).for('update');
    if (!b) throw new NotFoundException('Booking not found');
    return b;
  }

  async balance(tx: Tx, b: BookingRow) {
    const [q] = await tx.select().from(quote).where(eq(quote.id, b.activeQuoteId!));
    const ps = await tx.select().from(payment).where(eq(payment.bookingId, b.id));
    const paid = netPaidPaise(ps.map(snapshot));
    const pending = ps.filter((p) => p.state === 'PENDING').reduce((s, p) => s + p.amountPaise, 0);
    return {
      totalPaise: q!.totalPaise,
      paidPaise: paid,
      pendingPaise: pending,
      dueAfterPending: q!.totalPaise - paid - pending,
      refundablePaise: refundablePaise(ps),
      payments: ps,
    };
  }

  /**
   * Re-checks the parallel confirmation gate (FS §33) after any payment, fulfilment or
   * applied change. Opens: PENDING_CONFIRMATION → CONFIRMED and the Trip is created.
   * Closes: back to PENDING_CONFIRMATION with the reason.
   */
  async reevaluate(tx: Tx, bookingId: string, triggeredBy: string, correlationId: string) {
    const [b] = await tx.select().from(booking).where(eq(booking.id, bookingId));
    if (!b || (b.state !== 'PENDING_CONFIRMATION' && b.state !== 'CONFIRMED')) return;
    const [q] = await tx.select().from(quote).where(eq(quote.id, b.activeQuoteId!));
    const ps = await tx.select().from(payment).where(eq(payment.bookingId, b.id));
    const cs = await tx.select().from(component).where(eq(component.bookingId, b.id));
    const gate = confirmationGate({
      totalPaise: q!.totalPaise,
      payments: ps.map(snapshot),
      fulfilment: deriveFulfilmentState(cs),
      policy: b.paymentPolicy as PaymentConditionPolicy,
    });
    const sys = systemActor(triggeredBy);

    if (b.state === 'PENDING_CONFIRMATION' && gate.open) {
      await this.transitions.move(
        tx,
        bookingMachine,
        b.id,
        'PENDING_CONFIRMATION',
        'CONFIRMED',
        sys,
        {
          correlationId,
          reason: 'Payment condition met and all mandatory supplier items confirmed',
        },
      );
      const [existing] = await tx
        .select({ id: trip.id })
        .from(trip)
        .where(eq(trip.bookingId, b.id));
      if (!existing) {
        const tripId = randomUUID();
        await tx
          .insert(trip)
          .values({ id: tripId, bookingId: b.id, state: 'SCHEDULED', startDate: b.startDate });
        await this.transitions.created(tx, tripMachine, tripId, 'SCHEDULED', sys, {
          correlationId,
        });
      }
      await this.audit.record(
        {
          action: 'booking.confirmed',
          correlationId,
          actorUserId: triggeredBy,
          entityType: 'booking',
          entityId: b.id,
        },
        tx,
      );
      // Customer confirmation messages are sent from here once notifications exist (P6, NAV-NOT-001).
    } else if (b.state === 'CONFIRMED' && !gate.open) {
      await this.transitions.move(
        tx,
        bookingMachine,
        b.id,
        'CONFIRMED',
        'PENDING_CONFIRMATION',
        sys,
        {
          correlationId,
          reason: `Confirmation gate closed: waiting for ${gate.waitingFor.join(' and ').toLowerCase()}`,
        },
      );
    }
  }

  /** How much more may be recorded as refunded, and against which cancellation. */
  async refundRoom(
    tx: Tx | Database,
    b: BookingRow,
  ): Promise<{ limit: number; cancellationId: string | null }> {
    const refunds = await tx.select().from(schema.refund).where(eq(schema.refund.bookingId, b.id));
    const live = (cid: string | null) =>
      refunds
        .filter(
          (r) => r.cancellationId === cid && (r.state === 'INITIATED' || r.state === 'CONFIRMED'),
        )
        .reduce((s, r) => s + r.amountPaise, 0);
    const [c] = await tx
      .select()
      .from(schema.cancellation)
      .where(
        and(
          eq(schema.cancellation.bookingId, b.id),
          eq(schema.cancellation.state, 'REFUND_PENDING'),
        ),
      );
    if (c) return { limit: (c.refundPaise ?? 0) - live(c.id), cancellationId: c.id };
    if (b.state === 'CANCELLED' || !b.activeQuoteId) return { limit: 0, cancellationId: null };
    const bal = await this.balance(tx as Tx, b);
    const overpaid = bal.paidPaise - bal.totalPaise;
    const pendingOverpayRefunds = refunds
      .filter((r) => !r.cancellationId && r.state === 'INITIATED')
      .reduce((s, r) => s + r.amountPaise, 0);
    return {
      limit: Math.min(overpaid, bal.refundablePaise) - pendingOverpayRefunds,
      cancellationId: null,
    };
  }
}

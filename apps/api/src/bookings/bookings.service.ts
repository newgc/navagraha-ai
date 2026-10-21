import { randomUUID } from 'node:crypto';
import { schema, type Database } from '@navagraha/db';
import {
  OFFLINE_PAYMENT_METHODS,
  bookingMachine,
  checkOfflineConfirmation,
  confirmationGate,
  deriveFulfilmentState,
  fulfilmentComponentMachine,
  inActingOrder,
  netPaidPaise,
  normalizePhone,
  paymentMachine,
  type AcceptanceChannel,
  type PaymentConditionPolicy,
  type SourceChannel,
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
import { and, asc, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { BookingCore, OPEN_STATES, snapshot, today, type BookingRow } from './booking-core.js';
import type { AuthContext } from '../auth/auth.types.js';
import { DB } from '../db/db.module.js';
import {
  TransitionService,
  systemActor,
  type Actor,
  type Tx,
} from '../state/transition.service.js';
import type {
  BookingListQuery,
  FulfilmentConfirmInput,
  FulfilmentInput,
  FulfilmentRequestInput,
  ManualBookingInput,
  OfflinePaymentInput,
  StopsInput,
} from './booking.schemas.js';

const { booking, itinerary, quote, payment, fulfilmentComponent: component, trip } = schema;

/** An agreed plan to turn into a booking (see BookingsService.createBooking). */
export interface BookingPlan {
  bookerUserId: string;
  travellers: ManualBookingInput['travellers'];
  trip: ManualBookingInput['trip'];
  stops: StopsInput;
  priced: ReturnType<BookingCore['price']>;
  validUntil: Date;
  fulfilment?: z.infer<typeof FulfilmentInput>[];
  source: { channel: SourceChannel; reference?: string | null };
  acceptedVia: AcceptanceChannel;
  /** Who prepared the itinerary, quote and supplier items. */
  preparer: Actor;
  /** Who agreed to it and so created the booking: the coordinator on the phone, or the customer. */
  acceptor: Actor;
  correlationId: string;
  auditAction: string;
  /** The proposal's validation (ENGINE when the planning engine checked it). */
  validation?: Record<string, unknown>;
}

const asActor = (auth: AuthContext): Actor => ({
  userId: auth.userId,
  roles: inActingOrder(auth.roles),
});

/**
 * Concierge (manual) bookings, offline payments and supplier confirmation — FS §12, §12.1,
 * EC-38, D-19, D-20. Every state change goes through TransitionService.
 */
@Injectable()
export class BookingsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(TransitionService) private readonly transitions: TransitionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(BookingCore) private readonly core: BookingCore,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ---------------------------------------------------------------- create

  async createManual(input: ManualBookingInput, auth: AuthContext, correlationId: string) {
    const phone = normalizePhone(input.booker.phone);
    if (!phone) throw new BadRequestException('booker.phone: enter a valid mobile number');
    if (new Date(input.quote.validUntil) <= new Date()) {
      throw new BadRequestException('quote.validUntil must be in the future');
    }
    const priced = this.core.price(input.quote.lines);
    const actor = asActor(auth);

    const bookingId = await this.db.transaction(async (tx) => {
      // Booker: the phone number is the identity (MR-01).
      await tx
        .insert(schema.appUser)
        .values({
          phone,
          displayName: input.booker.name ?? null,
          email: input.booker.email ?? null,
        })
        .onConflictDoNothing({ target: schema.appUser.phone });
      const [booker] = await tx
        .select()
        .from(schema.appUser)
        .where(eq(schema.appUser.phone, phone));
      if (!booker) throw new Error('booker missing after upsert');
      if (!booker.displayName && input.booker.name) {
        await tx
          .update(schema.appUser)
          .set({ displayName: input.booker.name })
          .where(eq(schema.appUser.id, booker.id));
      }
      await tx
        .insert(schema.appUserRole)
        .values({ userId: booker.id, role: 'CUSTOMER' })
        .onConflictDoNothing();

      return this.createBooking(tx, {
        bookerUserId: booker.id,
        travellers: input.travellers,
        trip: input.trip,
        stops: input.itinerary.stops,
        priced,
        validUntil: new Date(input.quote.validUntil),
        fulfilment: input.fulfilment,
        source: input.source,
        acceptedVia: input.quote.acceptedVia,
        preparer: actor,
        acceptor: actor,
        correlationId,
        auditAction: 'booking.manual_created',
      });
    });
    return this.detail(bookingId);
  }

  /**
   * Builds a booking from an agreed plan: travellers, itinerary v1 and quote v1 (accepted),
   * the booking (REQUESTED → PENDING_CONFIRMATION) and its supplier items. Used by concierge
   * bookings (the coordinator both prepares and records acceptance) and by web proposals (the
   * coordinator prepared it, the customer accepts). Runs inside the caller's transaction.
   */
  async createBooking(tx: Tx, plan: BookingPlan) {
    const { preparer, acceptor, correlationId } = plan;
    const sys = systemActor(acceptor.userId);
    const opts = { correlationId, sourceChannel: plan.source.channel };

    const [circ] = await tx
      .select()
      .from(schema.circuit)
      .where(eq(schema.circuit.code, plan.trip.circuitCode));
    if (!circ) throw new BadRequestException(`Unknown circuit ${plan.trip.circuitCode}`);
    const circuitTemples = await this.core.circuitTemples(tx, circ.id);
    const templeIdByCode = new Map(circuitTemples.map((t) => [t.code, t.id]));

    const travellers = await this.core.resolveTravellers(tx, plan.bookerUserId, plan.travellers);

    const fulfilment: z.infer<typeof FulfilmentInput>[] = plan.fulfilment ?? [
      { slot: 'vehicle', kind: 'VEHICLE', mandatory: true },
      ...(plan.trip.template === '2D1N'
        ? [{ slot: 'hotel:night-1', kind: 'HOTEL' as const, mandatory: true }]
        : []),
    ];
    if (new Set(fulfilment.map((f) => f.slot)).size !== fulfilment.length) {
      throw new BadRequestException('fulfilment: each slot must be unique');
    }
    const seats = fulfilment
      .filter((f) => f.kind === 'VEHICLE' && f.capacity)
      .map((f) => f.capacity!);

    // D-20 structural check (again at acceptance: the date may have passed since).
    const check = this.core.checkItinerary({
      template: plan.trip.template,
      startDate: plan.trip.startDate,
      circuitTempleCodes: circuitTemples.map((t) => t.code),
      stops: plan.stops,
      travellerCount: travellers.length,
      vehicleSeats: seats.length ? seats.reduce((a, b) => a + b, 0) : null,
    });

    const seniorFriendly =
      plan.trip.seniorFriendly ?? travellers.some((t) => t.ageBand.startsWith('SENIOR'));
    const id = randomUUID();
    await tx.insert(booking).values({
      id,
      state: 'REQUESTED',
      bookerUserId: plan.bookerUserId,
      circuitId: circ.id,
      startDate: plan.trip.startDate,
      template: plan.trip.template,
      mode: plan.trip.mode,
      seniorFriendly,
      tier: plan.trip.tier ?? null,
      pickupLocation: plan.trip.pickupLocation ?? null,
      pickupTime: plan.trip.pickupTime ?? null,
      sourceChannel: plan.source.channel,
      sourceReference: plan.source.reference ?? null,
      notes: plan.trip.notes ?? null,
      createdByUserId: preparer.userId,
    });
    await tx
      .insert(schema.bookingTraveller)
      .values(travellers.map((t) => ({ bookingId: id, travellerId: t.id, isLead: t.isLead })));

    // Itinerary v1 and quote v1: prepared by operations, accepted by the customer.
    const ctx = { actor: preparer, acceptor, correlationId, sourceChannel: plan.source.channel };
    const itineraryId = await this.core.createItinerary(tx, ctx, {
      bookingId: id,
      version: 1,
      parentId: null,
      origin: 'MANUAL',
      stops: plan.stops,
      templeIdByCode,
      warnings: check.warnings,
      acceptedVia: plan.acceptedVia,
      validation: plan.validation,
    });
    const quoteId = await this.core.createQuote(tx, ctx, {
      bookingId: id,
      version: 1,
      priced: plan.priced,
      validUntil: plan.validUntil,
      acceptedVia: plan.acceptedVia,
    });

    // Booking: REQUESTED (quote is LOCKED) → PENDING_CONFIRMATION.
    await tx
      .update(booking)
      .set({ activeItineraryId: itineraryId, activeQuoteId: quoteId })
      .where(eq(booking.id, id));
    await this.transitions.created(tx, bookingMachine, id, 'REQUESTED', acceptor, opts);
    await this.transitions.move(
      tx,
      bookingMachine,
      id,
      'REQUESTED',
      'PENDING_CONFIRMATION',
      sys,
      opts,
    );

    for (const f of fulfilment) {
      const componentId = randomUUID();
      await tx.insert(component).values({
        id: componentId,
        bookingId: id,
        slot: f.slot,
        kind: f.kind,
        mandatory: f.mandatory,
        state: 'PENDING',
        description: f.description ?? null,
        supplierName: f.supplierName ?? null,
        capacity: f.capacity ?? null,
      });
      await this.transitions.created(
        tx,
        fulfilmentComponentMachine,
        componentId,
        'PENDING',
        preparer,
        opts,
      );
    }

    await this.audit.record(
      {
        action: plan.auditAction,
        correlationId,
        actorUserId: acceptor.userId,
        entityType: 'booking',
        entityId: id,
        metadata: { channel: plan.source.channel, totalPaise: plan.priced.totalPaise },
      },
      tx,
    );
    return id;
  }

  // ---------------------------------------------------------------- read

  async list(q: z.infer<typeof BookingListQuery>) {
    const where = and(
      q.from ? gte(booking.startDate, q.from) : undefined,
      q.to ? lte(booking.startDate, q.to) : undefined,
      q.state ? sql`${booking.state}::text = ${q.state}` : undefined,
    );
    const rows = await this.db
      .select({
        reference: booking.reference,
        state: booking.state,
        startDate: booking.startDate,
        template: booking.template,
        mode: booking.mode,
        seniorFriendly: booking.seniorFriendly,
        sourceChannel: booking.sourceChannel,
        bookerName: schema.appUser.displayName,
        bookerPhone: schema.appUser.phone,
        totalPaise: quote.totalPaise,
        travellers: sql<number>`(select count(*)::int from booking_traveller bt where bt.booking_id = ${booking.id})`,
      })
      .from(booking)
      .innerJoin(schema.appUser, eq(schema.appUser.id, booking.bookerUserId))
      .leftJoin(quote, eq(quote.id, booking.activeQuoteId))
      .where(where)
      .orderBy(asc(booking.startDate), asc(booking.reference))
      .limit(500);
    return { bookings: rows };
  }

  async detail(bookingId: string) {
    const [b] = await this.db.select().from(booking).where(eq(booking.id, bookingId));
    if (!b) throw new NotFoundException('Booking not found');
    const [booker] = await this.db
      .select()
      .from(schema.appUser)
      .where(eq(schema.appUser.id, b.bookerUserId));
    const [circ] = await this.db
      .select()
      .from(schema.circuit)
      .where(eq(schema.circuit.id, b.circuitId));
    const travellers = await this.db
      .select({ traveller: schema.traveller, isLead: schema.bookingTraveller.isLead })
      .from(schema.bookingTraveller)
      .innerJoin(schema.traveller, eq(schema.traveller.id, schema.bookingTraveller.travellerId))
      .where(eq(schema.bookingTraveller.bookingId, b.id));
    const [itin] = b.activeItineraryId
      ? await this.db.select().from(itinerary).where(eq(itinerary.id, b.activeItineraryId))
      : [];
    const stops = itin ? await this.stopsOf(itin.id) : [];
    const [q] = b.activeQuoteId
      ? await this.db.select().from(quote).where(eq(quote.id, b.activeQuoteId))
      : [];
    const lines = q
      ? await this.db
          .select()
          .from(schema.quoteLine)
          .where(eq(schema.quoteLine.quoteId, q.id))
          .orderBy(asc(schema.quoteLine.seq))
      : [];
    const payments = await this.db
      .select()
      .from(payment)
      .where(eq(payment.bookingId, b.id))
      .orderBy(asc(payment.createdAt));
    const components = await this.db
      .select()
      .from(component)
      .where(eq(component.bookingId, b.id))
      .orderBy(asc(component.createdAt));
    const [t] = await this.db.select().from(trip).where(eq(trip.bookingId, b.id));

    const totalPaise = q?.totalPaise ?? 0;
    const paidPaise = netPaidPaise(payments.map(snapshot));
    const fulfilmentState = deriveFulfilmentState(components, {
      bookingCancelled: b.state === 'CANCELLED',
    });
    const gate = confirmationGate({
      totalPaise,
      payments: payments.map(snapshot),
      fulfilment: fulfilmentState,
      policy: b.paymentPolicy as PaymentConditionPolicy,
    });

    const [allItineraries, allQuotes, changes, cancellations, refunds, room] = await Promise.all([
      this.db.select().from(itinerary).where(eq(itinerary.bookingId, b.id)),
      this.db.select().from(quote).where(eq(quote.bookingId, b.id)),
      this.db
        .select()
        .from(schema.changeRequest)
        .where(eq(schema.changeRequest.bookingId, b.id))
        .orderBy(desc(schema.changeRequest.createdAt)),
      this.db
        .select()
        .from(schema.cancellation)
        .where(eq(schema.cancellation.bookingId, b.id))
        .orderBy(desc(schema.cancellation.createdAt)),
      this.db
        .select()
        .from(schema.refund)
        .where(eq(schema.refund.bookingId, b.id))
        .orderBy(asc(schema.refund.createdAt)),
      this.core.refundRoom(this.db, b),
    ]);
    const proposals = await Promise.all(
      changes.map(async (c) => {
        if (!c.proposedItineraryId || !c.proposedQuoteId) return null;
        const [pq] = await this.db.select().from(quote).where(eq(quote.id, c.proposedQuoteId));
        const pLines = await this.db
          .select()
          .from(schema.quoteLine)
          .where(eq(schema.quoteLine.quoteId, c.proposedQuoteId))
          .orderBy(asc(schema.quoteLine.seq));
        const pStops = await this.stopsOf(c.proposedItineraryId);
        return {
          quote: pq && {
            id: pq.id,
            version: pq.version,
            state: pq.state,
            totalPaise: pq.totalPaise,
            validUntil: pq.validUntil,
            lines: pLines.map(({ quoteId: _, ...l }) => l),
          },
          stops: pStops,
        };
      }),
    );

    const entityIds = [
      b.id,
      t?.id,
      ...allItineraries.map((x) => x.id),
      ...allQuotes.map((x) => x.id),
      ...payments.map((p) => p.id),
      ...components.map((c) => c.id),
      ...changes.map((c) => c.id),
      ...cancellations.map((c) => c.id),
      ...refunds.map((r) => r.id),
    ].filter((x): x is string => !!x);
    const history = await this.db
      .select()
      .from(schema.stateTransition)
      .where(inArray(schema.stateTransition.entityId, entityIds))
      .orderBy(asc(schema.stateTransition.id));

    return {
      id: b.id,
      reference: b.reference,
      state: b.state,
      circuit: circ?.code,
      startDate: b.startDate,
      template: b.template,
      mode: b.mode,
      seniorFriendly: b.seniorFriendly,
      tier: b.tier,
      pickup: { location: b.pickupLocation, time: b.pickupTime },
      source: { channel: b.sourceChannel, reference: b.sourceReference },
      notes: b.notes,
      booker: {
        id: booker!.id,
        name: booker!.displayName,
        phone: booker!.phone,
        email: booker!.email,
      },
      travellers: travellers.map(({ traveller: tr, isLead }) => ({
        id: tr.id,
        fullName: tr.fullName,
        ageBand: tr.ageBand,
        relationshipToBooker: tr.relationshipToBooker,
        needsWheelchair: tr.needsWheelchair,
        mobilityNotes: tr.mobilityNotes,
        foodPreference: tr.foodPreference,
        hasEmergencyContact: !!tr.emergencyContactPhone,
        contactConsent: !!tr.contactConsentAt,
        isLead,
      })),
      itinerary: itin && {
        id: itin.id,
        version: itin.version,
        state: itin.state,
        origin: itin.origin,
        validation: itin.validation,
        stops,
      },
      quote: q && {
        id: q.id,
        version: q.version,
        state: q.state,
        currency: q.currency,
        subtotalPaise: q.subtotalPaise,
        taxPaise: q.taxPaise,
        totalPaise: q.totalPaise,
        pricingSource: q.pricingSource,
        validUntil: q.validUntil,
        acceptedVia: q.acceptedVia,
        lines: lines.map(({ quoteId: _, ...l }) => l),
      },
      payment: {
        totalPaise,
        paidPaise,
        duePaise: Math.max(0, totalPaise - paidPaise),
        policy: b.paymentPolicy,
        items: payments.map((p) => ({
          id: p.id,
          state: p.state,
          method: p.method,
          amountPaise: p.amountPaise,
          capturedPaise: p.capturedPaise,
          refundedPaise: p.refundedPaise,
          reference: p.reference,
          receivedOn: p.receivedOn,
          recordedBy: p.recordedByUserId,
          confirmedBy: p.confirmedByUserId,
          reason: p.reason,
          link: p.gatewayLinkId
            ? {
                url: p.gatewayLinkUrl,
                expiresAt: p.gatewayLinkExpiresAt,
                gatewayPaymentId: p.gatewayPaymentId,
              }
            : null,
        })),
        /** D-11: whether "Send payment link" is available on this server. */
        gatewayEnabled: this.config.PAYMENT_GATEWAY !== 'none',
      },
      fulfilment: {
        state: fulfilmentState,
        components: components.map(({ bookingId: _, ...c }) => c),
      },
      confirmation: gate,
      trip: t ? { id: t.id, state: t.state } : null,
      changeRequests: changes.map((c, i) => ({
        id: c.id,
        state: c.state,
        kind: c.kind,
        description: c.description,
        requestedVia: c.requestedVia,
        requestedBy: c.requestedByUserId,
        proposal:
          c.proposal && proposals[i] ? { ...(c.proposal as object), ...proposals[i] } : null,
        acceptedVia: c.acceptedVia,
        decisionReason: c.decisionReason,
        createdAt: c.createdAt,
      })),
      cancellations: cancellations.map((c) => ({
        id: c.id,
        state: c.state,
        reason: c.reason,
        requestedVia: c.requestedVia,
        refundPaise: c.refundPaise,
        refundNote: c.refundNote,
        reviewedBy: c.reviewedByUserId,
        decidedBy: c.decidedByUserId,
        decisionReason: c.decisionReason,
        createdAt: c.createdAt,
      })),
      refunds: {
        /** How much more may be recorded as refunded right now. */
        duePaise: Math.max(0, room.limit),
        /** D-11: the most one refund through the gateway can return (one online payment). */
        gatewayRefundablePaise:
          this.config.PAYMENT_GATEWAY === 'none'
            ? 0
            : Math.max(
                0,
                ...payments
                  .filter(
                    (p) =>
                      p.method === 'GATEWAY' &&
                      p.gatewayOrderId &&
                      (p.state === 'SUCCESS' || p.state === 'PARTIALLY_REFUNDED'),
                  )
                  .map(
                    (p) =>
                      p.capturedPaise -
                      p.refundedPaise -
                      refunds
                        .filter((r) => r.paymentId === p.id && r.state === 'INITIATED')
                        .reduce((sum, r) => sum + r.amountPaise, 0),
                  ),
              ),
        items: refunds.map((r) => ({
          id: r.id,
          state: r.state,
          method: r.method,
          amountPaise: r.amountPaise,
          reference: r.reference,
          paidOn: r.paidOn,
          initiatedBy: r.initiatedByUserId,
          confirmedBy: r.confirmedByUserId,
          forCancellation: !!r.cancellationId,
          reason: r.reason,
          gateway:
            r.method === 'GATEWAY'
              ? {
                  paymentId: r.paymentId,
                  approvedBy: r.approvedByUserId,
                  approvedAt: r.approvedAt,
                  sentAt: r.sentAt,
                  status: r.gatewayStatus,
                  refundId: r.gatewayRefundId,
                }
              : null,
        })),
      },
      history: history.map((h) => ({
        machine: h.machine,
        entityId: h.entityId,
        from: h.fromState,
        to: h.toState,
        actorUserId: h.actorUserId,
        actorRole: h.actorRole,
        reason: h.reason,
        recordedAt: h.recordedAt,
      })),
    };
  }

  private stopsOf(itineraryId: string) {
    return this.db
      .select({
        seq: schema.itineraryStop.seq,
        day: schema.itineraryStop.day,
        plannedArrival: schema.itineraryStop.plannedArrival,
        notes: schema.itineraryStop.notes,
        templeCode: schema.temple.code,
        templeName: schema.temple.commonName,
      })
      .from(schema.itineraryStop)
      .innerJoin(schema.temple, eq(schema.temple.id, schema.itineraryStop.templeId))
      .where(eq(schema.itineraryStop.itineraryId, itineraryId))
      .orderBy(asc(schema.itineraryStop.seq));
  }

  async idByReference(reference: string) {
    const [b] = await this.db
      .select({ id: booking.id })
      .from(booking)
      .where(eq(booking.reference, reference));
    if (!b) throw new NotFoundException('Booking not found');
    return b.id;
  }

  // ---------------------------------------------------------------- payments (D-19)

  async recordOfflinePayment(
    bookingId: string,
    input: z.infer<typeof OfflinePaymentInput>,
    auth: AuthContext,
    correlationId: string,
  ) {
    if (input.receivedOn > today())
      throw new BadRequestException('receivedOn cannot be in the future');
    await this.db.transaction(async (tx) => {
      const b = await this.lockBooking(tx, bookingId);
      if (!(OPEN_STATES as readonly string[]).includes(b.state)) {
        throw new ConflictException(`Booking is ${b.state}`);
      }
      const { dueAfterPending } = await this.balance(tx, b);
      if (input.amountPaise > dueAfterPending) {
        throw new UnprocessableEntityException(
          `Amount is more than the balance still due (${dueAfterPending} paise, after payments awaiting confirmation)`,
        );
      }
      const id = randomUUID();
      await tx.insert(payment).values({
        id,
        bookingId,
        state: 'PENDING',
        method: input.method,
        amountPaise: input.amountPaise,
        reference: input.reference,
        receivedOn: input.receivedOn,
        recordedByUserId: auth.userId,
        recordedAt: new Date(),
      });
      // The system holds the PENDING payment; the recorder is kept as the triggering user.
      await this.transitions.created(tx, paymentMachine, id, 'PENDING', systemActor(auth.userId), {
        correlationId,
        reason: `Offline receipt recorded (${input.method}), awaiting second-person confirmation (D-19)`,
      });
      await this.audit.record(
        {
          action: 'payment.offline_recorded',
          correlationId,
          actorUserId: auth.userId,
          entityType: 'payment',
          entityId: id,
          metadata: { bookingId, method: input.method, amountPaise: input.amountPaise },
        },
        tx,
      );
    });
    return this.detail(bookingId);
  }

  async confirmOfflinePayment(paymentId: string, auth: AuthContext, correlationId: string) {
    const bookingId = await this.db.transaction(async (tx) => {
      const p = await this.offlinePayment(tx, paymentId);
      await this.lockBooking(tx, p.bookingId);
      const check = checkOfflineConfirmation({
        recordedByUserId: p.recordedByUserId!,
        confirmerUserId: auth.userId,
        confirmerRoles: auth.roles,
      });
      if (!check.ok) {
        await this.audit.record({
          action: 'security.two_person_rule_blocked',
          correlationId,
          actorUserId: auth.userId,
          entityType: 'payment',
          entityId: paymentId,
          metadata: { reason: check.reason },
        });
        throw new ForbiddenException(
          check.reason === 'SAME_PERSON'
            ? 'A different person must confirm a payment you recorded (D-19)'
            : 'Only Finance or an Operations Manager can confirm payments',
        );
      }
      await this.transitions.move(
        tx,
        paymentMachine,
        paymentId,
        'PENDING',
        'SUCCESS',
        systemActor(auth.userId),
        {
          correlationId,
          reason: 'Offline receipt confirmed by a second person (D-19)',
        },
      );
      await tx
        .update(payment)
        .set({
          capturedPaise: p.amountPaise,
          confirmedByUserId: auth.userId,
          confirmedAt: new Date(),
        })
        .where(eq(payment.id, paymentId));
      await this.audit.record(
        {
          action: 'payment.offline_confirmed',
          correlationId,
          actorUserId: auth.userId,
          entityType: 'payment',
          entityId: paymentId,
          metadata: {
            bookingId: p.bookingId,
            amountPaise: p.amountPaise,
            recordedBy: p.recordedByUserId,
          },
        },
        tx,
      );
      await this.reevaluate(tx, p.bookingId, auth.userId, correlationId);
      return p.bookingId;
    });
    return this.detail(bookingId);
  }

  async rejectOfflinePayment(
    paymentId: string,
    reason: string,
    auth: AuthContext,
    correlationId: string,
  ) {
    const bookingId = await this.db.transaction(async (tx) => {
      const p = await this.offlinePayment(tx, paymentId);
      await this.transitions.move(
        tx,
        paymentMachine,
        paymentId,
        'PENDING',
        'FAILED',
        systemActor(auth.userId),
        {
          correlationId,
          reason: `Offline receipt rejected: ${reason}`,
        },
      );
      await tx.update(payment).set({ reason }).where(eq(payment.id, paymentId));
      await this.audit.record(
        {
          action: 'payment.offline_rejected',
          correlationId,
          actorUserId: auth.userId,
          entityType: 'payment',
          entityId: paymentId,
          metadata: { reason },
        },
        tx,
      );
      return p.bookingId;
    });
    return this.detail(bookingId);
  }

  /** An Operations Manager waives the remaining balance, e.g. a complimentary pilot trip. */
  async waiveBalance(bookingId: string, reason: string, auth: AuthContext, correlationId: string) {
    await this.db.transaction(async (tx) => {
      const b = await this.lockBooking(tx, bookingId);
      if (!(OPEN_STATES as readonly string[]).includes(b.state)) {
        throw new ConflictException(`Booking is ${b.state}`);
      }
      const { dueAfterPending } = await this.balance(tx, b);
      if (dueAfterPending <= 0) throw new ConflictException('Nothing is left to waive');
      const id = randomUUID();
      await tx.insert(payment).values({
        id,
        bookingId,
        state: 'NOT_REQUIRED',
        method: 'WAIVER',
        amountPaise: dueAfterPending,
        recordedByUserId: auth.userId,
        recordedAt: new Date(),
        reason,
      });
      await this.transitions.created(tx, paymentMachine, id, 'NOT_REQUIRED', asActor(auth), {
        correlationId,
        reason,
      });
      await this.audit.record(
        {
          action: 'payment.balance_waived',
          correlationId,
          actorUserId: auth.userId,
          entityType: 'payment',
          entityId: id,
          metadata: { bookingId, amountPaise: dueAfterPending, reason },
        },
        tx,
      );
      await this.reevaluate(tx, bookingId, auth.userId, correlationId);
    });
    return this.detail(bookingId);
  }

  // ---------------------------------------------------------------- fulfilment

  async addComponent(
    bookingId: string,
    input: z.infer<typeof FulfilmentInput>,
    auth: AuthContext,
    correlationId: string,
  ) {
    await this.db.transaction(async (tx) => {
      const b = await this.lockBooking(tx, bookingId);
      if (!(OPEN_STATES as readonly string[]).includes(b.state)) {
        throw new ConflictException(`Booking is ${b.state}`);
      }
      // A replacement may reuse the slot of a declined, cancelled or released component.
      const [live] = await tx
        .select({ id: component.id })
        .from(component)
        .where(
          and(
            eq(component.bookingId, bookingId),
            eq(component.slot, input.slot),
            or(
              eq(component.state, 'PENDING'),
              eq(component.state, 'REQUESTED'),
              eq(component.state, 'CONFIRMED'),
            ),
          ),
        );
      if (live) throw new ConflictException(`Slot ${input.slot} already has an active component`);
      const id = randomUUID();
      await tx.insert(component).values({
        id,
        bookingId,
        slot: input.slot,
        kind: input.kind,
        mandatory: input.mandatory,
        state: 'PENDING',
        description: input.description ?? null,
        supplierName: input.supplierName ?? null,
        capacity: input.capacity ?? null,
      });
      await this.transitions.created(tx, fulfilmentComponentMachine, id, 'PENDING', asActor(auth), {
        correlationId,
      });
      await this.reevaluate(tx, bookingId, auth.userId, correlationId);
    });
    return this.detail(bookingId);
  }

  async requestComponent(
    componentId: string,
    input: z.infer<typeof FulfilmentRequestInput>,
    auth: AuthContext,
    correlationId: string,
  ) {
    return this.onComponent(componentId, auth, correlationId, async (tx, c) => {
      await this.transitions.move(
        tx,
        fulfilmentComponentMachine,
        c.id,
        'PENDING',
        'REQUESTED',
        asActor(auth),
        {
          correlationId,
          reason: input.notes ?? null,
        },
      );
      if (input.supplierName || input.notes) {
        await tx
          .update(component)
          .set({
            supplierName: input.supplierName ?? c.supplierName,
            notes: input.notes ?? c.notes,
          })
          .where(eq(component.id, c.id));
      }
    });
  }

  async confirmComponent(
    componentId: string,
    input: z.infer<typeof FulfilmentConfirmInput>,
    auth: AuthContext,
    correlationId: string,
  ) {
    return this.onComponent(componentId, auth, correlationId, async (tx, c) => {
      const capacity = input.capacity ?? c.capacity;
      if (c.kind === 'VEHICLE') {
        const [{ n }] = (await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.bookingTraveller)
          .where(eq(schema.bookingTraveller.bookingId, c.bookingId))) as [{ n: number }];
        if (capacity == null) throw new BadRequestException('Give the vehicle capacity (seats)');
        if (capacity < n) {
          throw new UnprocessableEntityException(
            `The vehicle seats ${capacity} but there are ${n} travellers`,
          );
        }
      }
      await this.transitions.move(
        tx,
        fulfilmentComponentMachine,
        c.id,
        'REQUESTED',
        'CONFIRMED',
        asActor(auth),
        {
          correlationId,
        },
      );
      await tx
        .update(component)
        .set({
          supplierReference: input.supplierReference,
          supplierName: input.supplierName ?? c.supplierName,
          capacity,
        })
        .where(eq(component.id, c.id));
    });
  }

  async declineComponent(
    componentId: string,
    reason: string,
    auth: AuthContext,
    correlationId: string,
  ) {
    return this.onComponent(componentId, auth, correlationId, async (tx, c) => {
      await this.transitions.move(
        tx,
        fulfilmentComponentMachine,
        c.id,
        'REQUESTED',
        'DECLINED',
        asActor(auth),
        {
          correlationId,
          reason,
        },
      );
    });
  }

  // ---------------------------------------------------------------- internals

  private async onComponent(
    componentId: string,
    auth: AuthContext,
    correlationId: string,
    work: (tx: Tx, c: typeof component.$inferSelect) => Promise<void>,
  ) {
    const bookingId = await this.db.transaction(async (tx) => {
      const [c] = await tx.select().from(component).where(eq(component.id, componentId));
      if (!c) throw new NotFoundException('Fulfilment component not found');
      await this.lockBooking(tx, c.bookingId);
      await work(tx, c);
      await this.reevaluate(tx, c.bookingId, auth.userId, correlationId);
      return c.bookingId;
    });
    return this.detail(bookingId);
  }

  private async offlinePayment(tx: Tx, paymentId: string) {
    const [p] = await tx.select().from(payment).where(eq(payment.id, paymentId));
    if (!p) throw new NotFoundException('Payment not found');
    if (!(OFFLINE_PAYMENT_METHODS as readonly string[]).includes(p.method)) {
      throw new ConflictException('Only offline payments are confirmed by hand');
    }
    return p;
  }

  private lockBooking(tx: Tx, bookingId: string) {
    return this.core.lockBooking(tx, bookingId);
  }

  private balance(tx: Tx, b: BookingRow) {
    return this.core.balance(tx, b);
  }

  private reevaluate(tx: Tx, bookingId: string, triggeredBy: string, correlationId: string) {
    return this.core.reevaluate(tx, bookingId, triggeredBy, correlationId);
  }
}

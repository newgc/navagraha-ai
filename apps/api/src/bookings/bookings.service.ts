import { randomUUID } from 'node:crypto';
import { schema, type Database } from '@navagraha/db';
import {
  OFFLINE_PAYMENT_METHODS,
  bookingMachine,
  calculateQuote,
  checkOfflineConfirmation,
  confirmationGate,
  deriveFulfilmentState,
  fulfilmentComponentMachine,
  inActingOrder,
  itineraryMachine,
  netPaidPaise,
  normalizePhone,
  paymentMachine,
  quoteMachine,
  tripMachine,
  validateConciergeItinerary,
  type PaymentConditionPolicy,
  type PaymentSnapshot,
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
import { and, asc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
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
import type {
  BookingListQuery,
  FulfilmentConfirmInput,
  FulfilmentInput,
  FulfilmentRequestInput,
  ManualBookingInput,
  OfflinePaymentInput,
} from './booking.schemas.js';

const { booking, itinerary, quote, payment, fulfilmentComponent: component, trip } = schema;

const today = () => new Date().toISOString().slice(0, 10);
const asActor = (auth: AuthContext): Actor => ({
  userId: auth.userId,
  roles: inActingOrder(auth.roles),
});
const OPEN_STATES = ['REQUESTED', 'PENDING_CONFIRMATION', 'CONFIRMED', 'IN_PROGRESS'] as const;

/** For the confirmation gate a waived (NOT_REQUIRED) amount counts like money received. */
function snapshot(p: typeof payment.$inferSelect): PaymentSnapshot {
  return {
    state: p.state,
    capturedPaise: p.state === 'NOT_REQUIRED' ? p.amountPaise : p.capturedPaise,
    refundedPaise: p.refundedPaise,
  };
}

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
  ) {}

  // ---------------------------------------------------------------- create

  async createManual(input: ManualBookingInput, auth: AuthContext, correlationId: string) {
    const actor = asActor(auth);
    const sys = systemActor(auth.userId);
    const opts = { correlationId, sourceChannel: input.source.channel };

    const phone = normalizePhone(input.booker.phone);
    if (!phone) throw new BadRequestException('booker.phone: enter a valid mobile number');
    if (new Date(input.quote.validUntil) <= new Date()) {
      throw new BadRequestException('quote.validUntil must be in the future');
    }
    let priced: ReturnType<typeof calculateQuote>;
    try {
      priced = calculateQuote(input.quote.lines);
    } catch (e) {
      throw new BadRequestException(`quote: ${(e as Error).message}`);
    }

    const bookingId = await this.db.transaction(async (tx) => {
      const [circ] = await tx
        .select()
        .from(schema.circuit)
        .where(eq(schema.circuit.code, input.trip.circuitCode));
      if (!circ) throw new BadRequestException(`Unknown circuit ${input.trip.circuitCode}`);
      const circuitTemples = await tx
        .select({ id: schema.temple.id, code: schema.temple.code })
        .from(schema.circuitTemple)
        .innerJoin(schema.temple, eq(schema.temple.id, schema.circuitTemple.templeId))
        .where(eq(schema.circuitTemple.circuitId, circ.id))
        .orderBy(asc(schema.circuitTemple.displayOrder));
      const templeIdByCode = new Map(circuitTemples.map((t) => [t.code, t.id]));

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

      // Travellers: new profiles, or existing ones that belong to this booker.
      const travellers: { id: string; ageBand: string; isLead: boolean }[] = [];
      for (const t of input.travellers) {
        if ('travellerId' in t) {
          const [existing] = await tx
            .select()
            .from(schema.traveller)
            .where(
              and(
                eq(schema.traveller.id, t.travellerId),
                eq(schema.traveller.bookerUserId, booker.id),
              ),
            );
          if (!existing)
            throw new BadRequestException(`Traveller ${t.travellerId} not found for this booker`);
          travellers.push({ id: existing.id, ageBand: existing.ageBand, isLead: !!t.isLead });
        } else {
          const tPhone = t.phone ? normalizePhone(t.phone) : null;
          const ePhone = t.emergencyContactPhone ? normalizePhone(t.emergencyContactPhone) : null;
          if (t.phone && !tPhone) throw new BadRequestException(`${t.fullName}: invalid phone`);
          if (t.emergencyContactPhone && !ePhone) {
            throw new BadRequestException(`${t.fullName}: invalid emergency contact phone`);
          }
          const [row] = await tx
            .insert(schema.traveller)
            .values({
              bookerUserId: booker.id,
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
      }
      if (new Set(travellers.map((t) => t.id)).size !== travellers.length) {
        throw new BadRequestException('The same traveller is listed twice');
      }
      if (travellers.filter((t) => t.isLead).length > 1) {
        throw new BadRequestException('Only one traveller can be the lead traveller');
      }

      const fulfilment: z.infer<typeof FulfilmentInput>[] = input.fulfilment ?? [
        { slot: 'vehicle', kind: 'VEHICLE', mandatory: true },
        ...(input.trip.template === '2D1N'
          ? [{ slot: 'hotel:night-1', kind: 'HOTEL' as const, mandatory: true }]
          : []),
      ];
      if (new Set(fulfilment.map((f) => f.slot)).size !== fulfilment.length) {
        throw new BadRequestException('fulfilment: each slot must be unique');
      }
      const seats = fulfilment
        .filter((f) => f.kind === 'VEHICLE' && f.capacity)
        .map((f) => f.capacity!);

      // D-20 structural check; the coordinator's sign-off is enforced by the input schema.
      const check = validateConciergeItinerary({
        template: input.trip.template,
        startDate: input.trip.startDate,
        today: today(),
        circuitTempleCodes: circuitTemples.map((t) => t.code),
        stops: input.itinerary.stops.map((s) => ({ ...s, templeCode: s.templeCode.toUpperCase() })),
        travellerCount: travellers.length,
        vehicleSeats: seats.length ? seats.reduce((a, b) => a + b, 0) : null,
      });
      if (!check.ok) {
        throw new UnprocessableEntityException({
          message: 'The itinerary has problems',
          errors: check.errors,
          warnings: check.warnings,
        });
      }

      const seniorFriendly =
        input.trip.seniorFriendly ?? travellers.some((t) => t.ageBand.startsWith('SENIOR'));
      const id = randomUUID();
      await tx.insert(booking).values({
        id,
        state: 'REQUESTED',
        bookerUserId: booker.id,
        circuitId: circ.id,
        startDate: input.trip.startDate,
        template: input.trip.template,
        mode: input.trip.mode,
        seniorFriendly,
        tier: input.trip.tier ?? null,
        pickupLocation: input.trip.pickupLocation ?? null,
        pickupTime: input.trip.pickupTime ?? null,
        sourceChannel: input.source.channel,
        sourceReference: input.source.reference ?? null,
        notes: input.trip.notes ?? null,
        createdByUserId: auth.userId,
      });
      await tx
        .insert(schema.bookingTraveller)
        .values(travellers.map((t) => ({ bookingId: id, travellerId: t.id, isLead: t.isLead })));

      // Itinerary v1: DRAFT → VALIDATED (system, D-20) → PROPOSED → ACCEPTED (by phone).
      const itineraryId = randomUUID();
      await tx.insert(itinerary).values({
        id: itineraryId,
        bookingId: id,
        version: 1,
        state: 'DRAFT',
        origin: 'MANUAL',
        createdByUserId: auth.userId,
      });
      await tx.insert(schema.itineraryStop).values(
        input.itinerary.stops.map((s, i) => ({
          itineraryId,
          seq: i + 1,
          day: s.day,
          templeId: templeIdByCode.get(s.templeCode.toUpperCase())!,
          plannedArrival: s.plannedArrival ?? null,
          notes: s.notes ?? null,
        })),
      );
      await this.transitions.created(tx, itineraryMachine, itineraryId, 'DRAFT', actor, opts);
      await this.transitions.move(tx, itineraryMachine, itineraryId, 'DRAFT', 'VALIDATED', sys, {
        ...opts,
        reason: 'Structural check passed; timings checked by coordinator (D-20)',
      });
      await tx
        .update(itinerary)
        .set({
          validation: {
            level: 'STRUCTURAL_WITH_OPS_SIGN_OFF',
            engineChecked: false,
            warnings: check.warnings,
            signedOffBy: auth.userId,
            signedOffAt: new Date().toISOString(),
          },
        })
        .where(eq(itinerary.id, itineraryId));
      await this.transitions.move(
        tx,
        itineraryMachine,
        itineraryId,
        'VALIDATED',
        'PROPOSED',
        actor,
        opts,
      );
      await this.transitions.move(
        tx,
        itineraryMachine,
        itineraryId,
        'PROPOSED',
        'ACCEPTED',
        actor,
        {
          ...opts,
          reason: `Accepted by the customer via ${input.quote.acceptedVia}`,
        },
      );

      // Quote v1: DRAFT → CALCULATED (system arithmetic) → PRESENTED → LOCKED.
      const quoteId = randomUUID();
      await tx.insert(quote).values({
        id: quoteId,
        bookingId: id,
        version: 1,
        state: 'DRAFT',
        subtotalPaise: priced.subtotalPaise,
        taxPaise: priced.taxPaise,
        totalPaise: priced.totalPaise,
        pricingSource: 'MANUAL',
        validUntil: new Date(input.quote.validUntil),
        createdByUserId: auth.userId,
      });
      await tx.insert(schema.quoteLine).values(
        priced.lines.map((l) => ({
          quoteId,
          seq: l.seq,
          kind: l.kind as (typeof input.quote.lines)[number]['kind'],
          description: l.description,
          quantity: l.quantity,
          unitPricePaise: l.unitPricePaise,
          taxPaise: l.taxPaise,
          lineTotalPaise: l.lineTotalPaise,
        })),
      );
      await this.transitions.created(tx, quoteMachine, quoteId, 'DRAFT', actor, opts);
      await this.transitions.move(tx, quoteMachine, quoteId, 'DRAFT', 'CALCULATED', sys, opts);
      await this.transitions.move(
        tx,
        quoteMachine,
        quoteId,
        'CALCULATED',
        'PRESENTED',
        actor,
        opts,
      );
      await this.transitions.move(tx, quoteMachine, quoteId, 'PRESENTED', 'LOCKED', actor, {
        ...opts,
        reason: `Accepted by the customer via ${input.quote.acceptedVia}`,
      });
      await tx
        .update(quote)
        .set({ lockedAt: new Date(), acceptedVia: input.quote.acceptedVia })
        .where(eq(quote.id, quoteId));

      // Booking: REQUESTED (quote is LOCKED) → PENDING_CONFIRMATION.
      await tx
        .update(booking)
        .set({ activeItineraryId: itineraryId, activeQuoteId: quoteId })
        .where(eq(booking.id, id));
      await this.transitions.created(tx, bookingMachine, id, 'REQUESTED', actor, opts);
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
          actor,
          opts,
        );
      }

      await this.audit.record(
        {
          action: 'booking.manual_created',
          correlationId,
          actorUserId: auth.userId,
          entityType: 'booking',
          entityId: id,
          metadata: { channel: input.source.channel, totalPaise: priced.totalPaise },
        },
        tx,
      );
      return id;
    });
    return this.detail(bookingId);
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
    const stops = itin
      ? await this.db
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
          .where(eq(schema.itineraryStop.itineraryId, itin.id))
          .orderBy(asc(schema.itineraryStop.seq))
      : [];
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

    const entityIds = [
      b.id,
      itin?.id,
      q?.id,
      t?.id,
      ...payments.map((p) => p.id),
      ...components.map((c) => c.id),
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
          reference: p.reference,
          receivedOn: p.receivedOn,
          recordedBy: p.recordedByUserId,
          confirmedBy: p.confirmedByUserId,
          reason: p.reason,
        })),
      },
      fulfilment: {
        state: fulfilmentState,
        components: components.map(({ bookingId: _, ...c }) => c),
      },
      confirmation: gate,
      trip: t ? { id: t.id, state: t.state } : null,
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

  /** Serialises changes to one booking so the gate is evaluated on consistent data. */
  private async lockBooking(tx: Tx, bookingId: string) {
    const [b] = await tx.select().from(booking).where(eq(booking.id, bookingId)).for('update');
    if (!b) throw new NotFoundException('Booking not found');
    return b;
  }

  private async balance(tx: Tx, b: typeof booking.$inferSelect) {
    const [q] = await tx.select().from(quote).where(eq(quote.id, b.activeQuoteId!));
    const ps = await tx.select().from(payment).where(eq(payment.bookingId, b.id));
    const paid = netPaidPaise(ps.map(snapshot));
    const pending = ps.filter((p) => p.state === 'PENDING').reduce((s, p) => s + p.amountPaise, 0);
    return { totalPaise: q!.totalPaise, dueAfterPending: q!.totalPaise - paid - pending };
  }

  /**
   * Re-checks the parallel confirmation gate (FS §33) after any payment or fulfilment change.
   * Opens: PENDING_CONFIRMATION → CONFIRMED and the Trip is created. Closes: back to pending.
   */
  private async reevaluate(tx: Tx, bookingId: string, triggeredBy: string, correlationId: string) {
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
}

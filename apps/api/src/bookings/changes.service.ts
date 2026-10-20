import { randomUUID } from 'node:crypto';
import { schema, type Database } from '@navagraha/db';
import {
  changeRequestMachine,
  fulfilmentComponentMachine,
  inActingOrder,
  itineraryMachine,
  quoteMachine,
  type AcceptanceChannel,
} from '@navagraha/domain';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray, max } from 'drizzle-orm';
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
import { BookingCore } from './booking-core.js';
import type { ChangeProposalInput, ChangeRequestInput } from './booking.schemas.js';

const {
  booking,
  changeRequest: cr,
  itinerary,
  quote,
  fulfilmentComponent: component,
  trip,
} = schema;
type CrRow = typeof cr.$inferSelect;

/** Bookings that can still be changed: not started, not finished, not cancelled. */
const CHANGEABLE = ['PENDING_CONFIRMATION', 'CONFIRMED'];
const LIVE_COMPONENT = ['PENDING', 'REQUESTED', 'CONFIRMED'];

interface Proposal {
  trip: {
    startDate: string;
    template: '1D' | '2D1N';
    mode: 'FAST' | 'BALANCED' | 'RELAXED';
    pickupLocation: string | null;
    pickupTime: string | null;
  };
  travellers: { id: string; isLead: boolean }[];
  seniorFriendly: boolean;
}

/**
 * Change requests (D-04 §4.4, FS §32). A change is proposed as complete new itinerary and
 * quote versions; when the customer accepts, the old versions are superseded, never edited
 * (NAV-IT-004/005, EC-27). Date changes re-open supplier confirmation (EC-11, EC-20).
 */
@Injectable()
export class ChangesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(TransitionService) private readonly transitions: TransitionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(BookingCore) private readonly core: BookingCore,
  ) {}

  async create(
    bookingId: string,
    input: z.infer<typeof ChangeRequestInput>,
    auth: AuthContext,
    correlationId: string,
  ) {
    const actor = this.actor(auth);
    await this.db.transaction(async (tx) => {
      const b = await this.core.lockBooking(tx, bookingId);
      if (!CHANGEABLE.includes(b.state))
        throw new ConflictException(`A ${b.state.toLowerCase()} booking cannot be changed`);
      await this.assertNoOpenChange(tx, bookingId);
      const id = randomUUID();
      await tx.insert(cr).values({
        id,
        bookingId,
        state: 'REQUESTED',
        kind: input.kind,
        description: input.description,
        requestedVia: input.requestedVia,
        requestedByUserId: auth.userId,
      });
      await this.transitions.created(tx, changeRequestMachine, id, 'REQUESTED', actor, {
        correlationId,
        sourceChannel: input.requestedVia,
        reason: input.description,
      });
      await this.audit.record(
        {
          action: 'change_request.created',
          correlationId,
          actorUserId: auth.userId,
          entityType: 'change_request',
          entityId: id,
          metadata: { bookingId, kind: input.kind },
        },
        tx,
      );
    });
    return bookingId;
  }

  /** Prepares (or replaces) the proposed itinerary and quote. Moves REQUESTED → REVIEWING. */
  async propose(
    crId: string,
    input: ChangeProposalInput,
    auth: AuthContext,
    correlationId: string,
  ) {
    const actor = this.actor(auth);
    const ctx = { actor, correlationId };
    const priced = this.core.price(input.quote.lines);
    if (new Date(input.quote.validUntil) <= new Date())
      throw new BadRequestException('quote.validUntil must be in the future');

    return this.db.transaction(async (tx) => {
      const c = await this.load(tx, crId);
      const b = await this.core.lockBooking(tx, c.bookingId);
      if (!CHANGEABLE.includes(b.state))
        throw new ConflictException(`A ${b.state.toLowerCase()} booking cannot be changed`);
      if (c.state === 'REQUESTED') {
        await this.transitions.move(
          tx,
          changeRequestMachine,
          c.id,
          'REQUESTED',
          'REVIEWING',
          actor,
          { correlationId },
        );
      } else if (c.state !== 'REVIEWING') {
        throw new ConflictException(`This change request is ${c.state.toLowerCase()}`);
      }
      await this.discardProposal(tx, c, auth.userId, correlationId, 'Replaced by a newer proposal');

      const travellers = input.travellers
        ? await this.core.resolveTravellers(tx, b.bookerUserId, input.travellers)
        : await tx
            .select({
              id: schema.bookingTraveller.travellerId,
              isLead: schema.bookingTraveller.isLead,
              ageBand: schema.traveller.ageBand,
            })
            .from(schema.bookingTraveller)
            .innerJoin(
              schema.traveller,
              eq(schema.traveller.id, schema.bookingTraveller.travellerId),
            )
            .where(eq(schema.bookingTraveller.bookingId, b.id));
      const proposal: Proposal = {
        trip: {
          startDate: input.trip.startDate ?? b.startDate,
          template: input.trip.template ?? b.template,
          mode: input.trip.mode ?? b.mode,
          pickupLocation: input.trip.pickupLocation ?? b.pickupLocation,
          pickupTime: input.trip.pickupTime ?? b.pickupTime,
        },
        travellers: travellers.map((t) => ({ id: t.id, isLead: t.isLead })),
        seniorFriendly: travellers.some((t) => t.ageBand.startsWith('SENIOR')) || b.seniorFriendly,
      };

      const circuitTemples = await this.core.circuitTemples(tx, b.circuitId);
      // Vehicle seats are checked when the (possibly new) vehicle is confirmed, not here:
      // a bigger group gets a fresh vehicle request when the change is applied.
      const check = this.core.checkItinerary({
        template: proposal.trip.template,
        startDate: proposal.trip.startDate,
        circuitTempleCodes: circuitTemples.map((t) => t.code),
        stops: input.itinerary.stops,
        travellerCount: travellers.length,
        vehicleSeats: null,
      });

      const [{ iv }] = (await tx
        .select({ iv: max(itinerary.version) })
        .from(itinerary)
        .where(eq(itinerary.bookingId, b.id))) as [{ iv: number | null }];
      const [{ qv }] = (await tx
        .select({ qv: max(quote.version) })
        .from(quote)
        .where(eq(quote.bookingId, b.id))) as [{ qv: number | null }];
      const itineraryId = await this.core.createItinerary(tx, ctx, {
        bookingId: b.id,
        version: (iv ?? 0) + 1,
        parentId: b.activeItineraryId,
        origin: 'CHANGE_REQUEST',
        stops: input.itinerary.stops,
        templeIdByCode: new Map(circuitTemples.map((t) => [t.code, t.id])),
        warnings: check.warnings,
        reason: c.description,
      });
      const quoteId = await this.core.createQuote(tx, ctx, {
        bookingId: b.id,
        version: (qv ?? 0) + 1,
        priced,
        validUntil: new Date(input.quote.validUntil),
      });
      await tx
        .update(cr)
        .set({ proposedItineraryId: itineraryId, proposedQuoteId: quoteId, proposal })
        .where(eq(cr.id, c.id));
      await this.audit.record(
        {
          action: 'change_request.proposed',
          correlationId,
          actorUserId: auth.userId,
          entityType: 'change_request',
          entityId: c.id,
          metadata: { totalPaise: priced.totalPaise },
        },
        tx,
      );
      return b.id;
    });
  }

  /** The customer accepted the proposal (and any price difference): approve and apply it. */
  async approve(
    crId: string,
    acceptedVia: AcceptanceChannel,
    auth: AuthContext,
    correlationId: string,
  ) {
    const actor = this.actor(auth);
    const sys = systemActor(auth.userId);
    const ctx = { actor, correlationId };
    return this.db.transaction(async (tx) => {
      const c = await this.load(tx, crId);
      const b = await this.core.lockBooking(tx, c.bookingId);
      if (c.state !== 'REVIEWING' || !c.proposedItineraryId || !c.proposedQuoteId || !c.proposal) {
        throw new ConflictException('Prepare a proposal before approving the change');
      }
      if (!CHANGEABLE.includes(b.state))
        throw new ConflictException(`A ${b.state.toLowerCase()} booking cannot be changed`);
      const [newQuote] = await tx.select().from(quote).where(eq(quote.id, c.proposedQuoteId));
      if (newQuote!.validUntil <= new Date())
        throw new ConflictException('The proposed quote has expired; prepare a new proposal');
      const p = c.proposal as Proposal;

      // Customer acceptance (D-04 §4.4: the new quote must be LOCKED before APPROVED).
      await this.core.acceptItinerary(tx, ctx, c.proposedItineraryId, acceptedVia);
      await this.core.lockQuote(tx, ctx, c.proposedQuoteId, acceptedVia);
      await this.transitions.move(tx, changeRequestMachine, c.id, 'REVIEWING', 'APPROVED', actor, {
        correlationId,
        reason: `Customer accepted via ${acceptedVia.toLowerCase().replace('_', ' ')}`,
      });
      await tx.update(cr).set({ acceptedVia, decidedByUserId: auth.userId }).where(eq(cr.id, c.id));

      // Apply: supersede the old versions, switch the booking over.
      if (b.activeItineraryId) {
        const [old] = await tx
          .select()
          .from(itinerary)
          .where(eq(itinerary.id, b.activeItineraryId));
        if (old && !itineraryMachine.terminal.includes(old.state)) {
          await this.transitions.move(tx, itineraryMachine, old.id, old.state, 'SUPERSEDED', sys, {
            correlationId,
            reason: `Superseded by v${old.version + 1} (change request)`,
          });
        }
      }
      if (b.activeQuoteId) {
        const [old] = await tx.select().from(quote).where(eq(quote.id, b.activeQuoteId));
        if (old?.state === 'LOCKED') {
          await this.transitions.move(tx, quoteMachine, old.id, 'LOCKED', 'EXPIRED', sys, {
            correlationId,
            reason: 'Superseded by a newer quote (change request)',
          });
        }
      }
      await tx
        .update(booking)
        .set({
          activeItineraryId: c.proposedItineraryId,
          activeQuoteId: c.proposedQuoteId,
          startDate: p.trip.startDate,
          template: p.trip.template,
          mode: p.trip.mode,
          pickupLocation: p.trip.pickupLocation,
          pickupTime: p.trip.pickupTime,
          seniorFriendly: p.seniorFriendly,
        })
        .where(eq(booking.id, b.id));
      await tx.delete(schema.bookingTraveller).where(eq(schema.bookingTraveller.bookingId, b.id));
      await tx
        .insert(schema.bookingTraveller)
        .values(
          p.travellers.map((t) => ({ bookingId: b.id, travellerId: t.id, isLead: t.isLead })),
        );
      await tx.update(trip).set({ startDate: p.trip.startDate }).where(eq(trip.bookingId, b.id));

      await this.adjustSuppliers(tx, b, p, sys, correlationId);

      await this.transitions.move(tx, changeRequestMachine, c.id, 'APPROVED', 'APPLIED', sys, {
        correlationId,
      });
      await this.audit.record(
        {
          action: 'change_request.applied',
          correlationId,
          actorUserId: auth.userId,
          entityType: 'change_request',
          entityId: c.id,
          metadata: { bookingId: b.id, totalPaise: newQuote!.totalPaise },
        },
        tx,
      );
      // A higher total or re-opened suppliers send the booking back to pending (FS §33).
      await this.core.reevaluate(tx, b.id, auth.userId, correlationId);
      return b.id;
    });
  }

  async reject(crId: string, reason: string, auth: AuthContext, correlationId: string) {
    const actor = this.actor(auth);
    return this.db.transaction(async (tx) => {
      const c = await this.load(tx, crId);
      await this.core.lockBooking(tx, c.bookingId);
      if (c.state === 'REQUESTED') {
        await this.transitions.move(
          tx,
          changeRequestMachine,
          c.id,
          'REQUESTED',
          'REVIEWING',
          actor,
          { correlationId },
        );
      } else if (c.state !== 'REVIEWING') {
        throw new ConflictException(`This change request is ${c.state.toLowerCase()}`);
      }
      await this.transitions.move(tx, changeRequestMachine, c.id, 'REVIEWING', 'REJECTED', actor, {
        correlationId,
        reason,
      });
      await tx
        .update(cr)
        .set({ decisionReason: reason, decidedByUserId: auth.userId })
        .where(eq(cr.id, c.id));
      await this.discardProposal(tx, c, auth.userId, correlationId, 'Change request rejected');
      return c.bookingId;
    });
  }

  async withdraw(
    crId: string,
    auth: AuthContext,
    correlationId: string,
    reason = 'Customer withdrew the request',
  ) {
    return this.db.transaction(async (tx) => {
      const c = await this.load(tx, crId);
      await this.core.lockBooking(tx, c.bookingId);
      await this.withdrawIn(tx, c, this.actor(auth), auth.userId, correlationId, reason);
      return c.bookingId;
    });
  }

  /** Used by cancellation too: an open change request ends when the booking is cancelled. */
  async withdrawOpen(
    tx: Tx,
    bookingId: string,
    actor: Actor,
    userId: string,
    correlationId: string,
    reason: string,
  ) {
    const [open] = await tx
      .select()
      .from(cr)
      .where(and(eq(cr.bookingId, bookingId), inArray(cr.state, ['REQUESTED', 'REVIEWING'])));
    if (open) await this.withdrawIn(tx, open, actor, userId, correlationId, reason);
  }

  // ---------------------------------------------------------------- internals

  private actor(auth: AuthContext): Actor {
    return { userId: auth.userId, roles: inActingOrder(auth.roles) };
  }

  private async load(tx: Tx, crId: string) {
    const [c] = await tx.select().from(cr).where(eq(cr.id, crId));
    if (!c) throw new NotFoundException('Change request not found');
    return c;
  }

  private async assertNoOpenChange(tx: Tx, bookingId: string) {
    const [open] = await tx
      .select({ id: cr.id })
      .from(cr)
      .where(
        and(eq(cr.bookingId, bookingId), inArray(cr.state, ['REQUESTED', 'REVIEWING', 'APPROVED'])),
      );
    if (open) throw new ConflictException('This booking already has an open change request');
  }

  private async withdrawIn(
    tx: Tx,
    c: CrRow,
    actor: Actor,
    userId: string,
    correlationId: string,
    reason: string,
  ) {
    if (c.state !== 'REQUESTED' && c.state !== 'REVIEWING') {
      throw new ConflictException(`This change request is ${c.state.toLowerCase()}`);
    }
    await this.transitions.move(tx, changeRequestMachine, c.id, c.state, 'WITHDRAWN', actor, {
      correlationId,
      reason,
    });
    await tx
      .update(cr)
      .set({ decisionReason: reason, decidedByUserId: userId })
      .where(eq(cr.id, c.id));
    await this.discardProposal(tx, c, userId, correlationId, reason);
  }

  /** Proposed versions that will never be used are abandoned / cancelled, not deleted. */
  private async discardProposal(
    tx: Tx,
    c: CrRow,
    userId: string,
    correlationId: string,
    reason: string,
  ) {
    const sys = systemActor(userId);
    if (c.proposedItineraryId) {
      const [i] = await tx.select().from(itinerary).where(eq(itinerary.id, c.proposedItineraryId));
      if (i && !itineraryMachine.terminal.includes(i.state)) {
        await this.transitions.move(tx, itineraryMachine, i.id, i.state, 'ABANDONED', sys, {
          correlationId,
          reason,
        });
      }
    }
    if (c.proposedQuoteId) {
      const [q] = await tx.select().from(quote).where(eq(quote.id, c.proposedQuoteId));
      if (q && (q.state === 'DRAFT' || q.state === 'CALCULATED' || q.state === 'PRESENTED')) {
        await this.transitions.move(tx, quoteMachine, q.id, q.state, 'CANCELLED', sys, {
          correlationId,
          reason,
        });
      }
    }
    await tx
      .update(cr)
      .set({ proposedItineraryId: null, proposedQuoteId: null, proposal: null })
      .where(eq(cr.id, c.id));
  }

  /**
   * Supplier items after a change:
   * - new date: every live item is released / cancelled and requested again (EC-11, EC-20);
   * - 1D ↔ 2D/1N: the hotel night is added or released;
   * - more travellers than the confirmed vehicle seats: the vehicle is requested again (EC-28).
   */
  private async adjustSuppliers(
    tx: Tx,
    b: typeof booking.$inferSelect,
    p: Proposal,
    sys: Actor,
    correlationId: string,
  ) {
    const live = (await tx.select().from(component).where(eq(component.bookingId, b.id))).filter(
      (x) => LIVE_COMPONENT.includes(x.state),
    );
    const end = async (x: (typeof live)[number], reason: string) => {
      await this.transitions.move(
        tx,
        fulfilmentComponentMachine,
        x.id,
        x.state,
        x.state === 'CONFIRMED' ? 'RELEASED' : 'CANCELLED',
        sys,
        { correlationId, reason },
      );
    };
    const again = async (
      x: Pick<
        (typeof live)[number],
        'slot' | 'kind' | 'mandatory' | 'description' | 'supplierName'
      >,
      capacity: number | null,
    ) => {
      const id = randomUUID();
      await tx.insert(component).values({
        id,
        bookingId: b.id,
        slot: x.slot,
        kind: x.kind,
        mandatory: x.mandatory,
        state: 'PENDING',
        description: x.description,
        supplierName: x.supplierName,
        capacity,
      });
      await this.transitions.created(tx, fulfilmentComponentMachine, id, 'PENDING', sys, {
        correlationId,
      });
    };

    const dateChanged = p.trip.startDate !== b.startDate;
    for (const x of live) {
      const hotelNoLongerNeeded =
        x.kind === 'HOTEL' && p.trip.template === '1D' && b.template === '2D1N';
      const vehicleTooSmall =
        x.kind === 'VEHICLE' && x.state === 'CONFIRMED' && (x.capacity ?? 0) < p.travellers.length;
      if (hotelNoLongerNeeded) {
        await end(x, 'Trip changed to one day; hotel night no longer needed');
      } else if (dateChanged && x.state !== 'PENDING') {
        await end(
          x,
          `Travel date changed from ${b.startDate} to ${p.trip.startDate}; ask the supplier again`,
        );
        await again(
          x,
          x.kind === 'VEHICLE' && (x.capacity ?? 0) < p.travellers.length ? null : x.capacity,
        );
      } else if (vehicleTooSmall) {
        await end(x, `Group grew to ${p.travellers.length}; the vehicle seats ${x.capacity}`);
        await again(x, null);
      }
    }
    if (
      p.trip.template === '2D1N' &&
      b.template === '1D' &&
      !live.some((x) => x.kind === 'HOTEL')
    ) {
      await again(
        {
          slot: 'hotel:night-1',
          kind: 'HOTEL',
          mandatory: true,
          description: null,
          supplierName: null,
        },
        null,
      );
    }
  }
}

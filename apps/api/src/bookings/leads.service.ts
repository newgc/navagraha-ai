import { schema, type Database } from '@navagraha/db';
import { inActingOrder, leadMachine, maskPhone, type Role } from '@navagraha/domain';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { DB } from '../db/db.module.js';
import { WHATSAPP, type WhatsAppMessenger } from '../messaging/whatsapp.js';
import {
  systemActor,
  TransitionService,
  type Actor,
  type Tx,
} from '../state/transition.service.js';
import { BookingCore, OPEN_STATES, today } from './booking-core.js';
import type { LeadProposalInput, TripRequestInput } from './booking.schemas.js';
import { BookingsService } from './bookings.service.js';
import { PaymentLinksService } from './payment-links.service.js';

const { lead, leadProposal, booking, appUser, temple } = schema;

const OPEN_LEAD = ['NEW', 'QUALIFIED', 'PLANNING', 'QUOTED'] as const;

/** What the customer sees of a request's progress. */
const CUSTOMER_STATUS: Record<string, string> = {
  NEW: 'RECEIVED',
  QUALIFIED: 'RECEIVED',
  PLANNING: 'BEING_PLANNED',
  QUOTED: 'PLAN_READY',
  CONVERTED: 'BOOKED',
  LOST: 'CLOSED',
};

/**
 * Self-service booking, first version (Product Owner, 21 Oct 2026): the customer sends a
 * trip request on the website; operations plan and price it by hand as proposals (D-20
 * sign-off, prices entered until the D-08 rate card exists); the customer accepts one and
 * pays online. Nothing here invents a plan, price or availability (NAV-AI-007).
 */
@Injectable()
export class LeadsService {
  private readonly logger = new Logger('Leads');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(WHATSAPP) private readonly whatsapp: WhatsAppMessenger | null,
    @Inject(TransitionService) private readonly transitions: TransitionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(BookingCore) private readonly core: BookingCore,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(PaymentLinksService) private readonly links: PaymentLinksService,
  ) {}

  // ---------------------------------------------------------------- customer: request

  async submit(input: TripRequestInput, auth: AuthContext, correlationId: string) {
    if (input.startDate <= today()) {
      throw new BadRequestException('startDate: choose a date from tomorrow onwards');
    }
    const [user] = await this.db.select().from(appUser).where(eq(appUser.id, auth.userId));
    if (!user?.phone) throw new ForbiddenException('Sign in with your mobile number first');

    const reference = await this.db.transaction(async (tx) => {
      // Fill in the profile from the form, never overwriting what the person already has.
      await tx
        .update(appUser)
        .set({
          displayName: user.displayName ?? input.contact.name,
          email: user.email ?? input.contact.email ?? null,
        })
        .where(eq(appUser.id, user.id));
      const [row] = await tx
        .insert(lead)
        .values({
          state: 'NEW',
          customerUserId: user.id,
          sourceChannel: 'WEB',
          request: input,
          startDate: input.startDate,
        })
        .returning();
      await this.transitions.created(tx, leadMachine, row!.id, 'NEW', systemActor(auth.userId), {
        correlationId,
        sourceChannel: 'WEB',
        reason: 'Trip request sent from the website',
      });
      await this.audit.record(
        {
          action: 'lead.submitted',
          correlationId,
          actorUserId: auth.userId,
          entityType: 'lead',
          entityId: row!.id,
          metadata: { startDate: input.startDate, travellers: input.travellers.length },
        },
        tx,
      );
      return row!.reference;
    });

    await this.message(
      user.phone,
      `Namaste ${input.contact.name},\n\nWe have received your Navagraha pilgrimage request ${reference}. ` +
        'Our team will plan it personally and send you the itinerary and price here on WhatsApp.',
      reference,
    );
    return { reference };
  }

  // ---------------------------------------------------------------- operations

  async list(state?: string) {
    const rows = await this.db
      .select({ lead, customer: appUser })
      .from(lead)
      .innerJoin(appUser, eq(appUser.id, lead.customerUserId))
      .where(state ? eq(lead.state, state as (typeof OPEN_LEAD)[number]) : undefined)
      .orderBy(desc(lead.createdAt))
      .limit(200);
    return rows.map(({ lead: l, customer }) => ({
      reference: l.reference,
      state: l.state,
      startDate: l.startDate,
      createdAt: l.createdAt,
      customer: { name: customer.displayName, phone: customer.phone },
      travellers: (l.request as TripRequestInput).travellers.length,
      days: (l.request as TripRequestInput).days,
    }));
  }

  async detail(reference: string) {
    const l = await this.byReference(this.db, reference);
    const [customer] = await this.db.select().from(appUser).where(eq(appUser.id, l.customerUserId));
    const proposals = await this.db
      .select()
      .from(leadProposal)
      .where(eq(leadProposal.leadId, l.id))
      .orderBy(asc(leadProposal.version));
    const [b] = l.bookingId
      ? await this.db
          .select({ reference: booking.reference })
          .from(booking)
          .where(eq(booking.id, l.bookingId))
      : [];
    const history = await this.db
      .select()
      .from(schema.stateTransition)
      .where(eq(schema.stateTransition.entityId, l.id))
      .orderBy(asc(schema.stateTransition.id));
    return {
      reference: l.reference,
      state: l.state,
      createdAt: l.createdAt,
      request: l.request as TripRequestInput,
      customer: {
        id: customer!.id,
        name: customer!.displayName,
        phone: customer!.phone,
        email: customer!.email,
      },
      lostReason: l.lostReason,
      booking: b ? { reference: b.reference } : null,
      proposals: proposals.map((p) => ({
        id: p.id,
        version: p.version,
        plan: p.plan,
        subtotalPaise: p.subtotalPaise,
        taxPaise: p.taxPaise,
        totalPaise: p.totalPaise,
        validUntil: p.validUntil,
        validation: p.validation,
        createdBy: p.createdByUserId,
        createdAt: p.createdAt,
        accepted: l.acceptedProposalId === p.id,
      })),
      history: history.map((h) => ({
        from: h.fromState,
        to: h.toState,
        actorRole: h.actorRole,
        actorUserId: h.actorUserId,
        reason: h.reason,
        recordedAt: h.recordedAt,
      })),
    };
  }

  async startPlanning(reference: string, auth: AuthContext, correlationId: string) {
    await this.db.transaction(async (tx) => {
      const l = await this.byReference(tx, reference, true);
      if (l.state !== 'NEW' && l.state !== 'QUALIFIED') {
        throw new ConflictException(`Request is ${l.state}`);
      }
      await this.transitions.move(tx, leadMachine, l.id, l.state, 'PLANNING', this.actor(auth), {
        correlationId,
      });
    });
    return this.detail(reference);
  }

  /**
   * A complete plan and price for the customer, checked like a concierge booking (D-20
   * structural check + the coordinator's timing sign-off). A revision is a new version.
   */
  async propose(
    reference: string,
    input: LeadProposalInput,
    auth: AuthContext,
    correlationId: string,
  ) {
    const validUntil = new Date(input.quote.validUntil);
    if (validUntil <= new Date()) {
      throw new BadRequestException('quote.validUntil must be in the future');
    }
    const priced = this.core.price(input.quote.lines);
    const { customerPhone, version, totalPaise } = await this.db.transaction(async (tx) => {
      const l = await this.byReference(tx, reference, true);
      if (!(OPEN_LEAD as readonly string[]).includes(l.state)) {
        throw new ConflictException(`Request is ${l.state}`);
      }
      const [circ] = await tx
        .select()
        .from(schema.circuit)
        .where(eq(schema.circuit.code, input.trip.circuitCode));
      if (!circ) throw new BadRequestException(`Unknown circuit ${input.trip.circuitCode}`);
      const circuitTemples = await this.core.circuitTemples(tx, circ.id);
      const seats = (input.fulfilment ?? [])
        .filter((f) => f.kind === 'VEHICLE' && f.capacity)
        .map((f) => f.capacity!);
      const check = this.core.checkItinerary({
        template: input.trip.template,
        startDate: input.trip.startDate,
        circuitTempleCodes: circuitTemples.map((t) => t.code),
        stops: input.itinerary.stops,
        travellerCount: input.travellers.length,
        vehicleSeats: seats.length ? seats.reduce((a, b) => a + b, 0) : null,
      });

      const actor = this.actor(auth);
      if (l.state === 'NEW' || l.state === 'QUALIFIED') {
        await this.transitions.move(tx, leadMachine, l.id, l.state, 'PLANNING', actor, {
          correlationId,
        });
      }
      const [last] = await tx
        .select({ version: leadProposal.version })
        .from(leadProposal)
        .where(eq(leadProposal.leadId, l.id))
        .orderBy(desc(leadProposal.version))
        .limit(1);
      const version = (last?.version ?? 0) + 1;
      const { timingsCheckedByCoordinator: _, ...itinerary } = input.itinerary;
      const [row] = await tx
        .insert(leadProposal)
        .values({
          leadId: l.id,
          version,
          plan: { ...input, itinerary, quote: { lines: input.quote.lines } },
          subtotalPaise: priced.subtotalPaise,
          taxPaise: priced.taxPaise,
          totalPaise: priced.totalPaise,
          validUntil,
          validation: {
            level: 'STRUCTURAL_WITH_OPS_SIGN_OFF',
            engineChecked: false,
            warnings: check.warnings,
            signedOffBy: auth.userId,
            signedOffAt: new Date().toISOString(),
          },
          createdByUserId: auth.userId,
        })
        .returning();
      if (l.state !== 'QUOTED') {
        await this.transitions.move(
          tx,
          leadMachine,
          l.id,
          'PLANNING',
          'QUOTED',
          systemActor(auth.userId),
          { correlationId, reason: `Proposal v${version} sent to the customer` },
        );
      }
      await this.audit.record(
        {
          action: 'lead.proposal_sent',
          correlationId,
          actorUserId: auth.userId,
          entityType: 'lead',
          entityId: l.id,
          metadata: { proposalId: row!.id, version, totalPaise: priced.totalPaise },
        },
        tx,
      );
      const [customer] = await tx.select().from(appUser).where(eq(appUser.id, l.customerUserId));
      return { customerPhone: customer!.phone, version, totalPaise: priced.totalPaise };
    });

    if (customerPhone) {
      const rupees = (totalPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });
      const where = this.config.PUBLIC_WEB_URL
        ? `${this.config.PUBLIC_WEB_URL.replace(/\/+$/, '')}/trips/${reference}`
        : 'your trips page';
      await this.message(
        customerPhone,
        `${version > 1 ? 'Your updated' : 'Your'} Navagraha pilgrimage plan (${reference}) is ready: ₹${rupees}.\n\n` +
          `See the itinerary, accept it and pay securely here:\n${where}`,
        reference,
      );
    }
    return this.detail(reference);
  }

  async markLost(reference: string, reason: string, auth: AuthContext, correlationId: string) {
    await this.db.transaction(async (tx) => {
      const l = await this.byReference(tx, reference, true);
      if (!(OPEN_LEAD as readonly string[]).includes(l.state)) {
        throw new ConflictException(`Request is ${l.state}`);
      }
      await this.transitions.move(tx, leadMachine, l.id, l.state, 'LOST', this.actor(auth), {
        correlationId,
        reason,
      });
      await tx.update(lead).set({ lostReason: reason }).where(eq(lead.id, l.id));
    });
    return this.detail(reference);
  }

  // ---------------------------------------------------------------- customer: view and accept

  /** The signed-in customer's requests and bookings. */
  async mine(auth: AuthContext) {
    const leads = await this.db
      .select()
      .from(lead)
      .where(eq(lead.customerUserId, auth.userId))
      .orderBy(desc(lead.createdAt));
    const bookings = await this.db
      .select()
      .from(booking)
      .where(eq(booking.bookerUserId, auth.userId))
      .orderBy(desc(booking.startDate));
    const proposals = leads.length
      ? await this.db
          .select()
          .from(leadProposal)
          .where(
            inArray(
              leadProposal.leadId,
              leads.map((l) => l.id),
            ),
          )
      : [];
    return {
      requests: leads
        .filter((l) => !l.bookingId)
        .map((l) => {
          const latest = proposals
            .filter((p) => p.leadId === l.id)
            .sort((a, b) => b.version - a.version)[0];
          return {
            reference: l.reference,
            status: CUSTOMER_STATUS[l.state],
            startDate: l.startDate,
            createdAt: l.createdAt,
            proposal:
              latest && l.state === 'QUOTED'
                ? { totalPaise: latest.totalPaise, validUntil: latest.validUntil }
                : null,
          };
        }),
      bookings: bookings.map((b) => ({
        reference: b.reference,
        state: b.state,
        startDate: b.startDate,
        template: b.template,
      })),
    };
  }

  /** A request and its current proposal, as the customer sees it. */
  async myRequest(reference: string, auth: AuthContext) {
    const l = await this.byReference(this.db, reference);
    if (l.customerUserId !== auth.userId) throw new NotFoundException('Request not found');
    const [latest] = await this.db
      .select()
      .from(leadProposal)
      .where(eq(leadProposal.leadId, l.id))
      .orderBy(desc(leadProposal.version))
      .limit(1);
    const [b] = l.bookingId
      ? await this.db.select().from(booking).where(eq(booking.id, l.bookingId))
      : [];
    return {
      reference: l.reference,
      status: CUSTOMER_STATUS[l.state],
      request: l.request as TripRequestInput,
      booking: b ? { reference: b.reference } : null,
      proposal: latest && l.state === 'QUOTED' ? await this.customerProposal(latest) : null,
    };
  }

  private async customerProposal(p: typeof leadProposal.$inferSelect) {
    const plan = p.plan as LeadProposalInput;
    const names = await this.templeNames(plan.itinerary.stops.map((s) => s.templeCode));
    return {
      version: p.version,
      validUntil: p.validUntil,
      expired: p.validUntil <= new Date(),
      trip: {
        startDate: plan.trip.startDate,
        template: plan.trip.template,
        mode: plan.trip.mode,
        pickupLocation: plan.trip.pickupLocation ?? null,
        pickupTime: plan.trip.pickupTime ?? null,
      },
      travellers: plan.travellers.map((t) => ({ fullName: t.fullName, ageBand: t.ageBand })),
      stops: plan.itinerary.stops.map((s) => ({
        day: s.day,
        temple: names.get(s.templeCode.toUpperCase()) ?? s.templeCode,
        plannedArrival: s.plannedArrival ?? null,
      })),
      lines: plan.quote.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitPricePaise: l.unitPricePaise,
        taxPaise: l.taxPaise ?? 0,
      })),
      subtotalPaise: p.subtotalPaise,
      taxPaise: p.taxPaise,
      totalPaise: p.totalPaise,
      // D-20 / NAV-AI-008: say how the plan was checked.
      checked:
        'Planned and checked by our team; timings are confirmed with temples and drivers before your trip.',
    };
  }

  /**
   * The customer accepts the newest proposal (MR-13: within its validity). It becomes a
   * booking prepared by the coordinator who wrote the proposal and accepted by the customer
   * on the web (D-04: itinerary PROPOSED → ACCEPTED and quote PRESENTED → LOCKED by CUSTOMER).
   */
  async accept(reference: string, version: number, auth: AuthContext, correlationId: string) {
    const bookingReference = await this.db.transaction(async (tx) => {
      const l = await this.byReference(tx, reference, true);
      if (l.customerUserId !== auth.userId) throw new NotFoundException('Request not found');
      if (l.state === 'CONVERTED') throw new ConflictException('This plan is already booked');
      if (l.state !== 'QUOTED') throw new ConflictException('There is no plan to accept yet');
      const [latest] = await tx
        .select()
        .from(leadProposal)
        .where(eq(leadProposal.leadId, l.id))
        .orderBy(desc(leadProposal.version))
        .limit(1);
      if (!latest || latest.version !== version) {
        throw new ConflictException('The plan was updated; please look at the latest version');
      }
      if (latest.validUntil <= new Date()) {
        throw new GoneException('This price has expired; ask our team for an updated plan');
      }
      const plan = latest.plan as LeadProposalInput;
      const preparer = await this.staffActor(tx, latest.createdByUserId);
      const customer: Actor = { userId: auth.userId, roles: ['CUSTOMER'] };
      const bookingId = await this.bookings.createBooking(tx, {
        bookerUserId: l.customerUserId,
        travellers: plan.travellers.map((t, i) => ({ ...t, isLead: t.isLead ?? i === 0 })),
        trip: { ...plan.trip, circuitCode: plan.trip.circuitCode ?? 'NAVAGRAHA' },
        stops: plan.itinerary.stops,
        priced: this.core.price(plan.quote.lines),
        validUntil: latest.validUntil,
        fulfilment: plan.fulfilment,
        source: { channel: 'WEB', reference: l.reference },
        acceptedVia: 'WEB',
        preparer,
        acceptor: customer,
        correlationId,
        auditAction: 'booking.web_created',
      });
      await this.transitions.move(
        tx,
        leadMachine,
        l.id,
        'QUOTED',
        'CONVERTED',
        systemActor(auth.userId),
        {
          correlationId,
          reason: `Proposal v${version} accepted on the website`,
        },
      );
      await tx
        .update(lead)
        .set({ bookingId, acceptedProposalId: latest.id })
        .where(eq(lead.id, l.id));
      const [b] = await tx
        .select({ reference: booking.reference })
        .from(booking)
        .where(eq(booking.id, bookingId));
      return b!.reference;
    });
    return { bookingReference };
  }

  /** A booking as its customer sees it: plan, price, what is paid and what is pending. */
  async myBooking(reference: string, auth: AuthContext) {
    const id = await this.bookings.idByReference(reference);
    const d = await this.bookings.detail(id);
    const [b] = await this.db.select().from(booking).where(eq(booking.id, id));
    if (b!.bookerUserId !== auth.userId) throw new NotFoundException('Booking not found');
    const openLink = d.payment.items.find(
      (p) =>
        p.state === 'PENDING' &&
        p.link?.url &&
        p.link.expiresAt &&
        new Date(p.link.expiresAt) > new Date(),
    );
    return {
      reference: d.reference,
      state: d.state,
      startDate: d.startDate,
      template: d.template,
      mode: d.mode,
      pickup: d.pickup,
      travellers: d.travellers.map((t) => ({ fullName: t.fullName, ageBand: t.ageBand })),
      stops: d.itinerary?.stops ?? [],
      quote: d.quote && {
        totalPaise: d.quote.totalPaise,
        taxPaise: d.quote.taxPaise,
        lines: d.quote.lines.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unitPricePaise: l.unitPricePaise,
          taxPaise: l.taxPaise,
        })),
      },
      payment: {
        totalPaise: d.payment.totalPaise,
        paidPaise: d.payment.paidPaise,
        duePaise: d.payment.duePaise,
        payable:
          d.payment.gatewayEnabled &&
          d.payment.duePaise > 0 &&
          (OPEN_STATES as readonly string[]).includes(d.state),
        openLink: openLink?.link?.url ?? null,
      },
      confirmation: d.confirmation,
      // Supplier names and references stay internal; the customer sees progress only.
      arrangements: {
        state: d.fulfilment.state,
        confirmed: d.fulfilment.components.filter((c) => c.state === 'CONFIRMED').length,
        total: d.fulfilment.components.filter((c) => c.mandatory).length,
      },
    };
  }

  /** Customer "Pay now": the open link for the balance, or a new one. Never marks anything paid. */
  async pay(reference: string, auth: AuthContext, correlationId: string) {
    const view = await this.myBooking(reference, auth);
    if (view.payment.openLink) return { url: view.payment.openLink };
    if (!view.payment.payable) throw new ConflictException('Nothing is due on this booking');
    const id = await this.bookings.idByReference(reference);
    const link = await this.links.create(id, {}, auth, correlationId, { notify: false });
    return { url: link.url };
  }

  // ---------------------------------------------------------------- internals

  private async byReference(tx: Tx | Database, reference: string, forUpdate = false) {
    const q = tx.select().from(lead).where(eq(lead.reference, reference));
    const [l] = forUpdate ? await q.for('update') : await q;
    if (!l) throw new NotFoundException('Request not found');
    return l;
  }

  private actor(auth: AuthContext): Actor {
    return { userId: auth.userId, roles: inActingOrder(auth.roles) };
  }

  /** The proposal's author with their staff roles, so history records the coordinator. */
  private async staffActor(tx: Tx, userId: string): Promise<Actor> {
    const roles = await tx
      .select({ role: schema.appUserRole.role })
      .from(schema.appUserRole)
      .where(eq(schema.appUserRole.userId, userId));
    return { userId, roles: inActingOrder(roles.map((r) => r.role as Role)) };
  }

  private async templeNames(codes: string[]) {
    const upper = [...new Set(codes.map((c) => c.toUpperCase()))];
    const rows = upper.length
      ? await this.db
          .select({ code: temple.code, name: temple.commonName })
          .from(temple)
          .where(inArray(temple.code, upper))
      : [];
    return new Map(rows.map((r) => [r.code, r.name]));
  }

  private async message(phone: string, text: string, reference: string) {
    if (!this.whatsapp) return;
    try {
      await this.whatsapp.sendText(phone, text);
    } catch (err) {
      this.logger.warn(
        `WhatsApp to ${maskPhone(phone)} about ${reference} failed: ${(err as Error).message}`,
      );
    }
  }
}

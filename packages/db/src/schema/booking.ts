import {
  ACCEPTANCE_CHANNELS,
  FULFILMENT_KINDS,
  MODES,
  PAYMENT_METHODS,
  QUOTE_LINE_KINDS,
  SOURCE_CHANNELS,
  TEMPLATES,
  CHANGE_KINDS,
  REFUND_METHODS,
  bookingMachine,
  cancellationMachine,
  changeRequestMachine,
  fulfilmentComponentMachine,
  itineraryMachine,
  leadMachine,
  paymentMachine,
  quoteMachine,
  refundMachine,
  tripMachine,
} from '@navagraha/domain';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSequence,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { id, timestamps } from './common.js';
import { circuit, temple } from './master-data.js';
import { appUser, traveller } from './identity.js';

/** Postgres enums are generated from the D-04 machine definitions, so DB and domain agree. */
const states = <S extends string>(m: { states: readonly S[] }) => m.states as [S, ...S[]];
const values = <S extends string>(v: readonly S[]) => v as unknown as [S, ...S[]];

export const bookingState = pgEnum('booking_state', states(bookingMachine));
export const itineraryState = pgEnum('itinerary_state', states(itineraryMachine));
export const quoteState = pgEnum('quote_state', states(quoteMachine));
export const paymentState = pgEnum('payment_state', states(paymentMachine));
export const fulfilmentComponentState = pgEnum(
  'fulfilment_component_state',
  states(fulfilmentComponentMachine),
);
export const tripState = pgEnum('trip_state', states(tripMachine));
export const changeRequestState = pgEnum('change_request_state', states(changeRequestMachine));
export const cancellationState = pgEnum('cancellation_state', states(cancellationMachine));
export const refundState = pgEnum('refund_state', states(refundMachine));
export const changeKind = pgEnum('change_kind', values(CHANGE_KINDS));
export const refundMethod = pgEnum('refund_method', values(REFUND_METHODS));

export const templateCode = pgEnum('template_code', values(TEMPLATES));
export const planningMode = pgEnum('planning_mode', values(MODES));
export const sourceChannel = pgEnum('source_channel', values(SOURCE_CHANNELS));
export const paymentMethod = pgEnum('payment_method', values(PAYMENT_METHODS));
export const fulfilmentKind = pgEnum('fulfilment_kind', values(FULFILMENT_KINDS));
export const quoteLineKind = pgEnum('quote_line_kind', values(QUOTE_LINE_KINDS));
export const acceptanceChannel = pgEnum('acceptance_channel', values(ACCEPTANCE_CHANNELS));

export const bookingReferenceSeq = pgSequence('booking_reference_seq', { startWith: 1001 });

/** FS §14 Booking — the customer's commercial booking. Manual (concierge) bookings use it too (EC-38). */
export const booking = pgTable(
  'booking',
  {
    id: id(),
    /** Human reference quoted on the phone and on receipts, e.g. NAV-001001. */
    reference: text('reference')
      .notNull()
      .default(sql`'NAV-' || lpad(nextval('booking_reference_seq')::text, 6, '0')`),
    state: bookingState('state').notNull(),
    bookerUserId: uuid('booker_user_id')
      .notNull()
      .references(() => appUser.id),
    circuitId: uuid('circuit_id')
      .notNull()
      .references(() => circuit.id),
    startDate: date('start_date').notNull(),
    template: templateCode('template').notNull(),
    mode: planningMode('mode').notNull(),
    seniorFriendly: boolean('senior_friendly').notNull().default(false),
    /** Essential / Comfort / Premium — open under D-02, so free text for now. */
    tier: text('tier'),
    pickupLocation: text('pickup_location'),
    pickupTime: time('pickup_time'),
    sourceChannel: sourceChannel('source_channel').notNull(),
    sourceReference: text('source_reference'),
    /** D-06 payment condition for the confirmation gate; defaults to full payment (D-04 Q1). */
    paymentPolicy: jsonb('payment_policy').notNull().default({ kind: 'FULL_PAYMENT' }),
    activeItineraryId: uuid('active_itinerary_id').references((): AnyPgColumn => itinerary.id),
    activeQuoteId: uuid('active_quote_id').references((): AnyPgColumn => quote.id),
    notes: text('notes'),
    createdByUserId: uuid('created_by_user_id').references(() => appUser.id),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('booking_reference_uq').on(t.reference),
    index('booking_start_date_idx').on(t.startDate),
    index('booking_booker_idx').on(t.bookerUserId),
  ],
);

/** MR-02 — who is travelling on a booking; one may be the lead traveller. */
export const bookingTraveller = pgTable(
  'booking_traveller',
  {
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => booking.id),
    travellerId: uuid('traveller_id')
      .notNull()
      .references(() => traveller.id),
    isLead: boolean('is_lead').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.bookingId, t.travellerId] })],
);

/** FS §14 Itinerary — one immutable version per row (NAV-IT-004/005). */
export const itinerary = pgTable(
  'itinerary',
  {
    id: id(),
    bookingId: uuid('booking_id')
      .notNull()
      .references((): AnyPgColumn => booking.id),
    version: smallint('version').notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => itinerary.id),
    state: itineraryState('state').notNull(),
    origin: text('origin').notNull(),
    /** D-20: { level, warnings, signedOffBy, signedOffAt } — or the engine's result later. */
    validation: jsonb('validation'),
    reason: text('reason'),
    createdByUserId: uuid('created_by_user_id').references(() => appUser.id),
    ...timestamps(),
  },
  (t) => [uniqueIndex('itinerary_version_uq').on(t.bookingId, t.version)],
);

export const itineraryStop = pgTable(
  'itinerary_stop',
  {
    itineraryId: uuid('itinerary_id')
      .notNull()
      .references(() => itinerary.id),
    seq: smallint('seq').notNull(),
    day: smallint('day').notNull(),
    templeId: uuid('temple_id')
      .notNull()
      .references(() => temple.id),
    plannedArrival: time('planned_arrival'),
    notes: text('notes'),
  },
  (t) => [primaryKey({ columns: [t.itineraryId, t.seq] })],
);

/** FS §10 Quote — an immutable commercial snapshot once CALCULATED. */
export const quote = pgTable(
  'quote',
  {
    id: id(),
    bookingId: uuid('booking_id')
      .notNull()
      .references((): AnyPgColumn => booking.id),
    version: smallint('version').notNull(),
    state: quoteState('state').notNull(),
    currency: text('currency').notNull().default('INR'),
    subtotalPaise: integer('subtotal_paise').notNull(),
    taxPaise: integer('tax_paise').notNull(),
    totalPaise: integer('total_paise').notNull(),
    /** MANUAL until RateCard pricing exists (P4); then RATE_CARD with rateCardVersion. */
    pricingSource: text('pricing_source').notNull(),
    rateCardVersion: text('rate_card_version'),
    validUntil: timestamp('valid_until', { withTimezone: true }).notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    acceptedVia: acceptanceChannel('accepted_via'),
    createdByUserId: uuid('created_by_user_id').references(() => appUser.id),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('quote_version_uq').on(t.bookingId, t.version),
    check('quote_total_chk', sql`${t.totalPaise} = ${t.subtotalPaise} + ${t.taxPaise}`),
  ],
);

export const quoteLine = pgTable(
  'quote_line',
  {
    quoteId: uuid('quote_id')
      .notNull()
      .references(() => quote.id),
    seq: smallint('seq').notNull(),
    kind: quoteLineKind('kind').notNull(),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull(),
    unitPricePaise: integer('unit_price_paise').notNull(),
    taxPaise: integer('tax_paise').notNull(),
    lineTotalPaise: integer('line_total_paise').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.quoteId, t.seq] }),
    check(
      'quote_line_total_chk',
      sql`${t.lineTotalPaise} = ${t.quantity} * ${t.unitPricePaise} + ${t.taxPaise}`,
    ),
  ],
);

/** FS §14 Payment — one row per gateway transaction or offline receipt (D-19). */
export const payment = pgTable(
  'payment',
  {
    id: id(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => booking.id),
    state: paymentState('state').notNull(),
    method: paymentMethod('method').notNull(),
    amountPaise: integer('amount_paise').notNull(),
    capturedPaise: integer('captured_paise').notNull().default(0),
    refundedPaise: integer('refunded_paise').notNull().default(0),
    /** UPI / bank reference, cash receipt number, or gateway payment id. */
    reference: text('reference'),
    receivedOn: date('received_on'),
    recordedByUserId: uuid('recorded_by_user_id').references(() => appUser.id),
    recordedAt: timestamp('recorded_at', { withTimezone: true }),
    confirmedByUserId: uuid('confirmed_by_user_id').references(() => appUser.id),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    reason: text('reason'),
    /** FS §11.2 — always INR today; kept so gateway amounts are never read without it. */
    currency: text('currency').notNull().default('INR'),
    /** Gateway payment link (D-11 Cashfree): our link_id, the customer's URL and its expiry. */
    gatewayLinkId: text('gateway_link_id'),
    gatewayLinkUrl: text('gateway_link_url'),
    gatewayLinkExpiresAt: timestamp('gateway_link_expires_at', { withTimezone: true }),
    /** Set from the gateway's own records when the money is captured (never from the client). */
    gatewayOrderId: text('gateway_order_id'),
    gatewayPaymentId: text('gateway_payment_id'),
    /** FS §11.2 — the gateway's answer the capture was based on. */
    gatewayResponse: jsonb('gateway_response'),
    ...timestamps(),
  },
  (t) => [
    index('payment_booking_idx').on(t.bookingId),
    uniqueIndex('payment_gateway_link_uq').on(t.gatewayLinkId),
    check('payment_gateway_link_chk', sql`${t.gatewayLinkId} is null or ${t.method} = 'GATEWAY'`),
    check(
      'payment_amounts_chk',
      sql`${t.amountPaise} >= 0 and ${t.refundedPaise} <= ${t.capturedPaise}`,
    ),
    check(
      'payment_two_person_chk',
      sql`${t.confirmedByUserId} is null or ${t.recordedByUserId} is null or ${t.confirmedByUserId} <> ${t.recordedByUserId}`,
    ),
  ],
);

/** D-04 §2.3 — one supplier item (vehicle, hotel night, pooja…). The aggregate is derived. */
export const fulfilmentComponent = pgTable(
  'fulfilment_component',
  {
    id: id(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => booking.id),
    slot: text('slot').notNull(),
    kind: fulfilmentKind('kind').notNull(),
    mandatory: boolean('mandatory').notNull(),
    state: fulfilmentComponentState('state').notNull(),
    description: text('description'),
    supplierName: text('supplier_name'),
    supplierReference: text('supplier_reference'),
    /** Seats, for vehicle components. */
    capacity: smallint('capacity'),
    notes: text('notes'),
    ...timestamps(),
  },
  (t) => [index('fulfilment_component_booking_idx').on(t.bookingId)],
);

/** FS §14 Trip — the operational journey, created when the booking is CONFIRMED (D-04 §4.1). */
export const trip = pgTable(
  'trip',
  {
    id: id(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => booking.id),
    state: tripState('state').notNull(),
    startDate: date('start_date').notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('trip_booking_uq').on(t.bookingId),
    index('trip_start_date_idx').on(t.startDate),
  ],
);

/** D-04 §4.4 — a change to a booking, proposed as complete new itinerary and quote versions. */
export const changeRequest = pgTable(
  'change_request',
  {
    id: id(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => booking.id),
    state: changeRequestState('state').notNull(),
    kind: changeKind('kind').notNull(),
    /** What the customer asked for, in their words. */
    description: text('description').notNull(),
    requestedVia: sourceChannel('requested_via').notNull(),
    requestedByUserId: uuid('requested_by_user_id').references(() => appUser.id),
    proposedItineraryId: uuid('proposed_itinerary_id').references(() => itinerary.id),
    proposedQuoteId: uuid('proposed_quote_id').references(() => quote.id),
    /** Trip fields and traveller list that take effect when the change is applied. */
    proposal: jsonb('proposal'),
    acceptedVia: acceptanceChannel('accepted_via'),
    decidedByUserId: uuid('decided_by_user_id').references(() => appUser.id),
    decisionReason: text('decision_reason'),
    ...timestamps(),
  },
  (t) => [
    index('change_request_booking_idx').on(t.bookingId),
    uniqueIndex('change_request_one_open_uq')
      .on(t.bookingId)
      .where(sql`state in ('REQUESTED', 'REVIEWING', 'APPROVED')`),
  ],
);

/** D-04 §4.5 — cancellation, with the refund amount decided by people until D-06. */
export const cancellation = pgTable(
  'cancellation',
  {
    id: id(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => booking.id),
    state: cancellationState('state').notNull(),
    reason: text('reason').notNull(),
    requestedVia: sourceChannel('requested_via').notNull(),
    requestedByUserId: uuid('requested_by_user_id').references(() => appUser.id),
    /** Proposed at review, fixed at approval. Never more than was paid. */
    refundPaise: integer('refund_paise'),
    refundNote: text('refund_note'),
    reviewedByUserId: uuid('reviewed_by_user_id').references(() => appUser.id),
    decidedByUserId: uuid('decided_by_user_id').references(() => appUser.id),
    decisionReason: text('decision_reason'),
    ...timestamps(),
  },
  (t) => [
    index('cancellation_booking_idx').on(t.bookingId),
    uniqueIndex('cancellation_one_open_uq')
      .on(t.bookingId)
      .where(sql`state in ('REQUESTED', 'REVIEWING', 'APPROVED', 'REFUND_PENDING')`),
    check('cancellation_refund_chk', sql`${t.refundPaise} is null or ${t.refundPaise} >= 0`),
  ],
);

/** Money returned to the customer (D-04 §2.2 Refund, D-19 extension: two people). */
export const refund = pgTable(
  'refund',
  {
    id: id(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => booking.id),
    cancellationId: uuid('cancellation_id').references(() => cancellation.id),
    state: refundState('state').notNull(),
    method: refundMethod('method').notNull(),
    amountPaise: integer('amount_paise').notNull(),
    /** Offline refunds: the UPI / bank reference and the day it was paid. */
    reference: text('reference'),
    paidOn: date('paid_on'),
    initiatedByUserId: uuid('initiated_by_user_id').references(() => appUser.id),
    confirmedByUserId: uuid('confirmed_by_user_id').references(() => appUser.id),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    /** [{ paymentId, paise }] — which payments the money came back from. */
    allocations: jsonb('allocations'),
    reason: text('reason'),
    /** Gateway refunds (D-11): the online payment the money goes back to. */
    paymentId: uuid('payment_id').references(() => payment.id),
    /** The second person who approved sending it (D-19 extension), before any money moves. */
    approvedByUserId: uuid('approved_by_user_id').references(() => appUser.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    /** Our refund id at the gateway, its last status and answer. */
    gatewayRefundId: text('gateway_refund_id'),
    gatewayStatus: text('gateway_status'),
    gatewayResponse: jsonb('gateway_response'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index('refund_booking_idx').on(t.bookingId),
    uniqueIndex('refund_gateway_id_uq').on(t.gatewayRefundId),
    check('refund_amount_chk', sql`${t.amountPaise} > 0`),
    check(
      'refund_two_person_chk',
      sql`${t.confirmedByUserId} is null or ${t.initiatedByUserId} is null or ${t.confirmedByUserId} <> ${t.initiatedByUserId}`,
    ),
    check(
      'refund_approval_two_person_chk',
      sql`${t.approvedByUserId} is null or ${t.initiatedByUserId} is null or ${t.approvedByUserId} <> ${t.initiatedByUserId}`,
    ),
    check(
      'refund_method_details_chk',
      // Compared as text: a value added to an enum cannot be used in the same migration.
      sql`(${t.method}::text = 'GATEWAY' and ${t.paymentId} is not null and ${t.gatewayRefundId} is not null)
        or (${t.method}::text <> 'GATEWAY' and ${t.reference} is not null and ${t.paidOn} is not null)`,
    ),
  ],
);

/**
 * MR-19 / NFR-09 — every signed gateway notification, once. A repeat delivery hits the
 * unique key and is acknowledged without being processed again. The notification only
 * triggers a reconciliation against the gateway's API; its contents are kept for support.
 */
export const gatewayEvent = pgTable(
  'gateway_event',
  {
    id: id(),
    provider: text('provider').notNull(),
    /** The provider's idempotency key, or a hash of the raw body when there is none. */
    eventKey: text('event_key').notNull(),
    eventType: text('event_type'),
    linkId: text('link_id'),
    payload: jsonb('payload').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    error: text('error'),
  },
  (t) => [uniqueIndex('gateway_event_key_uq').on(t.provider, t.eventKey)],
);

export const leadState = pgEnum('lead_state', states(leadMachine));
export const leadReferenceSeq = pgSequence('lead_reference_seq', { startWith: 1001 });

/**
 * A customer's trip request from the website (FS §8.1 TripRequest, D-04 §3 Lead). Operations
 * plan and price it as proposals; the customer accepts one and it becomes a booking.
 */
export const lead = pgTable(
  'lead',
  {
    id: id(),
    /** Human reference for the customer and the team, e.g. REQ-001001. */
    reference: text('reference')
      .notNull()
      .default(sql`'REQ-' || lpad(nextval('lead_reference_seq')::text, 6, '0')`),
    state: leadState('state').notNull(),
    customerUserId: uuid('customer_user_id')
      .notNull()
      .references(() => appUser.id),
    sourceChannel: sourceChannel('source_channel').notNull(),
    /** The validated TripRequest exactly as the customer sent it. */
    request: jsonb('request').notNull(),
    startDate: date('start_date').notNull(),
    lostReason: text('lost_reason'),
    acceptedProposalId: uuid('accepted_proposal_id'),
    bookingId: uuid('booking_id').references(() => booking.id),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('lead_reference_uq').on(t.reference),
    index('lead_customer_idx').on(t.customerUserId),
  ],
);

/**
 * One immutable plan and price sent to the customer (itinerary, quote lines, supplier items).
 * A revision is a new version; the newest one that has not expired can be accepted. Nothing
 * here is a booking until the customer accepts (D-04 §2.1: a booking needs a LOCKED quote).
 */
export const leadProposal = pgTable(
  'lead_proposal',
  {
    id: id(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => lead.id),
    version: smallint('version').notNull(),
    /** { trip, travellers, itinerary: { stops }, quote: { lines }, fulfilment } */
    plan: jsonb('plan').notNull(),
    subtotalPaise: integer('subtotal_paise').notNull(),
    taxPaise: integer('tax_paise').notNull(),
    totalPaise: integer('total_paise').notNull(),
    validUntil: timestamp('valid_until', { withTimezone: true }).notNull(),
    /** D-20: structural check warnings and the coordinator who checked timings. */
    validation: jsonb('validation').notNull(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => appUser.id),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('lead_proposal_version_uq').on(t.leadId, t.version),
    check('lead_proposal_total_chk', sql`${t.totalPaise} = ${t.subtotalPaise} + ${t.taxPaise}`),
  ],
);

/**
 * FS §8.2 DecisionRecord — every run of the planning engine: what it was asked, every
 * candidate with its feasibility and failed constraint, the scores and the recommendation,
 * and the versions of the planning settings and verified facts it used.
 */
export const decisionRecord = pgTable(
  'decision_record',
  {
    id: id(),
    /** PLAN: candidates for a request; EVALUATE: check of a given itinerary. */
    kind: text('kind').notNull(),
    leadId: uuid('lead_id').references(() => lead.id),
    input: jsonb('input').notNull(),
    /** DATA_INCOMPLETE / NO_FEASIBLE_PLAN / OK, or FEASIBLE / NOT_FEASIBLE for EVALUATE. */
    status: text('status').notNull(),
    result: jsonb('result').notNull(),
    recommended: text('recommended'),
    configVersion: text('config_version').notNull(),
    factsVersion: text('facts_version').notNull(),
    correlationId: text('correlation_id'),
    createdByUserId: uuid('created_by_user_id').references(() => appUser.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('decision_record_lead_idx').on(t.leadId)],
);

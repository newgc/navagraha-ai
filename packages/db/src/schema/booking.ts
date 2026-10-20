import {
  ACCEPTANCE_CHANNELS,
  FULFILMENT_KINDS,
  MODES,
  PAYMENT_METHODS,
  QUOTE_LINE_KINDS,
  SOURCE_CHANNELS,
  TEMPLATES,
  bookingMachine,
  fulfilmentComponentMachine,
  itineraryMachine,
  paymentMachine,
  quoteMachine,
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
    ...timestamps(),
  },
  (t) => [
    index('payment_booking_idx').on(t.bookingId),
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

import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, provenance, timestamps } from './common.js';

export const circuitStatus = pgEnum('circuit_status', ['DRAFT', 'ACTIVE', 'RETIRED']);

/** FS §35 — Navagraha is the first circuit; others must not need a schema change. */
export const circuit = pgTable('circuit', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  region: text('region').notNull(),
  status: circuitStatus('status').notNull().default('DRAFT'),
  activeFrom: date('active_from'),
  activeTo: date('active_to'),
  sourceVersion: text('source_version'),
  ...timestamps(),
});

/** FS §14 Temple — verified master record (NAV-TEM-001/002). Mirrors the workbook's Temples sheet. */
export const temple = pgTable('temple', {
  id: id(),
  code: text('code').notNull().unique(),
  graha: text('graha'),
  commonName: text('common_name').notNull(),
  officialName: text('official_name'),
  mainDeity: text('main_deity'),
  town: text('town'),
  district: text('district'),
  state: text('state'),
  address: text('address'),
  pinCode: text('pin_code'),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  mapsUrl: text('maps_url'),
  officePhone: text('office_phone'),
  website: text('website'),
  walkFromParkingMetres: integer('walk_from_parking_metres'),
  stepsToClimb: text('steps_to_climb'),
  wheelchairAccess: boolean('wheelchair_access'),
  seatingAvailable: boolean('seating_available'),
  toiletsNearby: boolean('toilets_nearby'),
  visitMinutesNormal: smallint('visit_minutes_normal'),
  visitMinutesBusy: smallint('visit_minutes_busy'),
  parkingNotes: text('parking_notes'),
  seniorNotes: text('senior_notes'),
  ...provenance(),
  ...timestamps(),
});

export const circuitTemple = pgTable(
  'circuit_temple',
  {
    circuitId: uuid('circuit_id')
      .notNull()
      .references(() => circuit.id),
    templeId: uuid('temple_id')
      .notNull()
      .references(() => temple.id),
    /** Display order only; visiting order comes from the itinerary engine. */
    displayOrder: smallint('display_order').notNull(),
  },
  (t) => [primaryKey({ columns: [t.circuitId, t.templeId] })],
);

/** FS §14 TempleSchedule — versioned operating windows (validFrom/validTo). */
export const templeSchedule = pgTable(
  'temple_schedule',
  {
    id: id(),
    templeId: uuid('temple_id')
      .notNull()
      .references(() => temple.id),
    dayType: text('day_type').notNull(),
    session: text('session').notNull(),
    opensAt: time('opens_at').notNull(),
    closesAt: time('closes_at').notNull(),
    lastEntryAt: time('last_entry_at'),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
    ...provenance(),
    ...timestamps(),
  },
  (t) => [index('temple_schedule_temple_idx').on(t.templeId)],
);

/** MR-49 festival calendar, closures, peyarchi, eclipses. */
export const templeSpecialDay = pgTable(
  'temple_special_day',
  {
    id: id(),
    templeId: uuid('temple_id')
      .notNull()
      .references(() => temple.id),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    fromDate: date('from_date').notNull(),
    toDate: date('to_date').notNull(),
    effect: text('effect').notNull(),
    changedOpensAt: time('changed_opens_at'),
    changedClosesAt: time('changed_closes_at'),
    expectedExtraWaitMinutes: smallint('expected_extra_wait_minutes'),
    recursYearly: boolean('recurs_yearly'),
    ...provenance(),
    ...timestamps(),
  },
  (t) => [index('temple_special_day_range_idx').on(t.templeId, t.fromDate, t.toDate)],
);

/** FS §14 TempleService / MR-32 pooja catalogue. Temple fee disclosed separately (MR-33). */
export const templeService = pgTable('temple_service', {
  id: id(),
  code: text('code').notNull().unique(),
  templeId: uuid('temple_id')
    .notNull()
    .references(() => temple.id),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  /** Worded as belief / tradition, never as a guaranteed or medical claim (MR-43). */
  traditionalBelief: text('traditional_belief'),
  availableDays: text('available_days'),
  timeWindow: text('time_window'),
  durationMinutes: smallint('duration_minutes'),
  maxPeoplePerBooking: smallint('max_people_per_booking'),
  bookDaysAhead: smallint('book_days_ahead'),
  bookedVia: text('booked_via'),
  templeFeePaise: integer('temple_fee_paise'),
  feeBasis: text('fee_basis'),
  itemsToBring: text('items_to_bring'),
  itemsAvailable: text('items_available'),
  dressRequirement: text('dress_requirement'),
  active: boolean('active').notNull().default(false),
  ...provenance(),
  ...timestamps(),
});

export const placeKind = pgEnum('place_kind', ['TEMPLE', 'HUB', 'ORIGIN']);

/** A node in the travel-time matrix: a temple, a hub town or a common starting point. */
export const place = pgTable('place', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  kind: placeKind('kind').notNull(),
  templeId: uuid('temple_id').references(() => temple.id),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  ...timestamps(),
});

/** MR-48 travel-time matrix. */
export const travelTime = pgTable(
  'travel_time',
  {
    id: id(),
    fromPlaceId: uuid('from_place_id')
      .notNull()
      .references(() => place.id),
    toPlaceId: uuid('to_place_id')
      .notNull()
      .references(() => place.id),
    distanceKm: doublePrecision('distance_km'),
    normalMinutes: smallint('normal_minutes'),
    peakMinutes: smallint('peak_minutes'),
    peakHours: text('peak_hours'),
    symmetric: boolean('symmetric').notNull().default(true),
    roadNotes: text('road_notes'),
    ...provenance(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('travel_time_pair_uq').on(t.fromPlaceId, t.toPlaceId)],
);

/** MR-29 (Thirunallar / Puducherry entry) and other trip or temple rules. */
export const entryRule = pgTable('entry_rule', {
  id: id(),
  /** Null = applies to the whole trip. */
  templeId: uuid('temple_id').references(() => temple.id),
  category: text('category').notNull(),
  rule: text('rule').notNull(),
  appliesTo: text('applies_to'),
  costPaise: integer('cost_paise'),
  action: text('action'),
  ...provenance(),
  ...timestamps(),
});

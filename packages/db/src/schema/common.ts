import { date, pgEnum, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const id = () => uuid('id').primaryKey().defaultRandom();

export const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/** Matches the Status column of the temple data workbook. */
export const verificationStatus = pgEnum('verification_status', [
  'TO_COLLECT',
  'COLLECTED',
  'VERIFIED',
  'NEEDS_RECHECK',
]);

/** Matches the Source type column of the temple data workbook. */
export const sourceType = pgEnum('source_type', [
  'TEMPLE_OFFICE_IN_PERSON',
  'TEMPLE_OFFICE_PHONE',
  'TEMPLE_OFFICIAL_WEBSITE',
  'GOVT_NOTICE',
  'TEMPLE_PRIEST',
  'PARTNER_DRIVER_GUIDE',
  'MAPS_DATED',
  'OTHER',
]);

/**
 * Source and last-verified metadata for operational facts
 * (NAV-TEM-002/003, MR-47, FS §5.1). Only VERIFIED rows may be shown as fact.
 */
export const provenance = () => ({
  source: text('source'),
  sourceType: sourceType('source_type'),
  verifiedBy: text('verified_by'),
  verifiedOn: date('verified_on'),
  verificationStatus: verificationStatus('verification_status').notNull().default('TO_COLLECT'),
  notes: text('notes'),
});

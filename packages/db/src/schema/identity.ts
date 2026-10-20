import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, timestamps } from './common.js';

/** FS §36 roles. Keep in sync with ROLES in @navagraha/domain (minus SYSTEM / PAYMENT_GATEWAY). */
export const userRole = pgEnum('user_role', [
  'CUSTOMER',
  'OPS_COORDINATOR',
  'OPS_MANAGER',
  'DRIVER',
  'FINANCE',
  'CONTENT_ADMIN',
  'SYSTEM_ADMIN',
]);

/** NAV-ID-001 / MR-01 — one person, identified by phone (OTP) and/or email. */
export const appUser = pgTable(
  'app_user',
  {
    id: id(),
    /** E.164, e.g. +919876543210. */
    phone: text('phone'),
    email: text('email'),
    displayName: text('display_name'),
    phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('app_user_phone_uq').on(t.phone),
    uniqueIndex('app_user_email_uq').on(sql`lower(${t.email})`),
    check('app_user_contact_chk', sql`${t.phone} is not null or ${t.email} is not null`),
    check(
      'app_user_phone_e164_chk',
      sql`${t.phone} is null or ${t.phone} ~ '^\\+[1-9][0-9]{7,14}$'`,
    ),
  ],
);

export const appUserRole = pgTable(
  'app_user_role',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id),
    role: userRole('role').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    grantedBy: uuid('granted_by').references(() => appUser.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

/** Age bands drive Senior-Friendly rules (NAV-SEN-001). Child-age rules are MR-16 policy. */
export const ageBand = pgEnum('age_band', [
  'CHILD_0_4',
  'CHILD_5_11',
  'TEEN_12_17',
  'ADULT_18_59',
  'SENIOR_60_74',
  'SENIOR_75_PLUS',
]);

export const relationshipToBooker = pgEnum('relationship_to_booker', [
  'SELF',
  'PARENT',
  'SPOUSE',
  'CHILD',
  'SIBLING',
  'RELATIVE',
  'FRIEND',
  'OTHER',
]);

/**
 * NAV-ID-002..004, B-09 — the person undertaking the pilgrimage, owned by a booker.
 * Contact and emergency data is protected PII (MR-37); encryption at rest is a P0 follow-up.
 */
export const traveller = pgTable(
  'traveller',
  {
    id: id(),
    bookerUserId: uuid('booker_user_id')
      .notNull()
      .references(() => appUser.id),
    fullName: text('full_name').notNull(),
    ageBand: ageBand('age_band').notNull(),
    relationshipToBooker: relationshipToBooker('relationship_to_booker').notNull(),
    phone: text('phone'),
    mobilityNotes: text('mobility_notes'),
    needsWheelchair: boolean('needs_wheelchair').notNull().default(false),
    foodPreference: text('food_preference'),
    emergencyContactName: text('emergency_contact_name'),
    emergencyContactPhone: text('emergency_contact_phone'),
    /** Send My Parents / EC-23 — when this traveller agreed to be contacted. */
    contactConsentAt: timestamp('contact_consent_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index('traveller_booker_idx').on(t.bookerUserId)],
);

/**
 * MR-01 — one-time sign-in codes. Only an HMAC of the code is stored, so a database
 * leak does not reveal live codes. Rows are kept for rate limiting and audit.
 */
export const otpChallenge = pgTable(
  'otp_challenge',
  {
    id: id(),
    phone: text('phone').notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    attempts: smallint('attempts').notNull().default(0),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    requestIp: text('request_ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('otp_challenge_phone_idx').on(t.phone, t.createdAt),
    index('otp_challenge_ip_idx').on(t.requestIp, t.createdAt),
  ],
);

/** Signed-in sessions. Only a SHA-256 of the bearer token is stored. */
export const authSession = pgTable(
  'auth_session',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('auth_session_token_uq').on(t.tokenHash),
    index('auth_session_user_idx').on(t.userId),
  ],
);

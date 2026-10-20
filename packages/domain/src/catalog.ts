/** Controlled vocabularies shared by API, DB and web. */

/** FS §34 — itinerary templates in the MVP. 3D/2N is reserved for P1. */
export const TEMPLATES = ['1D', '2D1N'] as const;
export type TemplateCode = (typeof TEMPLATES)[number];
export const TEMPLATE_DAYS: Record<TemplateCode, number> = { '1D': 1, '2D1N': 2 };

/** FS §34 — planning modes. Senior-Friendly is an overlay flag, not a mode or tier. */
export const MODES = ['FAST', 'BALANCED', 'RELAXED'] as const;
export type PlanningMode = (typeof MODES)[number];

/** EC-38 — where a booking came from. */
export const SOURCE_CHANNELS = [
  'PHONE',
  'WHATSAPP',
  'WALK_IN',
  'REFERRAL',
  'WEB',
  'OTHER',
] as const;
export type SourceChannel = (typeof SOURCE_CHANNELS)[number];

/** WAIVER records a balance an Operations Manager waived (NOT_REQUIRED, D-19). */
export const PAYMENT_METHODS = [
  'GATEWAY',
  'OFFLINE_UPI',
  'OFFLINE_BANK_TRANSFER',
  'CASH',
  'WAIVER',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const OFFLINE_PAYMENT_METHODS = ['OFFLINE_UPI', 'OFFLINE_BANK_TRANSFER', 'CASH'] as const;

export const FULFILMENT_KINDS = ['VEHICLE', 'HOTEL', 'POOJA', 'PICKUP', 'GUIDE', 'OTHER'] as const;
export type FulfilmentKind = (typeof FULFILMENT_KINDS)[number];

export const QUOTE_LINE_KINDS = [
  'VEHICLE',
  'HOTEL',
  'POOJA',
  'PICKUP',
  'GUIDE',
  'SERVICE_FEE',
  'OTHER',
] as const;
export type QuoteLineKind = (typeof QUOTE_LINE_KINDS)[number];

export const ACCEPTANCE_CHANNELS = ['PHONE', 'WHATSAPP', 'IN_PERSON', 'EMAIL'] as const;
export type AcceptanceChannel = (typeof ACCEPTANCE_CHANNELS)[number];

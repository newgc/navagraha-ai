import {
  ACCEPTANCE_CHANNELS,
  CHANGE_KINDS,
  FULFILMENT_KINDS,
  MODES,
  OFFLINE_PAYMENT_METHODS,
  QUOTE_LINE_KINDS,
  OFFLINE_REFUND_METHODS,
  SOURCE_CHANNELS,
  TEMPLATES,
} from '@navagraha/domain';
import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM');
const paise = z.number().int().nonnegative().max(1_00_00_000_00);
const text = (max: number) => z.string().trim().min(1).max(max);

const AGE_BANDS = [
  'CHILD_0_4',
  'CHILD_5_11',
  'TEEN_12_17',
  'ADULT_18_59',
  'SENIOR_60_74',
  'SENIOR_75_PLUS',
] as const;
const RELATIONSHIPS = [
  'SELF',
  'PARENT',
  'SPOUSE',
  'CHILD',
  'SIBLING',
  'RELATIVE',
  'FRIEND',
  'OTHER',
] as const;

const NewTraveller = z.object({
  fullName: text(120),
  ageBand: z.enum(AGE_BANDS),
  relationshipToBooker: z.enum(RELATIONSHIPS),
  phone: z.string().max(32).optional(),
  mobilityNotes: z.string().max(1000).optional(),
  needsWheelchair: z.boolean().optional(),
  foodPreference: z.string().max(200).optional(),
  emergencyContactName: z.string().max(120).optional(),
  emergencyContactPhone: z.string().max(32).optional(),
  /** EC-23 — the traveller agreed to be contacted (Send My Parents). */
  contactConsent: z.boolean().optional(),
  isLead: z.boolean().optional(),
});
const ExistingTraveller = z.object({ travellerId: z.uuid(), isLead: z.boolean().optional() });

export const FulfilmentInput = z.object({
  slot: z.string().regex(/^[a-z0-9:-]{2,64}$/, 'lowercase letters, digits, : and - only'),
  kind: z.enum(FULFILMENT_KINDS),
  mandatory: z.boolean(),
  description: z.string().max(500).optional(),
  supplierName: z.string().max(200).optional(),
  capacity: z.number().int().min(1).max(100).optional(),
});

const Stops = z
  .array(
    z.object({
      templeCode: z.string().max(32),
      day: z.number().int(),
      plannedArrival: hhmm.optional(),
      notes: z.string().max(1000).optional(),
    }),
  )
  .min(1)
  .max(30);
export type StopsInput = z.infer<typeof Stops>;

const SignOff = z.literal(true, {
  error: 'Confirm you have checked temple timings and travel times (D-20)',
});

const QuoteLines = z
  .array(
    z.object({
      kind: z.enum(QUOTE_LINE_KINDS),
      description: text(300),
      quantity: z.number().int().min(1).max(1000),
      unitPricePaise: paise,
      /** Entered explicitly until D-07 defines tax rules. */
      taxPaise: paise.default(0),
    }),
  )
  .min(1)
  .max(50);
export type QuoteLinesInput = z.infer<typeof QuoteLines>;

const Travellers = z
  .array(z.union([ExistingTraveller, NewTraveller]))
  .min(1)
  .max(50);

/** POST /v1/bookings/manual — FS §32, EC-38. */
export const ManualBookingInput = z.object({
  booker: z.object({
    phone: text(32),
    name: z.string().max(120).optional(),
    email: z.email().optional(),
  }),
  travellers: z
    .array(z.union([ExistingTraveller, NewTraveller]))
    .min(1)
    .max(50),
  trip: z.object({
    circuitCode: z.string().default('NAVAGRAHA'),
    startDate: isoDate,
    template: z.enum(TEMPLATES),
    mode: z.enum(MODES),
    /** Defaults to true when any traveller is 60+ (NAV-SEN-001). */
    seniorFriendly: z.boolean().optional(),
    tier: z.string().max(40).optional(),
    pickupLocation: z.string().max(500).optional(),
    pickupTime: hhmm.optional(),
    notes: z.string().max(4000).optional(),
  }),
  source: z.object({
    channel: z.enum(SOURCE_CHANNELS),
    reference: z.string().max(200).optional(),
  }),
  itinerary: z.object({
    stops: Stops,
    /** D-20 — the coordinator confirms they checked opening hours and travel times by hand. */
    timingsCheckedByCoordinator: SignOff,
  }),
  quote: z.object({
    lines: QuoteLines,
    validUntil: z.iso.datetime({ offset: true }),
    acceptedVia: z.enum(ACCEPTANCE_CHANNELS),
  }),
  /** Supplier items. Defaults: a vehicle, plus a hotel night for 2D/1N — all mandatory. */
  fulfilment: z.array(FulfilmentInput).min(1).max(30).optional(),
});
export type ManualBookingInput = z.infer<typeof ManualBookingInput>;

export const OfflinePaymentInput = z.object({
  method: z.enum(OFFLINE_PAYMENT_METHODS),
  amountPaise: z.number().int().positive().max(1_00_00_000_00),
  reference: text(200),
  receivedOn: isoDate,
});

export const ReasonInput = z.object({ reason: text(1000) });

/** D-11 payment link; without an amount the link is for the whole balance still due. */
/** D-11 — a refund through the gateway, approved by a second person before it is sent. */
export const GatewayRefundInput = z.object({
  amountPaise: z.number().int().positive().max(1_00_00_000_00),
  reason: text(1000),
});

export const PaymentLinkInput = z.object({
  amountPaise: z.number().int().positive().max(1_00_00_000_00).optional(),
});

export const FulfilmentRequestInput = z.object({
  supplierName: z.string().trim().min(1).max(200).optional(),
  notes: z.string().max(1000).optional(),
});

export const FulfilmentConfirmInput = z.object({
  supplierReference: text(200),
  supplierName: z.string().trim().min(1).max(200).optional(),
  capacity: z.number().int().min(1).max(100).optional(),
});

export const BookingListQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  state: z.string().max(40).optional(),
});

/** POST /v1/bookings/{ref}/change-requests — record what the customer asked for. */
export const ChangeRequestInput = z.object({
  kind: z.enum(CHANGE_KINDS),
  description: text(2000),
  requestedVia: z.enum(SOURCE_CHANNELS),
});

/**
 * POST /v1/change-requests/{id}/proposal — the complete new plan and price. Trip fields and
 * travellers left out stay as they are.
 */
export const ChangeProposalInput = z.object({
  trip: z
    .object({
      startDate: isoDate.optional(),
      template: z.enum(TEMPLATES).optional(),
      mode: z.enum(MODES).optional(),
      pickupLocation: z.string().max(500).optional(),
      pickupTime: hhmm.optional(),
    })
    .default({}),
  travellers: Travellers.optional(),
  itinerary: z.object({ stops: Stops, timingsCheckedByCoordinator: SignOff }),
  quote: z.object({ lines: QuoteLines, validUntil: z.iso.datetime({ offset: true }) }),
});
export type ChangeProposalInput = z.infer<typeof ChangeProposalInput>;

export const AcceptInput = z.object({ acceptedVia: z.enum(ACCEPTANCE_CHANNELS) });

export const CancellationInput = z.object({
  reason: text(2000),
  requestedVia: z.enum(SOURCE_CHANNELS),
});

/** Until D-06 sets refund tiers, a person proposes the refund (never more than was paid). */
export const CancellationReviewInput = z.object({
  refundPaise: z.number().int().nonnegative().max(1_00_00_000_00),
  refundNote: text(2000),
});

export const RefundInput = z.object({
  method: z.enum(OFFLINE_REFUND_METHODS),
  amountPaise: z.number().int().positive().max(1_00_00_000_00),
  reference: text(200),
  paidOn: isoDate,
});

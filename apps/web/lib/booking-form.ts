import { parseRupees } from './format';

/** The new-booking form's state, as the client component holds it. */
export interface TravellerRow {
  /** Set for a traveller already on file; their profile is kept as it is. */
  travellerId?: string;
  fullName: string;
  ageBand: string;
  relationshipToBooker: string;
  needsWheelchair: boolean;
  mobilityNotes: string;
}

export interface StopRow {
  templeCode: string;
  include: boolean;
  day: number;
  plannedArrival: string;
}

export interface LineRow {
  kind: string;
  description: string;
  quantity: string;
  unitPrice: string;
  tax: string;
}

export interface BookingFormState {
  bookerPhone: string;
  bookerName: string;
  channel: string;
  sourceReference: string;
  startDate: string;
  template: '1D' | '2D1N';
  mode: string;
  pickupLocation: string;
  pickupTime: string;
  notes: string;
  travellers: TravellerRow[];
  leadIndex: number;
  stops: StopRow[];
  vehicleSeats: string;
  lines: LineRow[];
  validUntil: string;
  acceptedVia: string;
  timingsChecked: boolean;
  /** P2: check the proposal with the planning engine from this start place. */
  engine?: { fromPlace: string; startTime?: string } | null;
}

const opt = (s: string) => (s.trim() ? s.trim() : undefined);

/** Builds the POST /v1/bookings/manual body, or lists what to fix first. */
export function toManualBookingPayload(
  f: BookingFormState,
): { ok: true; payload: Record<string, unknown> } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!f.bookerPhone.trim()) errors.push('Enter the booker’s mobile number');
  if (!f.startDate) errors.push('Choose the travel date');
  if (f.travellers.length === 0) errors.push('Add at least one traveller');
  f.travellers.forEach((t, i) => {
    if (!t.fullName.trim()) errors.push(`Traveller ${i + 1}: enter a name`);
  });
  const stops = f.stops.filter((s) => s.include);
  if (stops.length === 0) errors.push('Include at least one temple');
  const seats = f.vehicleSeats.trim() ? Number(f.vehicleSeats) : undefined;
  if (seats !== undefined && (!Number.isInteger(seats) || seats < 1)) {
    errors.push('Vehicle seats must be a whole number');
  }

  const lines = f.lines.map((l, i) => {
    const unitPricePaise = parseRupees(l.unitPrice);
    const taxPaise = l.tax.trim() ? parseRupees(l.tax) : 0;
    const quantity = Number(l.quantity);
    if (!l.description.trim()) errors.push(`Quote line ${i + 1}: describe it`);
    if (unitPricePaise == null)
      errors.push(`Quote line ${i + 1}: price must be an amount like 4500 or 4500.50`);
    if (taxPaise == null) errors.push(`Quote line ${i + 1}: tax must be an amount`);
    if (!Number.isInteger(quantity) || quantity < 1)
      errors.push(`Quote line ${i + 1}: quantity must be 1 or more`);
    return {
      kind: l.kind,
      description: l.description.trim(),
      quantity,
      unitPricePaise: unitPricePaise ?? 0,
      taxPaise: taxPaise ?? 0,
    };
  });
  if (lines.length === 0) errors.push('Add at least one quote line');
  if (!f.validUntil) errors.push('Choose how long the quote is valid');
  if (!f.timingsChecked)
    errors.push('Confirm you have checked temple timings and travel times (D-20)');
  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    payload: {
      booker: { phone: f.bookerPhone.trim(), name: opt(f.bookerName) },
      travellers: f.travellers.map((t, i) =>
        t.travellerId
          ? { travellerId: t.travellerId, isLead: i === f.leadIndex || undefined }
          : {
              fullName: t.fullName.trim(),
              ageBand: t.ageBand,
              relationshipToBooker: t.relationshipToBooker,
              needsWheelchair: t.needsWheelchair || undefined,
              mobilityNotes: opt(t.mobilityNotes),
              isLead: i === f.leadIndex || undefined,
            },
      ),
      trip: {
        startDate: f.startDate,
        template: f.template,
        mode: f.mode,
        pickupLocation: opt(f.pickupLocation),
        pickupTime: opt(f.pickupTime),
        notes: opt(f.notes),
      },
      source: { channel: f.channel, reference: opt(f.sourceReference) },
      itinerary: {
        stops: stops.map((s) => ({
          templeCode: s.templeCode,
          day: f.template === '1D' ? 1 : s.day,
          plannedArrival: opt(s.plannedArrival),
        })),
        timingsCheckedByCoordinator: true,
      },
      quote: {
        lines,
        // The quote is valid to the end of the chosen day, India time.
        validUntil: `${f.validUntil}T23:59:59+05:30`,
        acceptedVia: f.acceptedVia,
      },
      fulfilment: [
        { slot: 'vehicle', kind: 'VEHICLE', mandatory: true, capacity: seats },
        ...(f.template === '2D1N'
          ? [{ slot: 'hotel:night-1', kind: 'HOTEL', mandatory: true }]
          : []),
      ],
    },
  };
}

/** Client-side preview only; the API calculates the authoritative total. */
export function previewTotalPaise(lines: LineRow[]): number | null {
  let total = 0;
  for (const l of lines) {
    const unit = parseRupees(l.unitPrice);
    const tax = l.tax.trim() ? parseRupees(l.tax) : 0;
    const qty = Number(l.quantity);
    if (unit == null || tax == null || !Number.isInteger(qty) || qty < 1) return null;
    total += qty * unit + tax;
  }
  return total;
}

/** POST /v1/change-requests/{id}/proposal body: the parts of the booking a change can alter. */
export function toChangeProposalPayload(
  f: BookingFormState,
): { ok: true; payload: Record<string, unknown> } | { ok: false; errors: string[] } {
  const built = toManualBookingPayload(f);
  if (!built.ok) return built;
  const p = built.payload as {
    trip: Record<string, unknown>;
    travellers: unknown[];
    itinerary: unknown;
    quote: { lines: unknown[]; validUntil: string };
  };
  return {
    ok: true,
    payload: {
      trip: {
        startDate: p.trip.startDate,
        template: p.trip.template,
        mode: p.trip.mode,
        pickupLocation: p.trip.pickupLocation,
        pickupTime: p.trip.pickupTime,
      },
      travellers: p.travellers,
      itinerary: p.itinerary,
      quote: { lines: p.quote.lines, validUntil: p.quote.validUntil },
    },
  };
}

/** POST /v1/trip-requests/{ref}/proposals body: a complete plan and price for a web request. */
export function toLeadProposalPayload(
  f: BookingFormState,
): { ok: true; payload: Record<string, unknown> } | { ok: false; errors: string[] } {
  const built = toManualBookingPayload(f);
  if (!built.ok) return built;
  const p = built.payload as {
    trip: Record<string, unknown>;
    travellers: unknown[];
    itinerary: unknown;
    quote: { lines: unknown[]; validUntil: string };
    fulfilment: unknown[];
  };
  return {
    ok: true,
    payload: {
      trip: p.trip,
      travellers: p.travellers,
      itinerary: p.itinerary,
      quote: { lines: p.quote.lines, validUntil: p.quote.validUntil },
      fulfilment: p.fulfilment,
      ...(f.engine ? { engine: f.engine } : {}),
    },
  };
}

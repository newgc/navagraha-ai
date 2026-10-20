import { describe, expect, it } from 'vitest';
import {
  previewTotalPaise,
  toManualBookingPayload,
  type BookingFormState,
} from '../lib/booking-form';

const form = (over: Partial<BookingFormState> = {}): BookingFormState => ({
  bookerPhone: '98765 43210',
  bookerName: 'Priya',
  channel: 'PHONE',
  sourceReference: '',
  startDate: '2026-11-15',
  template: '1D',
  mode: 'BALANCED',
  pickupLocation: 'Kumbakonam',
  pickupTime: '05:30',
  notes: '',
  travellers: [
    {
      fullName: 'Priya',
      ageBand: 'ADULT_18_59',
      relationshipToBooker: 'SELF',
      needsWheelchair: false,
      mobilityNotes: '',
    },
    {
      fullName: 'Kamala',
      ageBand: 'SENIOR_60_74',
      relationshipToBooker: 'PARENT',
      needsWheelchair: true,
      mobilityNotes: 'Knee',
    },
  ],
  leadIndex: 1,
  stops: [
    { templeCode: 'TEM-SUR', include: true, day: 1, plannedArrival: '06:30' },
    { templeCode: 'TEM-CHA', include: false, day: 1, plannedArrival: '' },
    { templeCode: 'TEM-SHA', include: true, day: 2, plannedArrival: '' },
  ],
  vehicleSeats: '7',
  lines: [
    { kind: 'VEHICLE', description: 'Innova', quantity: '1', unitPrice: '4,500', tax: '225' },
  ],
  validUntil: '2026-10-27',
  acceptedVia: 'PHONE',
  timingsChecked: true,
  ...over,
});

describe('toManualBookingPayload', () => {
  it('builds the API body', () => {
    const r = toManualBookingPayload(form());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload).toMatchObject({
      booker: { phone: '98765 43210', name: 'Priya' },
      travellers: [
        { fullName: 'Priya' },
        { fullName: 'Kamala', needsWheelchair: true, isLead: true },
      ],
      itinerary: {
        // 1D forces day 1; excluded temples are dropped.
        stops: [
          { templeCode: 'TEM-SUR', day: 1, plannedArrival: '06:30' },
          { templeCode: 'TEM-SHA', day: 1 },
        ],
        timingsCheckedByCoordinator: true,
      },
      quote: {
        lines: [{ kind: 'VEHICLE', quantity: 1, unitPricePaise: 450000, taxPaise: 22500 }],
        validUntil: '2026-10-27T23:59:59+05:30',
      },
      fulfilment: [{ slot: 'vehicle', capacity: 7 }],
    });
  });

  it('keeps chosen days and adds a hotel night for 2D/1N', () => {
    const r = toManualBookingPayload(form({ template: '2D1N' }));
    if (!r.ok) throw new Error('expected ok');
    expect((r.payload.itinerary as { stops: { day: number }[] }).stops.map((s) => s.day)).toEqual([
      1, 2,
    ]);
    expect(r.payload.fulfilment).toEqual([
      { slot: 'vehicle', kind: 'VEHICLE', mandatory: true, capacity: 7 },
      { slot: 'hotel:night-1', kind: 'HOTEL', mandatory: true },
    ]);
  });

  it('lists everything to fix', () => {
    const r = toManualBookingPayload(
      form({
        bookerPhone: '',
        timingsChecked: false,
        stops: [],
        lines: [
          { kind: 'VEHICLE', description: '', quantity: '0', unitPrice: '4500.123', tax: '' },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual([
      'Enter the booker’s mobile number',
      'Include at least one temple',
      'Quote line 1: describe it',
      'Quote line 1: price must be an amount like 4500 or 4500.50',
      'Quote line 1: quantity must be 1 or more',
      'Confirm you have checked temple timings and travel times (D-20)',
    ]);
  });
});

describe('previewTotalPaise', () => {
  it('sums quantity × price + tax, or gives up on bad input', () => {
    expect(previewTotalPaise(form().lines)).toBe(472500);
    expect(
      previewTotalPaise([
        { kind: 'X', description: 'x', quantity: '2', unitPrice: 'abc', tax: '' },
      ]),
    ).toBeNull();
  });
});

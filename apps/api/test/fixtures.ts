/** Shared request bodies for the booking e2e tests. */
export const NINE = [
  'TEM-SUR',
  'TEM-CHA',
  'TEM-ANG',
  'TEM-BUD',
  'TEM-GUR',
  'TEM-SHU',
  'TEM-SHA',
  'TEM-RAH',
  'TEM-KET',
];

export function inDays(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

let bookerSeq = 0;
export function manualBooking(overrides: Record<string, unknown> = {}) {
  bookerSeq++;
  return {
    booker: { phone: `98400${String(bookerSeq).padStart(5, '0')}`, name: 'Priya' },
    travellers: [
      { fullName: 'Priya', ageBand: 'ADULT_18_59', relationshipToBooker: 'SELF' },
      { fullName: 'Kamala', ageBand: 'SENIOR_60_74', relationshipToBooker: 'PARENT', isLead: true },
      {
        fullName: 'Raghavan',
        ageBand: 'SENIOR_75_PLUS',
        relationshipToBooker: 'PARENT',
        needsWheelchair: true,
      },
    ],
    trip: {
      startDate: inDays(14),
      template: '1D',
      mode: 'BALANCED',
      pickupLocation: 'Kumbakonam railway station',
      pickupTime: '05:30',
    },
    source: { channel: 'PHONE', reference: 'Call from Priya' },
    itinerary: {
      stops: NINE.map((templeCode) => ({ templeCode, day: 1 })),
      timingsCheckedByCoordinator: true,
    },
    quote: {
      lines: [
        {
          kind: 'VEHICLE',
          description: 'Innova Crysta, 1 day',
          quantity: 1,
          unitPricePaise: 450000,
          taxPaise: 22500,
        },
        {
          kind: 'SERVICE_FEE',
          description: 'Coordination',
          quantity: 1,
          unitPricePaise: 150000,
          taxPaise: 27000,
        },
      ],
      validUntil: new Date(Date.now() + 7 * 86400_000).toISOString(),
      acceptedVia: 'PHONE',
    },
    ...overrides,
  };
}

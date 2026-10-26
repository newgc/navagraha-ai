/**
 * Data source governance for operational facts (V2 §8, §26; NAV-TEM-002/003, MR-47, EC-49).
 *
 * The temple data workbook stays the master copy: each row carries one source and one
 * verification status. On top of that, anyone in operations can record an independent check
 * of a single fact (a second source). A check whose value differs from the current one makes
 * the fact CONFLICTING until a person resolves it; nothing here picks a winner by itself.
 */

/** Source types, as stored (`source_type` enum). */
export const SOURCE_TYPES = [
  'GOVT_NOTICE',
  'TEMPLE_OFFICIAL_WEBSITE',
  'TEMPLE_OFFICE_IN_PERSON',
  'TEMPLE_OFFICE_PHONE',
  'TEMPLE_PRIEST',
  'PARTNER_DRIVER_GUIDE',
  'OPERATIONS_OBSERVATION',
  'CUSTOMER_REPORT',
  'MAPS_DATED',
  'OTHER',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/**
 * V2 §26 source priority, 1 (strongest) to 6. Google Maps travel times count as a general web
 * source; they are still usable once a person has verified them, but are labelled ESTIMATED.
 */
export const SOURCE_PRIORITY: Record<SourceType, 1 | 2 | 3 | 4 | 5 | 6> = {
  GOVT_NOTICE: 1,
  TEMPLE_OFFICIAL_WEBSITE: 2,
  TEMPLE_OFFICE_IN_PERSON: 2,
  TEMPLE_OFFICE_PHONE: 2,
  TEMPLE_PRIEST: 2,
  PARTNER_DRIVER_GUIDE: 3,
  OPERATIONS_OBSERVATION: 4,
  CUSTOMER_REPORT: 5,
  MAPS_DATED: 6,
  OTHER: 6,
};

export const SOURCE_LABELS: Record<SourceType, string> = {
  GOVT_NOTICE: 'HR&CE / Government notice',
  TEMPLE_OFFICIAL_WEBSITE: 'Temple official website',
  TEMPLE_OFFICE_IN_PERSON: 'Temple office (in person)',
  TEMPLE_OFFICE_PHONE: 'Temple office (phone)',
  TEMPLE_PRIEST: 'Temple priest',
  PARTNER_DRIVER_GUIDE: 'Verified local operator (driver / guide)',
  OPERATIONS_OBSERVATION: 'Our operations team (observed)',
  CUSTOMER_REPORT: 'Customer report',
  MAPS_DATED: 'Google Maps (dated)',
  OTHER: 'Other web source',
};

/** Only these sources can make a fact VERIFIED; weaker ones can flag a fact, never settle it. */
export const canVerify = (s: SourceType) => SOURCE_PRIORITY[s] <= 4;

export type WorkflowStatus = 'TO_COLLECT' | 'COLLECTED' | 'VERIFIED' | 'NEEDS_RECHECK';

/** What a fact can be trusted as (V2 §8). Only VERIFIED and OPERATIONAL_CONFIRMED are facts. */
export type Confidence =
  'VERIFIED' | 'OPERATIONAL_CONFIRMED' | 'ESTIMATED' | 'UNCONFIRMED' | 'CONFLICTING' | 'STALE';

export interface ProvenanceLike {
  verificationStatus: WorkflowStatus;
  verifiedOn: string | null;
  sourceType: SourceType | null;
}

/**
 * The confidence of a row's facts on a date. A disagreeing check wins over everything, then a
 * due re-check; otherwise the strength of the source decides the label.
 */
export function confidenceOf(
  row: ProvenanceLike,
  opts: { conflicting: boolean; today: string; recheckAfterDays: number },
): Confidence {
  if (opts.conflicting) return 'CONFLICTING';
  if (row.verificationStatus === 'NEEDS_RECHECK') return 'STALE';
  if (row.verificationStatus !== 'VERIFIED') {
    return row.verificationStatus === 'COLLECTED' ? 'ESTIMATED' : 'UNCONFIRMED';
  }
  if (row.verifiedOn && row.verifiedOn < addDays(opts.today, -opts.recheckAfterDays)) {
    return 'STALE';
  }
  const priority = row.sourceType ? SOURCE_PRIORITY[row.sourceType] : 6;
  if (priority <= 2) return 'VERIFIED';
  if (priority <= 4) return 'OPERATIONAL_CONFIRMED';
  return 'ESTIMATED';
}

function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ the facts that can be checked

export type FactSubject = 'TEMPLE' | 'SCHEDULE' | 'SPECIAL_DAY' | 'SERVICE' | 'TRAVEL_TIME';
export type FactValueType = 'minutes' | 'time' | 'km' | 'rupees' | 'yesno' | 'text' | 'coordinate';

export interface FactField {
  label: string;
  type: FactValueType;
}

/**
 * The single facts a second source can be recorded for, by subject. Field names are the
 * database column names in camelCase, so a resolved check can be written back directly.
 */
export const FACT_FIELDS: Record<FactSubject, Record<string, FactField>> = {
  TEMPLE: {
    visitMinutesNormal: { label: 'Visit minutes (normal day)', type: 'minutes' },
    visitMinutesBusy: { label: 'Visit minutes (busy day)', type: 'minutes' },
    wheelchairAccess: { label: 'Wheelchair access', type: 'yesno' },
    toiletsNearby: { label: 'Toilets nearby', type: 'yesno' },
    seatingAvailable: { label: 'Seating available', type: 'yesno' },
    walkFromParkingMetres: { label: 'Walk from parking (metres)', type: 'minutes' },
    latitude: { label: 'Latitude', type: 'coordinate' },
    longitude: { label: 'Longitude', type: 'coordinate' },
    officePhone: { label: 'Temple office phone', type: 'text' },
  },
  SCHEDULE: {
    opensAt: { label: 'Opens', type: 'time' },
    closesAt: { label: 'Closes', type: 'time' },
    lastEntryAt: { label: 'Last entry', type: 'time' },
  },
  SPECIAL_DAY: {
    changedOpensAt: { label: 'Opens (on this day)', type: 'time' },
    changedClosesAt: { label: 'Closes (on this day)', type: 'time' },
    expectedExtraWaitMinutes: { label: 'Expected extra wait (minutes)', type: 'minutes' },
  },
  SERVICE: {
    durationMinutes: { label: 'Duration (minutes)', type: 'minutes' },
    templeFeePaise: { label: 'Temple fee (₹)', type: 'rupees' },
    timeWindow: { label: 'Time window', type: 'text' },
    availableDays: { label: 'Available days', type: 'text' },
  },
  TRAVEL_TIME: {
    normalMinutes: { label: 'Normal drive (minutes)', type: 'minutes' },
    peakMinutes: { label: 'Peak drive (minutes)', type: 'minutes' },
    distanceKm: { label: 'Distance (km)', type: 'km' },
  },
};

export const fieldOf = (subject: FactSubject, field: string): FactField | undefined =>
  Object.hasOwn(FACT_FIELDS[subject], field) ? FACT_FIELDS[subject][field] : undefined;

/**
 * A fact value as typed by a person → its canonical text, so two sources can be compared
 * ("6:00" and "06:00" agree). Returns an error message when the value is not valid.
 */
export function normalizeFactValue(
  type: FactValueType,
  input: string,
): { value: string } | { error: string } {
  const v = input.trim();
  if (!v) return { error: 'is required' };
  switch (type) {
    case 'minutes': {
      if (!/^\d{1,4}$/.test(v)) return { error: 'should be a whole number' };
      return { value: String(Number(v)) };
    }
    case 'time': {
      const m = /^(\d{1,2})[:.](\d{2})(?::\d{2})?$/.exec(v);
      if (!m || Number(m[1]) > 23 || Number(m[2]) > 59)
        return { error: 'should be a time like 06:30' };
      return { value: `${m[1]!.padStart(2, '0')}:${m[2]}` };
    }
    case 'km': {
      if (!/^\d{1,4}(\.\d{1,2})?$/.test(v)) return { error: 'should be a distance like 12.5' };
      return { value: String(Number(v)) };
    }
    case 'rupees': {
      if (!/^\d{1,7}(\.\d{1,2})?$/.test(v))
        return { error: 'should be an amount like 150 or 150.50' };
      return { value: String(Math.round(Number(v) * 100)) };
    }
    case 'yesno': {
      const yes = /^(y|yes|true)$/i.test(v);
      const no = /^(n|no|false)$/i.test(v);
      if (!yes && !no) return { error: 'should be yes or no' };
      return { value: yes ? 'yes' : 'no' };
    }
    case 'coordinate': {
      if (!/^-?\d{1,3}\.\d{3,8}$/.test(v))
        return { error: 'should be decimal degrees like 10.9601' };
      return { value: String(Number(v)) };
    }
    case 'text':
      return { value: v.replace(/\s+/g, ' ').slice(0, 200) };
  }
}

/** A value read from the database → the same canonical text (null when there is none). */
export function canonicalStored(type: FactValueType, stored: unknown): string | null {
  if (stored == null || stored === '') return null;
  switch (type) {
    case 'time':
      return String(stored).slice(0, 5);
    case 'yesno':
      return stored ? 'yes' : 'no';
    case 'minutes':
    case 'rupees':
    case 'km':
    case 'coordinate':
      return String(Number(stored));
    case 'text':
      return String(stored).replace(/\s+/g, ' ').trim();
  }
}

/** Canonical text → the value to store in the column. */
export function storedValue(type: FactValueType, canonical: string): string | number | boolean {
  switch (type) {
    case 'yesno':
      return canonical === 'yes';
    case 'minutes':
    case 'rupees':
    case 'km':
    case 'coordinate':
      return Number(canonical);
    case 'time':
    case 'text':
      return canonical;
  }
}

/** For people: "15000" paise → "₹150.00", "yes" → "Yes"; everything else as is. */
export function displayFactValue(type: FactValueType, canonical: string | null): string {
  if (canonical == null) return '—';
  if (type === 'rupees') return `₹${(Number(canonical) / 100).toFixed(2)}`;
  if (type === 'yesno') return canonical === 'yes' ? 'Yes' : 'No';
  return canonical;
}

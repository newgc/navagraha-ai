import {
  cellChoice,
  cellDate,
  cellFloat,
  cellInt,
  cellRupees,
  cellText,
  cellTime,
  cellUrl,
  cellYesNo,
  type Converted,
  type RawCell,
} from './cells.js';
import type { RawRow, RawWorkbook, SheetName, WorkbookIssue } from './workbook.js';

const STATUS = {
  'To collect': 'TO_COLLECT',
  Collected: 'COLLECTED',
  Verified: 'VERIFIED',
  'Needs re-check': 'NEEDS_RECHECK',
} as const;

const SOURCE_TYPE = {
  'Temple office (in person)': 'TEMPLE_OFFICE_IN_PERSON',
  'Temple office (phone)': 'TEMPLE_OFFICE_PHONE',
  'Temple official website': 'TEMPLE_OFFICIAL_WEBSITE',
  'HR&CE / Govt notice': 'GOVT_NOTICE',
  'Temple priest': 'TEMPLE_PRIEST',
  'Partner driver / guide': 'PARTNER_DRIVER_GUIDE',
  'Google Maps (dated)': 'MAPS_DATED',
  'Other (explain in notes)': 'OTHER',
} as const;

export type VerificationStatus = (typeof STATUS)[keyof typeof STATUS];
export type SourceType = (typeof SOURCE_TYPE)[keyof typeof SOURCE_TYPE];

export interface Provenance {
  source: string | null;
  sourceType: SourceType | null;
  verifiedBy: string | null;
  verifiedOn: string | null;
  verificationStatus: VerificationStatus;
  notes: string | null;
}

/** Reads one row, recording every problem against its sheet, row and column. */
class Row {
  constructor(
    private readonly sheet: SheetName,
    private readonly raw: RawRow,
    private readonly issues: WorkbookIssue[],
  ) {}

  get number() {
    return this.raw.row;
  }

  private cell(column: string): RawCell {
    return this.raw.cells.get(column);
  }

  issue(column: string | undefined, message: string, severity: 'error' | 'warning' = 'error') {
    this.issues.push({ sheet: this.sheet, row: this.raw.row, column, severity, message });
  }

  private take<T>(column: string, r: Converted<T>, required: boolean): T | null {
    if (r.error !== undefined) {
      this.issue(column, r.error);
      return null;
    }
    if (required && r.value == null) this.issue(column, 'is required');
    return r.value ?? null;
  }

  text(column: string, required = false) {
    const v = cellText(this.cell(column));
    if (required && v == null) this.issue(column, 'is required');
    return v;
  }
  url = (c: string) => this.take(c, cellUrl(this.cell(c)), false);
  time = (c: string, required = false) => this.take(c, cellTime(this.cell(c)), required);
  date = (c: string, required = false) => this.take(c, cellDate(this.cell(c)), required);
  int = (c: string, min: number, max: number) =>
    this.take(c, cellInt(this.cell(c), min, max), false);
  float = (c: string, min: number, max: number) =>
    this.take(c, cellFloat(this.cell(c), min, max), false);
  rupees = (c: string) => this.take(c, cellRupees(this.cell(c)), false);
  yesNo = (c: string) => this.take(c, cellYesNo(this.cell(c)), false);
  choice = <T extends string>(c: string, choices: Record<string, T>) =>
    this.take(c, cellChoice(this.cell(c), choices), false);

  /** The six verification columns, with the rule that VERIFIED facts must say where they came from. */
  provenance(today: string): Provenance {
    let status = this.choice('Status', STATUS);
    if (status == null) {
      this.issue('Status', 'is blank — treated as "To collect"', 'warning');
      status = 'TO_COLLECT';
    }
    const p: Provenance = {
      source: this.text('Source (who / which page)'),
      sourceType: this.choice('Source type', SOURCE_TYPE),
      verifiedBy: this.text('Verified by'),
      verifiedOn: this.date('Verified on'),
      verificationStatus: status,
      notes: this.text('Notes'),
    };
    if (status === 'VERIFIED') {
      if (!p.source) this.issue('Source (who / which page)', 'is required when Status is Verified');
      if (!p.sourceType) this.issue('Source type', 'is required when Status is Verified');
      if (!p.verifiedBy) this.issue('Verified by', 'is required when Status is Verified');
      if (!p.verifiedOn) this.issue('Verified on', 'is required when Status is Verified');
    }
    if (p.verifiedOn && p.verifiedOn > today) this.issue('Verified on', 'is in the future');
    return p;
  }
}

export interface ParseContext {
  /** Temple codes that exist in the database. The workbook cannot create temples. */
  templeCodes: ReadonlySet<string>;
  /** Place codes (temples, hubs, origins) that exist in the database. */
  placeCodes: ReadonlySet<string>;
  /** Today as YYYY-MM-DD, for "not in the future" checks. */
  today: string;
}

const INDIA = { lat: [6, 37], lng: [68, 98] } as const;

function rows(raw: RawWorkbook, sheet: SheetName, issues: WorkbookIssue[]) {
  return raw[sheet].map((r) => new Row(sheet, r, issues));
}

function templeRef(row: Row, column: string, ctx: ParseContext, required: boolean) {
  const code = row.text(column, required)?.toUpperCase() ?? null;
  if (code && !ctx.templeCodes.has(code)) row.issue(column, `"${code}" is not a known Temple ID`);
  return code;
}

export function parseWorkbook(raw: RawWorkbook, ctx: ParseContext) {
  const issues: WorkbookIssue[] = [];

  const temples = rows(raw, 'Temples', issues).map((r) => {
    const code = templeRef(r, 'Temple ID', ctx, true);
    const latitude = r.float('Latitude', INDIA.lat[0], INDIA.lat[1]);
    const longitude = r.float('Longitude', INDIA.lng[0], INDIA.lng[1]);
    if ((latitude == null) !== (longitude == null)) {
      r.issue('Latitude', 'give both Latitude and Longitude, or neither');
    }
    const visitNormal = r.int('Typical visit time — normal day (min)', 1, 600);
    const visitBusy = r.int('Typical visit time — busy day (min)', 1, 1440);
    if (visitNormal != null && visitBusy != null && visitBusy < visitNormal) {
      r.issue('Typical visit time — busy day (min)', 'is shorter than a normal day', 'warning');
    }
    const commonName = r.text('Commonly known as', true);
    return {
      code,
      commonName,
      graha: r.text('Graha (planet)'),
      officialName: r.text('Official temple name'),
      mainDeity: r.text('Main deity'),
      town: r.text('Town / village'),
      district: r.text('District'),
      state: r.text('State'),
      address: r.text('Full address'),
      pinCode: r.text('PIN code'),
      latitude,
      longitude,
      mapsUrl: r.url('Google Maps link'),
      officePhone: r.text('Temple office phone'),
      website: r.url('Official website'),
      walkFromParkingMetres: r.int('Walk from parking to sanctum (metres)', 0, 5000),
      stepsToClimb: r.text('Steps / stairs to climb'),
      wheelchairAccess: r.yesNo('Wheelchair access possible?'),
      seatingAvailable: r.yesNo('Resting / seating available?'),
      toiletsNearby: r.yesNo('Clean toilets nearby?'),
      visitMinutesNormal: visitNormal,
      visitMinutesBusy: visitBusy,
      parkingNotes: r.text('Parking notes'),
      seniorNotes: r.text('Senior traveller notes'),
      ...r.provenance(ctx.today),
    };
  });
  const seenTemples = new Set<string>();
  temples.forEach((t, i) => {
    if (!t.code) return;
    if (seenTemples.has(t.code)) {
      issues.push({
        sheet: 'Temples',
        row: raw.Temples[i]!.row,
        column: 'Temple ID',
        severity: 'error',
        message: `${t.code} appears more than once`,
      });
    }
    seenTemples.add(t.code);
  });

  const schedules = rows(raw, 'Schedules', issues).map((r) => {
    const opensAt = r.time('Opens (HH:MM)', true);
    const closesAt = r.time('Closes (HH:MM)', true);
    const lastEntryAt = r.time('Last entry (HH:MM)');
    if (opensAt && closesAt && closesAt <= opensAt)
      r.issue('Closes (HH:MM)', 'must be after Opens');
    if (
      lastEntryAt &&
      ((opensAt && lastEntryAt < opensAt) || (closesAt && lastEntryAt > closesAt))
    ) {
      r.issue('Last entry (HH:MM)', 'must be between Opens and Closes');
    }
    const validFrom = r.date('Valid from', true);
    const validTo = r.date('Valid to (blank = no end)');
    if (validFrom && validTo && validTo < validFrom) {
      r.issue('Valid to (blank = no end)', 'is before Valid from');
    }
    return {
      templeCode: templeRef(r, 'Temple ID', ctx, true),
      dayType: r.text('Day type', true),
      session: r.text('Session', true),
      opensAt,
      closesAt,
      lastEntryAt,
      validFrom,
      validTo,
      ...r.provenance(ctx.today),
    };
  });

  const specialDays = rows(raw, 'Special days', issues).map((r) => {
    const fromDate = r.date('From date', true);
    const toDate = r.date('To date', true);
    if (fromDate && toDate && toDate < fromDate) r.issue('To date', 'is before From date');
    const changedOpensAt = r.time('Changed opens (HH:MM)');
    const changedClosesAt = r.time('Changed closes (HH:MM)');
    if (changedOpensAt && changedClosesAt && changedClosesAt <= changedOpensAt) {
      r.issue('Changed closes (HH:MM)', 'must be after Changed opens');
    }
    return {
      templeCode: templeRef(r, 'Temple ID', ctx, true),
      name: r.text('Name of day / event', true),
      kind: r.text('Type', true),
      fromDate,
      toDate,
      effect: r.text('Effect', true),
      changedOpensAt,
      changedClosesAt,
      expectedExtraWaitMinutes: r.int('Expected extra wait (min)', 0, 1440),
      recursYearly: r.yesNo('Recurs every year?'),
      ...r.provenance(ctx.today),
    };
  });

  const services = rows(raw, 'Services', issues).map((r) => ({
    code: r.text('Service ID', true)?.toUpperCase() ?? null,
    templeCode: templeRef(r, 'Temple ID', ctx, true),
    name: r.text('Service name (as the temple calls it)', true),
    kind: r.text('Type', true),
    traditionalBelief: r.text('Traditional belief / purpose (worded as belief)'),
    availableDays: r.text('Available days'),
    timeWindow: r.text('Time window (HH:MM–HH:MM)'),
    durationMinutes: r.int('Duration (min)', 1, 1440),
    maxPeoplePerBooking: r.int('Max people per booking', 1, 1000),
    bookDaysAhead: r.int('Book how many days ahead?', 0, 365),
    bookedVia: r.text('Booked via'),
    templeFeePaise: r.rupees('Temple fee (₹)'),
    feeBasis: r.text('Fee is per'),
    itemsToBring: r.text('Items devotee must bring'),
    itemsAvailable: r.text('Items available at temple'),
    dressRequirement: r.text('Dress requirement'),
    ...r.provenance(ctx.today),
  }));
  const seenServices = new Map<string, number>();
  services.forEach((s, i) => {
    if (!s.code) return;
    const row = raw.Services[i]!.row;
    if (seenServices.has(s.code)) {
      issues.push({
        sheet: 'Services',
        row,
        column: 'Service ID',
        severity: 'error',
        message: `${s.code} is also used on row ${seenServices.get(s.code)}`,
      });
    } else seenServices.set(s.code, row);
  });

  const placeRef = (r: Row, column: string) => {
    const code = r.text(column, true)?.toUpperCase() ?? null;
    if (code && !ctx.placeCodes.has(code)) r.issue(column, `"${code}" is not a known place ID`);
    return code;
  };
  const travelTimes = rows(raw, 'Travel times', issues).map((r) => {
    const fromCode = placeRef(r, 'From ID');
    const toCode = placeRef(r, 'To ID');
    if (fromCode && fromCode === toCode) r.issue('To ID', 'is the same place as From ID');
    const normalMinutes = r.int('Normal drive (min)', 1, 1440);
    const peakMinutes = r.int('Peak drive (min)', 1, 1440);
    if (normalMinutes != null && peakMinutes != null && peakMinutes < normalMinutes) {
      r.issue('Peak drive (min)', 'is shorter than the normal drive', 'warning');
    }
    return {
      fromCode,
      toCode,
      distanceKm: r.float('Distance (km)', 0, 2000),
      normalMinutes,
      peakMinutes,
      peakHours: r.text('Peak hours / days'),
      symmetric: r.yesNo('Same both ways?') ?? true,
      roadNotes: r.text('Road notes (condition, narrow roads, level crossings)'),
      ...r.provenance(ctx.today),
    };
  });
  const seenPairs = new Map<string, number>();
  travelTimes.forEach((t, i) => {
    if (!t.fromCode || !t.toCode) return;
    const key = `${t.fromCode}→${t.toCode}`;
    const row = raw['Travel times'][i]!.row;
    if (seenPairs.has(key)) {
      issues.push({
        sheet: 'Travel times',
        row,
        column: 'To ID',
        severity: 'error',
        message: `${key} is also on row ${seenPairs.get(key)}`,
      });
    } else seenPairs.set(key, row);
  });

  const entryRules = rows(raw, 'Entry rules', issues).map((r) => ({
    templeCode: templeRef(r, 'Temple ID (blank = applies to whole trip)', ctx, false),
    category: r.text('Category', true),
    rule: r.text('Rule', true),
    appliesTo: r.text('Applies to'),
    costPaise: r.rupees('Cost (₹, if any)'),
    action: r.text('What the driver / customer must do'),
    ...r.provenance(ctx.today),
  }));

  return { temples, schedules, specialDays, services, travelTimes, entryRules, issues };
}

export type ParsedWorkbook = ReturnType<typeof parseWorkbook>;

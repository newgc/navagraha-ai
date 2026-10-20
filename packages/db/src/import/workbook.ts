import ExcelJS from 'exceljs';
import type { RawCell } from './cells.js';

/** Expected sheets and their headers, exactly as `tools/temple-template/build.py` writes them. */
const VERIFY = [
  'Source (who / which page)',
  'Source type',
  'Verified by',
  'Verified on',
  'Status',
  'Notes',
];

export const SHEETS = {
  Temples: [
    'Temple ID',
    'Graha (planet)',
    'Commonly known as',
    'Official temple name',
    'Main deity',
    'Town / village',
    'District',
    'State',
    'Full address',
    'PIN code',
    'Latitude',
    'Longitude',
    'Google Maps link',
    'Temple office phone',
    'Official website',
    'Walk from parking to sanctum (metres)',
    'Steps / stairs to climb',
    'Wheelchair access possible?',
    'Resting / seating available?',
    'Clean toilets nearby?',
    'Typical visit time — normal day (min)',
    'Typical visit time — busy day (min)',
    'Parking notes',
    'Senior traveller notes',
    ...VERIFY,
  ],
  Schedules: [
    'Temple ID',
    'Day type',
    'Session',
    'Opens (HH:MM)',
    'Closes (HH:MM)',
    'Last entry (HH:MM)',
    'Valid from',
    'Valid to (blank = no end)',
    ...VERIFY,
  ],
  'Special days': [
    'Temple ID',
    'Name of day / event',
    'Type',
    'From date',
    'To date',
    'Effect',
    'Changed opens (HH:MM)',
    'Changed closes (HH:MM)',
    'Expected extra wait (min)',
    'Recurs every year?',
    ...VERIFY,
  ],
  Services: [
    'Service ID',
    'Temple ID',
    'Service name (as the temple calls it)',
    'Type',
    'Traditional belief / purpose (worded as belief)',
    'Available days',
    'Time window (HH:MM–HH:MM)',
    'Duration (min)',
    'Max people per booking',
    'Book how many days ahead?',
    'Booked via',
    'Temple fee (₹)',
    'Fee is per',
    'Items devotee must bring',
    'Items available at temple',
    'Dress requirement',
    ...VERIFY,
  ],
  'Travel times': [
    'From ID',
    'From',
    'To ID',
    'To',
    'Distance (km)',
    'Normal drive (min)',
    'Peak drive (min)',
    'Peak hours / days',
    'Same both ways?',
    'Road notes (condition, narrow roads, level crossings)',
    ...VERIFY,
  ],
  'Entry rules': [
    'Temple ID (blank = applies to whole trip)',
    'Category',
    'Rule',
    'Applies to',
    'Cost (₹, if any)',
    'What the driver / customer must do',
    ...VERIFY,
  ],
} as const;

export type SheetName = keyof typeof SHEETS;

export interface RawRow {
  /** 1-based spreadsheet row number, for error messages. */
  row: number;
  cells: Map<string, RawCell>;
}

export type RawWorkbook = Record<SheetName, RawRow[]>;

export interface WorkbookIssue {
  sheet: string;
  row?: number;
  column?: string;
  severity: 'error' | 'warning';
  message: string;
}

const isBlank = (v: RawCell) => v == null || (typeof v === 'string' && v.trim() === '');

/**
 * Reads the sheets by header name, so reordered columns still import. Skips blank rows and
 * the grey EXAMPLE rows. Structural problems (missing sheet or header) are returned as errors.
 */
export async function readWorkbook(
  data: ArrayBuffer | Uint8Array,
): Promise<{ raw: RawWorkbook; issues: WorkbookIssue[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as ArrayBuffer);
  const issues: WorkbookIssue[] = [];
  const raw = {} as RawWorkbook;

  for (const [name, headers] of Object.entries(SHEETS) as [SheetName, readonly string[]][]) {
    raw[name] = [];
    const ws = wb.getWorksheet(name);
    if (!ws) {
      issues.push({ sheet: name, severity: 'error', message: 'Sheet is missing' });
      continue;
    }
    const columnOf = new Map<string, number>();
    ws.getRow(1).eachCell((cell, col) => {
      const text = typeof cell.value === 'string' ? cell.value.trim() : null;
      if (text) columnOf.set(text, col);
    });
    const missing = headers.filter((h) => !columnOf.has(h));
    if (missing.length) {
      issues.push({
        sheet: name,
        row: 1,
        severity: 'error',
        message: `Missing column(s): ${missing.join(', ')}`,
      });
      continue;
    }
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const cells = new Map<string, RawCell>();
      for (const h of headers) cells.set(h, row.getCell(columnOf.get(h)!).value);
      if ([...cells.values()].every(isBlank)) continue;
      const first = cells.get(headers[0]!);
      if (typeof first === 'string' && first.trim().toUpperCase().startsWith('EXAMPLE')) continue;
      raw[name].push({ row: r, cells });
    }
  }
  return { raw, issues };
}

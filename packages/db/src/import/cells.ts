/**
 * Converts raw spreadsheet cell values into typed values. Each converter returns
 * `{ value }` or `{ error }` with a message written for the person filling the sheet.
 */

export type Converted<T> =
  { value: T | null; error?: undefined } | { value?: undefined; error: string };

/** A raw cell value as ExcelJS returns it. */
export type RawCell = unknown;

/** Plain text from any cell shape (rich text, hyperlink, formula result, number, date). */
export function cellText(raw: RawCell): string | null {
  if (raw == null) return null;
  if (typeof raw === 'string') return raw.trim() || null;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  if (raw instanceof Date) return raw.toISOString();
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.richText)) {
      return (
        (o.richText as { text: string }[])
          .map((r) => r.text)
          .join('')
          .trim() || null
      );
    }
    if ('result' in o) return cellText(o.result);
    if (typeof o.text === 'string') return o.text.trim() || null;
    if (typeof o.hyperlink === 'string') return o.hyperlink;
  }
  return String(raw);
}

/** For URL columns: prefer the link target over the display text. */
export function cellUrl(raw: RawCell): Converted<string> {
  const v =
    raw && typeof raw === 'object' && typeof (raw as { hyperlink?: unknown }).hyperlink === 'string'
      ? (raw as { hyperlink: string }).hyperlink
      : cellText(raw);
  if (v == null) return { value: null };
  return /^https?:\/\/\S+$/i.test(v)
    ? { value: v }
    : { error: `"${v}" is not a web link (https://…)` };
}

const pad = (n: number) => String(n).padStart(2, '0');

function unwrap(raw: RawCell): RawCell {
  if (raw && typeof raw === 'object' && !(raw instanceof Date) && 'result' in raw) {
    return (raw as { result: unknown }).result;
  }
  return raw;
}

/** Time of day → `HH:MM`. Accepts `6:00`, `06:00`, `06.00`, Excel time cells and day fractions. */
export function cellTime(raw: RawCell): Converted<string> {
  const v = unwrap(raw);
  if (v == null || v === '') return { value: null };
  if (v instanceof Date) return { value: `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}` };
  if (typeof v === 'number' && v >= 0 && v < 1) {
    const minutes = Math.round(v * 24 * 60);
    return { value: `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}` };
  }
  const text = cellText(v);
  const m = text?.match(/^([01]?\d|2[0-3])[:.]([0-5]\d)$/);
  if (!m) return { error: `"${text}" is not a 24-hour time like 06:00 or 20:30` };
  return { value: `${pad(Number(m[1]))}:${m[2]}` };
}

function isoDate(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Calendar date → `YYYY-MM-DD`. Accepts DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD and Excel date cells. */
export function cellDate(raw: RawCell): Converted<string> {
  const v = unwrap(raw);
  if (v == null || v === '') return { value: null };
  if (v instanceof Date) {
    return { value: isoDate(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate())! };
  }
  const text = cellText(v) ?? '';
  let iso: string | null = null;
  let m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) iso = isoDate(Number(m[3]), Number(m[2]), Number(m[1]));
  m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) iso = isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  return iso ? { value: iso } : { error: `"${text}" is not a date like 25-12-2026` };
}

function cellNumber(raw: RawCell): Converted<number> {
  const v = unwrap(raw);
  if (v == null || v === '') return { value: null };
  const n = typeof v === 'number' ? v : Number(cellText(v)?.replace(/,/g, ''));
  return Number.isFinite(n) ? { value: n } : { error: `"${cellText(v)}" is not a number` };
}

export function cellInt(raw: RawCell, min: number, max: number): Converted<number> {
  const r = cellNumber(raw);
  if (r.error || r.value == null) return r;
  if (!Number.isInteger(r.value)) return { error: `${r.value} must be a whole number` };
  if (r.value < min || r.value > max)
    return { error: `${r.value} must be between ${min} and ${max}` };
  return r;
}

export function cellFloat(raw: RawCell, min: number, max: number): Converted<number> {
  const r = cellNumber(raw);
  if (r.error || r.value == null) return r;
  if (r.value < min || r.value > max)
    return { error: `${r.value} must be between ${min} and ${max}` };
  return r;
}

/** Rupees → integer paise. */
export function cellRupees(raw: RawCell): Converted<number> {
  const r = cellNumber(raw);
  if (r.error || r.value == null) return r;
  if (r.value < 0) return { error: 'amount cannot be negative' };
  const paise = Math.round(r.value * 100);
  if (Math.abs(paise - r.value * 100) > 1e-6)
    return { error: `${r.value} has more than 2 decimals` };
  return { value: paise };
}

/** Yes → true, No → false, Unknown / blank → null. */
export function cellYesNo(raw: RawCell): Converted<boolean> {
  const t = cellText(raw)?.toLowerCase();
  if (t == null || t === 'unknown') return { value: null };
  if (t === 'yes' || t === 'y') return { value: true };
  if (t === 'no' || t === 'n') return { value: false };
  return { error: `"${cellText(raw)}" should be Yes, No or Unknown` };
}

/** A value from a fixed list, matched case-insensitively. */
export function cellChoice<T extends string>(
  raw: RawCell,
  choices: Record<string, T>,
): Converted<T> {
  const t = cellText(raw);
  if (t == null) return { value: null };
  const hit = Object.entries(choices).find(([label]) => label.toLowerCase() === t.toLowerCase());
  return hit
    ? { value: hit[1] }
    : { error: `"${t}" is not one of: ${Object.keys(choices).join(', ')}` };
}

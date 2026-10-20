import { describe, expect, it } from 'vitest';
import {
  cellChoice,
  cellDate,
  cellInt,
  cellRupees,
  cellText,
  cellTime,
  cellUrl,
  cellYesNo,
} from '../src/import/cells.js';

describe('cell converters', () => {
  it('reads text from every ExcelJS cell shape', () => {
    expect(cellText('  Kumbakonam ')).toBe('Kumbakonam');
    expect(cellText('   ')).toBeNull();
    expect(cellText({ richText: [{ text: 'Thiru' }, { text: 'nallar' }] })).toBe('Thirunallar');
    expect(cellText({ formula: 'A1', result: 'x' })).toBe('x');
    expect(cellText({ text: 'map', hyperlink: 'https://maps.example' })).toBe('map');
    expect(cellText(612001)).toBe('612001');
  });

  it('prefers the link target for URLs and rejects non-links', () => {
    expect(cellUrl({ text: 'map', hyperlink: 'https://maps.example/x' })).toEqual({
      value: 'https://maps.example/x',
    });
    expect(cellUrl('maps.google.com').error).toMatch(/not a web link/);
  });

  it('times', () => {
    expect(cellTime('6:00')).toEqual({ value: '06:00' });
    expect(cellTime('20.30')).toEqual({ value: '20:30' });
    expect(cellTime(new Date(Date.UTC(1899, 11, 30, 16, 45)))).toEqual({ value: '16:45' });
    expect(cellTime(0.25)).toEqual({ value: '06:00' });
    expect(cellTime('6am').error).toMatch(/24-hour time/);
    expect(cellTime('24:00').error).toBeDefined();
    expect(cellTime(null)).toEqual({ value: null });
  });

  it('dates, rejecting impossible ones', () => {
    expect(cellDate('05-11-2026')).toEqual({ value: '2026-11-05' });
    expect(cellDate('5/1/2027')).toEqual({ value: '2027-01-05' });
    expect(cellDate('2026-11-05')).toEqual({ value: '2026-11-05' });
    expect(cellDate(new Date(Date.UTC(2026, 10, 5)))).toEqual({ value: '2026-11-05' });
    expect(cellDate('31-02-2026').error).toBeDefined();
    expect(cellDate('DD-MM-YYYY').error).toBeDefined();
  });

  it('numbers and money', () => {
    expect(cellInt('1,200', 0, 5000)).toEqual({ value: 1200 });
    expect(cellInt(2.5, 0, 10).error).toMatch(/whole number/);
    expect(cellInt(-1, 0, 10).error).toMatch(/between/);
    expect(cellRupees(50)).toEqual({ value: 5000 });
    expect(cellRupees('12.5')).toEqual({ value: 1250 });
    expect(cellRupees(1.234).error).toMatch(/decimals/);
    expect(cellRupees(-5).error).toMatch(/negative/);
  });

  it('yes / no / unknown and fixed lists', () => {
    expect(cellYesNo('Yes')).toEqual({ value: true });
    expect(cellYesNo('no')).toEqual({ value: false });
    expect(cellYesNo('Unknown')).toEqual({ value: null });
    expect(cellYesNo('maybe').error).toBeDefined();
    expect(cellChoice('verified', { Verified: 'VERIFIED' })).toEqual({ value: 'VERIFIED' });
    expect(cellChoice('Done', { Verified: 'VERIFIED' }).error).toMatch(/not one of/);
  });
});

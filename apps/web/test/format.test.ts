import { describe, expect, it } from 'vitest';
import { formatRupees, humanize, parseRupees, tone } from '../lib/format';

describe('money', () => {
  it('parses rupees to exact paise without float error', () => {
    expect(parseRupees('6,495.50')).toBe(649550);
    expect(parseRupees('₹ 4500')).toBe(450000);
    expect(parseRupees('0.29')).toBe(29);
    expect(parseRupees('0.1')).toBe(10);
    expect(parseRupees(' 12 ')).toBe(1200);
  });

  it('rejects anything that is not a plain amount', () => {
    for (const bad of ['', '-5', '1.234', 'abc', '1e3', '12.']) expect(parseRupees(bad)).toBeNull();
  });

  it('formats paise as Indian rupees', () => {
    expect(formatRupees(649500)).toBe('₹6,495.00');
    expect(formatRupees(1_23_45_678_00)).toBe('₹1,23,45,678.00');
    expect(formatRupees(null)).toBe('—');
  });
});

describe('labels', () => {
  it('humanizes codes and picks badge tones', () => {
    expect(humanize('PENDING_CONFIRMATION')).toBe('Pending confirmation');
    expect(tone('CONFIRMED')).toBe('good');
    expect(tone('DECLINED')).toBe('bad');
    expect(tone('PARTIAL')).toBe('warn');
    expect(tone('DRAFT')).toBe('neutral');
  });
});

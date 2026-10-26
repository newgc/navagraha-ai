import { describe, expect, it } from 'vitest';
import {
  SOURCE_PRIORITY,
  SOURCE_TYPES,
  canVerify,
  canonicalStored,
  confidenceOf,
  displayFactValue,
  normalizeFactValue,
  storedValue,
} from '../src/index.js';

const today = '2026-10-26';
const opts = { conflicting: false, today, recheckAfterDays: 180 };

describe('data source governance (V2 §8, §26)', () => {
  it('ranks every source 1–6, and only 1–4 can verify a fact', () => {
    for (const s of SOURCE_TYPES) expect(SOURCE_PRIORITY[s]).toBeGreaterThan(0);
    expect(SOURCE_PRIORITY.GOVT_NOTICE).toBe(1);
    expect(SOURCE_PRIORITY.TEMPLE_OFFICE_PHONE).toBe(2);
    expect(SOURCE_PRIORITY.PARTNER_DRIVER_GUIDE).toBe(3);
    expect(SOURCE_PRIORITY.OPERATIONS_OBSERVATION).toBe(4);
    expect(SOURCE_PRIORITY.CUSTOMER_REPORT).toBe(5);
    expect(SOURCE_PRIORITY.OTHER).toBe(6);
    expect(canVerify('OPERATIONS_OBSERVATION')).toBe(true);
    expect(canVerify('CUSTOMER_REPORT')).toBe(false);
    expect(canVerify('MAPS_DATED')).toBe(false);
  });

  it('labels confidence: conflicts first, then re-checks, then the strength of the source', () => {
    const row = { verificationStatus: 'VERIFIED' as const, verifiedOn: '2026-10-01' };
    expect(confidenceOf({ ...row, sourceType: 'TEMPLE_OFFICE_PHONE' }, opts)).toBe('VERIFIED');
    expect(confidenceOf({ ...row, sourceType: 'PARTNER_DRIVER_GUIDE' }, opts)).toBe(
      'OPERATIONAL_CONFIRMED',
    );
    expect(confidenceOf({ ...row, sourceType: 'MAPS_DATED' }, opts)).toBe('ESTIMATED');
    expect(
      confidenceOf({ ...row, sourceType: 'GOVT_NOTICE' }, { ...opts, conflicting: true }),
    ).toBe('CONFLICTING');
    expect(
      confidenceOf({ ...row, verifiedOn: '2026-01-01', sourceType: 'GOVT_NOTICE' }, opts),
    ).toBe('STALE');
    expect(
      confidenceOf(
        { verificationStatus: 'NEEDS_RECHECK', verifiedOn: null, sourceType: null },
        opts,
      ),
    ).toBe('STALE');
    expect(
      confidenceOf({ verificationStatus: 'COLLECTED', verifiedOn: null, sourceType: null }, opts),
    ).toBe('ESTIMATED');
    expect(
      confidenceOf({ verificationStatus: 'TO_COLLECT', verifiedOn: null, sourceType: null }, opts),
    ).toBe('UNCONFIRMED');
  });

  it('normalises typed values so two sources can be compared', () => {
    expect(normalizeFactValue('time', '6:30')).toEqual({ value: '06:30' });
    expect(normalizeFactValue('time', '06.30')).toEqual({ value: '06:30' });
    expect(normalizeFactValue('time', '25:00')).toHaveProperty('error');
    expect(normalizeFactValue('minutes', '045')).toEqual({ value: '45' });
    expect(normalizeFactValue('minutes', 'about 45')).toHaveProperty('error');
    expect(normalizeFactValue('rupees', '150.5')).toEqual({ value: '15050' });
    expect(normalizeFactValue('yesno', 'Yes')).toEqual({ value: 'yes' });
    expect(normalizeFactValue('km', '12.50')).toEqual({ value: '12.5' });
    expect(normalizeFactValue('coordinate', '10.96')).toHaveProperty('error');
    expect(normalizeFactValue('text', '  Morning   only ')).toEqual({ value: 'Morning only' });
    expect(normalizeFactValue('text', ' ')).toHaveProperty('error');
  });

  it('reads stored values the same way, and writes them back in the column type', () => {
    expect(canonicalStored('time', '06:30:00')).toBe('06:30');
    expect(canonicalStored('yesno', false)).toBe('no');
    expect(canonicalStored('minutes', null)).toBeNull();
    expect(storedValue('rupees', '15050')).toBe(15050);
    expect(storedValue('yesno', 'yes')).toBe(true);
    expect(displayFactValue('rupees', '15050')).toBe('₹150.50');
    expect(displayFactValue('time', null)).toBe('—');
  });
});

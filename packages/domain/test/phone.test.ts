import { describe, expect, it } from 'vitest';
import { maskPhone, normalizePhone } from '../src/index.js';

describe('normalizePhone', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['98765 43210', '+919876543210'],
    ['098765-43210', '+919876543210'],
    ['91 98765 43210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['+44 20 7946 0958', '+442079460958'],
  ])('%s → %s', (input, expected) => expect(normalizePhone(input)).toBe(expected));

  it.each(['12345', '5876543210', '+0123456789', 'abc', '', '++919876543210', '9876543210x'])(
    'rejects %s',
    (input) => expect(normalizePhone(input)).toBeNull(),
  );
});

describe('maskPhone', () => {
  it('keeps country code and last four digits', () => {
    expect(maskPhone('+919876543210')).toBe('+91******3210');
  });
});

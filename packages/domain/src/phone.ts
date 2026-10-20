/**
 * Normalises a phone number to E.164. Indian numbers can be typed the way people
 * usually write them (98765 43210, 098765-43210, 91 9876543210); other countries
 * must start with +.
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  const digits = trimmed.replace(/[\s\-().]/g, '');
  if (digits.startsWith('+')) return /^\+[1-9]\d{7,14}$/.test(digits) ? digits : null;
  if (!/^\d+$/.test(digits)) return null;
  const indian = /^[6-9]\d{9}$/;
  if (indian.test(digits)) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith('0') && indian.test(digits.slice(1))) {
    return `+91${digits.slice(1)}`;
  }
  if (digits.length === 12 && digits.startsWith('91') && indian.test(digits.slice(2))) {
    return `+${digits}`;
  }
  return null;
}

/** For logs and support screens: +91******3210. */
export function maskPhone(e164: string): string {
  if (e164.length <= 7) return '*'.repeat(e164.length);
  return `${e164.slice(0, 3)}${'*'.repeat(e164.length - 7)}${e164.slice(-4)}`;
}

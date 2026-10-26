/** Display helpers shared by server and client components. Money is always integer paise. */

const rupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
});

export function formatRupees(paise: number | null | undefined): string {
  if (paise == null) return '—';
  return rupees.format(paise / 100);
}

/**
 * "6,495.50" → 649550. Parses the text rather than multiplying a float, so ₹0.29 is exactly
 * 29 paise. Returns null for anything that is not a non-negative amount with at most 2 decimals.
 */
export function parseRupees(input: string): number | null {
  const t = input.trim().replace(/,/g, '').replace(/^₹\s*/, '');
  const m = t.match(/^(\d{1,9})(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

/** PENDING_CONFIRMATION → "Pending confirmation". */
export function humanize(code: string | null | undefined): string {
  if (!code) return '—';
  const s = code.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Badge tone for a state, used as a CSS class. */
export function tone(state: string): 'good' | 'warn' | 'bad' | 'neutral' {
  if (
    [
      'VERIFIED',
      'CONFIRMED',
      'SUCCESS',
      'COMPLETED',
      'ALL_REQUIRED_CONFIRMED',
      'NOT_REQUIRED',
      'LOCKED',
      'ACCEPTED',
      'SCHEDULED',
      'OPERATIONAL_CONFIRMED',
    ].includes(state)
  ) {
    return 'good';
  }
  if (['CANCELLED', 'FAILED', 'DECLINED', 'EXPIRED', 'INCIDENT', 'CONFLICTING'].includes(state))
    return 'bad';
  if (
    [
      'PENDING',
      'PENDING_CONFIRMATION',
      'REQUESTED',
      'PARTIAL',
      'NEEDS_RECHECK',
      'COLLECTED',
      'STALE',
      'ESTIMATED',
    ].includes(state)
  ) {
    return 'warn';
  }
  return 'neutral';
}

export function todayIso(offsetDays = 0): string {
  const d = new Date(Date.now() + 5.5 * 3600_000); // India time
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export const AGE_BANDS: Record<string, string> = {
  CHILD_0_4: 'Child 0–4',
  CHILD_5_11: 'Child 5–11',
  TEEN_12_17: 'Teen 12–17',
  ADULT_18_59: 'Adult 18–59',
  SENIOR_60_74: 'Senior 60–74',
  SENIOR_75_PLUS: 'Senior 75+',
};

export const RELATIONSHIPS: Record<string, string> = {
  SELF: 'Booker themself',
  PARENT: 'Parent',
  SPOUSE: 'Spouse',
  CHILD: 'Child',
  SIBLING: 'Sibling',
  RELATIVE: 'Relative',
  FRIEND: 'Friend',
  OTHER: 'Other',
};

export const PAYMENT_METHODS: Record<string, string> = {
  GATEWAY: 'Online',
  OFFLINE_UPI: 'UPI',
  OFFLINE_BANK_TRANSFER: 'Bank transfer',
  CASH: 'Cash',
  WAIVER: 'Waived',
};

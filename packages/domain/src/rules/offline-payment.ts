import type { Role } from '../roles.js';

/** D-19 — offline payments need two different people: one records, another confirms. */
export const OFFLINE_RECORDER_ROLES: readonly Role[] = [
  'OPS_COORDINATOR',
  'OPS_MANAGER',
  'FINANCE',
];
export const OFFLINE_CONFIRMER_ROLES: readonly Role[] = ['FINANCE', 'OPS_MANAGER'];

export type OfflineConfirmationCheck =
  { ok: true } | { ok: false; reason: 'SAME_PERSON' | 'ROLE_NOT_ALLOWED' };

export function checkOfflineConfirmation(input: {
  recordedByUserId: string;
  confirmerUserId: string;
  confirmerRoles: readonly Role[];
}): OfflineConfirmationCheck {
  if (!input.confirmerRoles.some((r) => OFFLINE_CONFIRMER_ROLES.includes(r))) {
    return { ok: false, reason: 'ROLE_NOT_ALLOWED' };
  }
  if (input.recordedByUserId === input.confirmerUserId) return { ok: false, reason: 'SAME_PERSON' };
  return { ok: true };
}

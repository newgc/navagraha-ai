import type { FulfilmentState } from './fulfilment.js';

/**
 * FS §33 / §11.1 — Booking CONFIRMED is a parallel gate:
 * approved payment condition (D-06) AND all mandatory fulfilment confirmed.
 *
 * Amounts are integer paise to avoid floating-point money.
 */

export type PaymentState =
  'NOT_REQUIRED' | 'PENDING' | 'SUCCESS' | 'FAILED' | 'PARTIALLY_REFUNDED' | 'REFUNDED';

export interface PaymentSnapshot {
  state: PaymentState;
  /** Amount captured by the gateway, in paise. */
  capturedPaise: number;
  /** Amount refunded and confirmed by the gateway, in paise. */
  refundedPaise: number;
}

/**
 * D-06 is open. Until the Product Owner decides, the default is FULL_PAYMENT (D-04 Q1).
 * The policy is configuration attached to the Package, never hard-coded in UI.
 */
export type PaymentConditionPolicy =
  { kind: 'FULL_PAYMENT' } | { kind: 'DEPOSIT_PERCENT'; percent: number } | { kind: 'NONE' };

export const DEFAULT_PAYMENT_POLICY: PaymentConditionPolicy = { kind: 'FULL_PAYMENT' };

export function netPaidPaise(payments: readonly PaymentSnapshot[]): number {
  return payments
    .filter((p) => p.state === 'SUCCESS' || p.state === 'PARTIALLY_REFUNDED')
    .reduce((sum, p) => sum + p.capturedPaise - p.refundedPaise, 0);
}

export function paymentConditionMet(
  totalPaise: number,
  payments: readonly PaymentSnapshot[],
  policy: PaymentConditionPolicy = DEFAULT_PAYMENT_POLICY,
): boolean {
  if (!Number.isInteger(totalPaise) || totalPaise < 0) {
    throw new Error('totalPaise must be a non-negative integer');
  }
  if (policy.kind === 'NONE') return true;
  if (totalPaise === 0) return true;
  if (payments.length > 0 && payments.every((p) => p.state === 'NOT_REQUIRED')) return true;

  const paid = netPaidPaise(payments);
  if (policy.kind === 'FULL_PAYMENT') return paid >= totalPaise;

  if (!(policy.percent > 0 && policy.percent <= 100)) {
    throw new Error('DEPOSIT_PERCENT must be in (0, 100]');
  }
  // Round the required deposit up to the next paisa so we never accept less than the policy.
  return paid >= Math.ceil((totalPaise * policy.percent) / 100);
}

export interface ConfirmationGateInput {
  totalPaise: number;
  payments: readonly PaymentSnapshot[];
  fulfilment: FulfilmentState;
  policy?: PaymentConditionPolicy;
}

export type GateResult =
  { open: true } | { open: false; waitingFor: readonly ('PAYMENT' | 'FULFILMENT')[] };

export function confirmationGate(input: ConfirmationGateInput): GateResult {
  const waitingFor: ('PAYMENT' | 'FULFILMENT')[] = [];
  if (!paymentConditionMet(input.totalPaise, input.payments, input.policy)) {
    waitingFor.push('PAYMENT');
  }
  if (input.fulfilment !== 'ALL_REQUIRED_CONFIRMED') waitingFor.push('FULFILMENT');
  return waitingFor.length === 0 ? { open: true } : { open: false, waitingFor };
}

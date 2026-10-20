/**
 * Splits a confirmed refund across the payments it returns money from, newest payment first,
 * never taking more from a payment than is still unrefunded. Integer paise.
 */
export interface RefundablePayment {
  id: string;
  capturedPaise: number;
  refundedPaise: number;
}

export function allocateRefund(
  paymentsOldestFirst: readonly RefundablePayment[],
  amountPaise: number,
): { paymentId: string; paise: number }[] {
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
    throw new Error('Refund amount must be a positive whole number of paise');
  }
  let left = amountPaise;
  const out: { paymentId: string; paise: number }[] = [];
  for (const p of [...paymentsOldestFirst].reverse()) {
    const available = p.capturedPaise - p.refundedPaise;
    if (available <= 0 || left === 0) continue;
    const take = Math.min(available, left);
    out.push({ paymentId: p.id, paise: take });
    left -= take;
  }
  if (left > 0) throw new Error('Refund is larger than the money received');
  return out;
}

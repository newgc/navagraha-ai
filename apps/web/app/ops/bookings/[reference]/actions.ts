'use server';

import { revalidatePath } from 'next/cache';
import type { ActionState } from '@/components/action-form';
import { api, errorText } from '@/lib/api';
import { parseRupees } from '@/lib/format';

const field = (form: FormData, name: string) => String(form.get(name) ?? '').trim();

async function call(reference: string, path: string, body: unknown): Promise<ActionState> {
  const r = await api(path, { method: 'POST', body });
  if (!r.ok) return { error: errorText(r.error) };
  revalidatePath(`/ops/bookings/${reference}`);
  return { done: true };
}

export async function recordPayment(reference: string, _: ActionState, form: FormData) {
  const amountPaise = parseRupees(field(form, 'amount'));
  if (!amountPaise) return { error: 'Enter the amount received, e.g. 6495 or 6495.50' };
  return call(reference, `/bookings/${reference}/payments/offline`, {
    method: field(form, 'method'),
    amountPaise,
    reference: field(form, 'reference'),
    receivedOn: field(form, 'receivedOn'),
  });
}

export async function confirmPayment(
  reference: string,
  paymentId: string,
  _: ActionState,
  _form: FormData,
) {
  return call(reference, `/payments/${paymentId}/confirm`, {});
}

export async function rejectPayment(
  reference: string,
  paymentId: string,
  _: ActionState,
  form: FormData,
) {
  return call(reference, `/payments/${paymentId}/reject`, { reason: field(form, 'reason') });
}

/** D-11 — a gateway payment link for the balance (or a part of it), sent on WhatsApp. */
export async function sendPaymentLink(
  reference: string,
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const amountText = field(form, 'amount');
  const amountPaise = amountText ? parseRupees(amountText) : undefined;
  if (amountText && !amountPaise) return { error: 'Enter the amount, e.g. 6495 or 6495.50' };
  const r = await api<{
    linkDelivery: { delivery: 'WHATSAPP' | 'NOT_SENT'; deliveryError?: string };
  }>(`/bookings/${reference}/payments/link`, {
    method: 'POST',
    body: amountPaise ? { amountPaise } : {},
  });
  if (!r.ok) return { error: errorText(r.error) };
  revalidatePath(`/ops/bookings/${reference}`);
  const d = r.data.linkDelivery;
  return {
    done: true,
    notice:
      d.delivery === 'WHATSAPP'
        ? 'Payment link sent to the booker on WhatsApp.'
        : `Link created but not sent on WhatsApp${d.deliveryError ? ` (${d.deliveryError})` : ''} — copy it from the list above and send it yourself.`,
  };
}

/** MR-19 — ask the gateway now instead of waiting for its notification. */
export async function checkPaymentLink(
  reference: string,
  paymentId: string,
  _: ActionState,
  _form: FormData,
) {
  return call(reference, `/payments/${paymentId}/reconcile`, {});
}

export async function cancelPaymentLink(
  reference: string,
  paymentId: string,
  _: ActionState,
  _form: FormData,
) {
  return call(reference, `/payments/${paymentId}/cancel-link`, {});
}

export async function waiveBalance(reference: string, _: ActionState, form: FormData) {
  return call(reference, `/bookings/${reference}/payments/waive`, {
    reason: field(form, 'reason'),
  });
}

export async function requestSupplier(
  reference: string,
  componentId: string,
  _: ActionState,
  form: FormData,
) {
  const supplierName = field(form, 'supplierName');
  return call(
    reference,
    `/fulfilments/${componentId}/request`,
    supplierName ? { supplierName } : {},
  );
}

export async function confirmSupplier(
  reference: string,
  componentId: string,
  _: ActionState,
  form: FormData,
) {
  const capacity = field(form, 'capacity');
  return call(reference, `/fulfilments/${componentId}/confirm`, {
    supplierReference: field(form, 'supplierReference'),
    ...(capacity ? { capacity: Number(capacity) } : {}),
  });
}

export async function declineSupplier(
  reference: string,
  componentId: string,
  _: ActionState,
  form: FormData,
) {
  return call(reference, `/fulfilments/${componentId}/decline`, { reason: field(form, 'reason') });
}

export async function addReplacement(
  reference: string,
  slot: string,
  kind: string,
  _: ActionState,
  form: FormData,
) {
  const supplierName = field(form, 'supplierName');
  return call(reference, `/bookings/${reference}/fulfilments`, {
    slot,
    kind,
    mandatory: true,
    ...(supplierName ? { supplierName } : {}),
  });
}

// ---------------------------------------------------------------- changes and cancellations

export async function requestChange(reference: string, _: ActionState, form: FormData) {
  return call(reference, `/bookings/${reference}/change-request`, {
    kind: field(form, 'kind'),
    description: field(form, 'description'),
    requestedVia: field(form, 'requestedVia'),
  });
}

export async function approveChange(reference: string, id: string, _: ActionState, form: FormData) {
  return call(reference, `/change-requests/${id}/approve`, {
    acceptedVia: field(form, 'acceptedVia'),
  });
}

export async function rejectChange(reference: string, id: string, _: ActionState, form: FormData) {
  return call(reference, `/change-requests/${id}/reject`, { reason: field(form, 'reason') });
}

export async function withdrawChange(
  reference: string,
  id: string,
  _: ActionState,
  _form: FormData,
) {
  return call(reference, `/change-requests/${id}/withdraw`, {});
}

export async function requestCancellation(reference: string, _: ActionState, form: FormData) {
  return call(reference, `/bookings/${reference}/cancel-request`, {
    reason: field(form, 'reason'),
    requestedVia: field(form, 'requestedVia'),
  });
}

export async function reviewCancellation(
  reference: string,
  id: string,
  _: ActionState,
  form: FormData,
) {
  const refundPaise = parseRupees(field(form, 'refund'));
  if (refundPaise == null)
    return { error: 'Enter the refund in rupees (0 if nothing is refunded)' };
  return call(reference, `/cancellations/${id}/review`, {
    refundPaise,
    refundNote: field(form, 'refundNote'),
  });
}

export async function approveCancellation(
  reference: string,
  id: string,
  _: ActionState,
  _form: FormData,
) {
  return call(reference, `/cancellations/${id}/approve`, {});
}

export async function rejectCancellation(
  reference: string,
  id: string,
  _: ActionState,
  form: FormData,
) {
  return call(reference, `/cancellations/${id}/reject`, { reason: field(form, 'reason') });
}

export async function recordRefund(reference: string, _: ActionState, form: FormData) {
  const amountPaise = parseRupees(field(form, 'amount'));
  if (!amountPaise) return { error: 'Enter the amount refunded' };
  return call(reference, `/bookings/${reference}/refunds`, {
    method: field(form, 'method'),
    amountPaise,
    reference: field(form, 'reference'),
    paidOn: field(form, 'paidOn'),
  });
}

/** D-11 — ask for a refund to the customer's online payment; a second person approves it. */
export async function requestGatewayRefund(reference: string, _: ActionState, form: FormData) {
  const amountPaise = parseRupees(field(form, 'amount'));
  if (!amountPaise) return { error: 'Enter the amount to refund' };
  return call(reference, `/bookings/${reference}/refunds/gateway`, {
    amountPaise,
    reason: field(form, 'reason'),
  });
}

export async function approveGatewayRefund(
  reference: string,
  id: string,
  _: ActionState,
  _form: FormData,
) {
  return call(reference, `/refunds/${id}/approve`, {});
}

export async function sendGatewayRefund(
  reference: string,
  id: string,
  _: ActionState,
  _form: FormData,
) {
  return call(reference, `/refunds/${id}/send`, {});
}

export async function checkGatewayRefund(
  reference: string,
  id: string,
  _: ActionState,
  _form: FormData,
) {
  return call(reference, `/refunds/${id}/check`, {});
}

export async function confirmRefund(
  reference: string,
  id: string,
  _: ActionState,
  _form: FormData,
) {
  return call(reference, `/refunds/${id}/confirm`, {});
}

export async function rejectRefund(reference: string, id: string, _: ActionState, form: FormData) {
  return call(reference, `/refunds/${id}/reject`, { reason: field(form, 'reason') });
}

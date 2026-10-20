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

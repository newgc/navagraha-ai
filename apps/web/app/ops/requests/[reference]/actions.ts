'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { ActionState } from '@/components/action-form';
import type { CreateResult } from '@/app/ops/bookings/new/actions';
import { api, errorText } from '@/lib/api';

export async function sendProposal(
  reference: string,
  payload: Record<string, unknown>,
): Promise<CreateResult> {
  const r = await api<{ proposals: { version: number }[] }>(
    `/trip-requests/${reference}/proposals`,
    { method: 'POST', body: payload },
  );
  if (!r.ok) {
    const findings = r.error.errors;
    return {
      error: findings?.length ? errorText({ ...r.error, errors: undefined }) : errorText(r.error),
      findings,
    };
  }
  revalidatePath(`/ops/requests/${reference}`);
  const version = r.data.proposals.at(-1)?.version;
  return { notice: `Proposal v${version} sent to the customer on WhatsApp.` };
}

export async function startPlanning(reference: string, _: ActionState, _form: FormData) {
  const r = await api(`/trip-requests/${reference}/planning`, { method: 'POST', body: {} });
  if (!r.ok) return { error: errorText(r.error) };
  revalidatePath(`/ops/requests/${reference}`);
  return { done: true };
}

export async function markLost(reference: string, _: ActionState, form: FormData) {
  const r = await api(`/trip-requests/${reference}/lost`, {
    method: 'POST',
    body: { reason: String(form.get('reason') ?? '').trim() },
  });
  if (!r.ok) return { error: errorText(r.error) };
  revalidatePath(`/ops/requests/${reference}`);
  return { done: true };
}

/** P2: run the planning engine for this request; the page then shows the decision record. */
export async function suggestPlans(
  reference: string,
  request: {
    startDate: string;
    travellers: { ageBand: string; needsWheelchair?: boolean }[];
    purpose: string;
    days: string;
  },
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const time = String(form.get('startTime') ?? '').trim();
  const r = await api<{ decisionRecordId: string }>('/planner/plan', {
    method: 'POST',
    body: {
      startDate: String(form.get('startDate') ?? request.startDate),
      startTime: time || undefined,
      fromPlace: String(form.get('fromPlace') ?? 'HUB-KUM'),
      travellers: request.travellers.map((t) => ({
        ageBand: t.ageBand,
        needsWheelchair: t.needsWheelchair,
      })),
      purpose: request.purpose,
      days: request.days,
      leadReference: reference,
    },
  });
  if (!r.ok) return { error: errorText(r.error) };
  redirect(`/ops/requests/${reference}?decision=${r.data.decisionRecordId}`);
}

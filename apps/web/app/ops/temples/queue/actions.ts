'use server';

import { revalidatePath } from 'next/cache';
import type { ActionState } from '@/components/action-form';
import { api, errorText } from '@/lib/api';

const field = (form: FormData, name: string) => String(form.get(name) ?? '').trim();
const optional = (form: FormData, name: string) => field(form, name) || undefined;

function done(notice: string): ActionState {
  revalidatePath('/ops/temples/queue');
  revalidatePath('/ops/temples');
  return { done: true, notice };
}

/** Records a second source for one fact (V2 §26). Decides nothing by itself. */
export async function addCheck(subjectKey: string, _: ActionState, form: FormData) {
  const r = await api<{ agrees: boolean }>('/admin/temple-data/checks', {
    method: 'POST',
    body: {
      subjectKey,
      field: field(form, 'field'),
      value: field(form, 'value'),
      source: field(form, 'source'),
      sourceType: field(form, 'sourceType'),
      sourceUrl: optional(form, 'sourceUrl'),
      observedOn: field(form, 'observedOn'),
      note: optional(form, 'note'),
    },
  });
  if (!r.ok) return { error: errorText(r.error) };
  return done(
    r.data.agrees
      ? 'Recorded. It agrees with the current value.'
      : 'Recorded. It disagrees with the current value, so this fact is now conflicting and not used for planning until someone decides.',
  );
}

export async function verifyFact(subjectKey: string, _: ActionState, form: FormData) {
  const r = await api('/admin/temple-data/facts/verify', {
    method: 'POST',
    body: {
      subjectKey,
      source: field(form, 'source'),
      sourceType: field(form, 'sourceType'),
      checkedOn: field(form, 'checkedOn'),
      note: optional(form, 'note'),
    },
  });
  if (!r.ok) return { error: errorText(r.error) };
  return done('Verified. Change the workbook too if it says something else.');
}

export async function markConflicting(subjectKey: string, _: ActionState, form: FormData) {
  const r = await api('/admin/temple-data/facts/mark-conflicting', {
    method: 'POST',
    body: { subjectKey, note: field(form, 'note') },
  });
  if (!r.ok) return { error: errorText(r.error) };
  return done('Marked for a re-check. Planning stops using it until it is verified again.');
}

export async function acceptCheck(id: string, _: ActionState, _form: FormData) {
  const r = await api(`/admin/temple-data/checks/${id}/accept`, { method: 'POST', body: {} });
  if (!r.ok) return { error: errorText(r.error) };
  return done(
    'Updated and verified. Change the workbook too, or the next upload brings the old value back as a conflict.',
  );
}

export async function rejectCheck(id: string, _: ActionState, form: FormData) {
  const r = await api(`/admin/temple-data/checks/${id}/reject`, {
    method: 'POST',
    body: { reason: field(form, 'reason') },
  });
  if (!r.ok) return { error: errorText(r.error) };
  return done('Rejected. The current value stays.');
}

'use server';

import { redirect } from 'next/navigation';
import type { ActionState } from '@/components/action-form';
import { api, errorText } from '@/lib/api';

export async function acceptPlan(
  reference: string,
  version: number,
  _: ActionState,
  _form: FormData,
): Promise<ActionState> {
  const r = await api<{ bookingReference: string }>(`/my/trip-requests/${reference}/accept`, {
    method: 'POST',
    body: { version },
  });
  if (!r.ok) return { error: errorText(r.error) };
  redirect(`/trips/${r.data.bookingReference}?accepted=1`);
}

/** Opens the gateway's secure payment page. Payment is recorded only from the gateway. */
export async function payNow(
  reference: string,
  _: ActionState,
  _form: FormData,
): Promise<ActionState> {
  const r = await api<{ url: string }>(`/my/bookings/${reference}/pay`, { method: 'POST' });
  if (!r.ok) return { error: errorText(r.error) };
  redirect(r.data.url);
}

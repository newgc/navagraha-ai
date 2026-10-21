'use server';

import { redirect } from 'next/navigation';
import { api, errorText, type ApiError } from '@/lib/api';

export interface CreateResult {
  error?: string;
  findings?: ApiError['errors'];
  /** Shown after success when the page stays, e.g. "Proposal v2 sent". */
  notice?: string;
}

export async function createBooking(payload: Record<string, unknown>): Promise<CreateResult> {
  const r = await api<{ reference: string }>('/bookings/manual', { method: 'POST', body: payload });
  if (!r.ok) {
    // With itinerary findings, list them instead of repeating them in the message.
    const findings = r.error.errors;
    return {
      error: findings?.length ? errorText({ ...r.error, errors: undefined }) : errorText(r.error),
      findings,
    };
  }
  redirect(`/ops/bookings/${r.data.reference}`);
}

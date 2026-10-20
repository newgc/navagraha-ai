'use server';

import { redirect } from 'next/navigation';
import type { CreateResult } from '@/app/ops/bookings/new/actions';
import { api, errorText } from '@/lib/api';

export async function proposeChange(
  reference: string,
  changeRequestId: string,
  payload: Record<string, unknown>,
): Promise<CreateResult> {
  const r = await api(`/change-requests/${changeRequestId}/proposal`, {
    method: 'POST',
    body: payload,
  });
  if (!r.ok) {
    const findings = r.error.errors;
    return {
      error: findings?.length ? errorText({ ...r.error, errors: undefined }) : errorText(r.error),
      findings,
    };
  }
  redirect(`/ops/bookings/${reference}`);
}

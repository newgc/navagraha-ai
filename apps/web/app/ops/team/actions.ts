'use server';

import { revalidatePath } from 'next/cache';
import type { ActionState } from '@/components/action-form';
import { api, errorText } from '@/lib/api';

export async function changeRole(_: ActionState, form: FormData): Promise<ActionState> {
  const r = await api('/admin/team/roles', {
    method: 'POST',
    body: {
      phone: String(form.get('phone') ?? ''),
      role: String(form.get('role') ?? ''),
      action: String(form.get('action') ?? ''),
      name: String(form.get('name') ?? '').trim() || undefined,
    },
  });
  if (!r.ok) return { error: errorText(r.error) };
  revalidatePath('/ops/team');
  return { done: true };
}

'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, api, errorText } from '@/lib/api';

export interface SignInState {
  step: 'phone' | 'code';
  phone?: string;
  /** Where the code went: the page says "on WhatsApp" when it was sent there (D-11). */
  channel?: 'whatsapp' | 'log';
  error?: string;
}

const CHALLENGE_COOKIE = 'nav_otp_challenge';
const secure = process.env.NODE_ENV === 'production';

export async function requestCode(_: SignInState, form: FormData): Promise<SignInState> {
  const phone = String(form.get('phone') ?? '').trim();
  const r = await api<{ challengeId: string; expiresAt: string; channel: 'whatsapp' | 'log' }>(
    '/auth/otp/request',
    {
      method: 'POST',
      body: { phone },
    },
  );
  if (!r.ok) return { step: 'phone', phone, error: errorText(r.error) };
  (await cookies()).set(CHALLENGE_COOKIE, r.data.challengeId, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/sign-in',
    maxAge: 10 * 60,
  });
  return { step: 'code', phone, channel: r.data.channel };
}

export async function verifyCode(prev: SignInState, form: FormData): Promise<SignInState> {
  const jar = await cookies();
  const challengeId = jar.get(CHALLENGE_COOKIE)?.value;
  if (!challengeId) return { step: 'phone', error: 'That code has expired. Request a new one.' };
  const code = String(form.get('code') ?? '').trim();
  const r = await api<{ token: string; expiresAt: string }>('/auth/otp/verify', {
    method: 'POST',
    body: { challengeId, code },
  });
  if (!r.ok) return { ...prev, step: 'code', error: errorText(r.error) };
  jar.delete({ name: CHALLENGE_COOKIE, path: '/sign-in' });
  jar.set(SESSION_COOKIE, r.data.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    expires: new Date(r.data.expiresAt),
  });
  redirect('/ops');
}

export async function signOut() {
  await api('/auth/logout', { method: 'POST' });
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/sign-in');
}

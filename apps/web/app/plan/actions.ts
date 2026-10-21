'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, api, errorText } from '@/lib/api';

/** The challenge for the code sent while sending a trip request (self-service, D-11 WhatsApp). */
const CHALLENGE_COOKIE = 'nav_plan_challenge';
const secure = process.env.NODE_ENV === 'production';

export interface PlanResult {
  error?: string;
  /** After a code was sent: where it went. */
  codeSent?: { channel: 'whatsapp' | 'log' };
}

async function send(payload: Record<string, unknown>, token?: string): Promise<PlanResult> {
  const r = await api<{ reference: string }>('/trip-requests', {
    method: 'POST',
    body: payload,
    token,
  });
  if (!r.ok) return { error: errorText(r.error) };
  redirect(`/trips/${r.data.reference}`);
}

/** Already signed in: send the request straight away. */
export async function submitPlan(payload: Record<string, unknown>): Promise<PlanResult> {
  return send(payload);
}

/** Not signed in: send a code to the mobile number first. */
export async function sendPlanCode(phone: string): Promise<PlanResult> {
  const r = await api<{ challengeId: string; channel: 'whatsapp' | 'log' }>('/auth/otp/request', {
    method: 'POST',
    body: { phone },
  });
  if (!r.ok) return { error: errorText(r.error) };
  (await cookies()).set(CHALLENGE_COOKIE, r.data.challengeId, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/plan',
    maxAge: 10 * 60,
  });
  return { codeSent: { channel: r.data.channel } };
}

/** The code proves the number; the person is signed in and the request is sent. */
export async function verifyAndSubmit(
  code: string,
  payload: Record<string, unknown>,
): Promise<PlanResult> {
  const jar = await cookies();
  const challengeId = jar.get(CHALLENGE_COOKIE)?.value;
  if (!challengeId) return { error: 'That code has expired. Request a new one.' };
  const r = await api<{ token: string; expiresAt: string }>('/auth/otp/verify', {
    method: 'POST',
    body: { challengeId, code: code.trim() },
  });
  if (!r.ok) return { error: errorText(r.error) };
  jar.delete({ name: CHALLENGE_COOKIE, path: '/plan' });
  jar.set(SESSION_COOKIE, r.data.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    expires: new Date(r.data.expiresAt),
  });
  return send(payload, r.data.token);
}

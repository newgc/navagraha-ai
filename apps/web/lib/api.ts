import 'server-only';
import { cookies } from 'next/headers';

/**
 * Server-side API client. The session token lives in an httpOnly cookie and is only ever
 * read here, so browser JavaScript never sees it.
 */
export const SESSION_COOKIE = 'nav_session';
const API_URL = process.env.API_URL ?? 'http://localhost:4000';

export interface ApiError {
  statusCode?: number;
  message?: string | string[];
  errors?: { code: string; message: string; stop?: number }[];
  warnings?: { code: string; message: string }[];
  correlationId?: string;
}

export type ApiResult<T> =
  { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiError };

export async function api<T>(
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
    });
  } catch {
    return {
      ok: false,
      status: 503,
      error: { message: 'The server cannot be reached. Try again shortly.' },
    };
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (res.ok) return { ok: true, status: res.status, data: data as T };
  return {
    ok: false,
    status: res.status,
    error: (data as ApiError) ?? { message: `Error ${res.status}` },
  };
}

/** One readable line for a form, with the support reference when there is one. */
export function errorText(e: ApiError): string {
  const msg = Array.isArray(e.message)
    ? e.message.join('; ')
    : (e.message ?? 'Something went wrong');
  const details = e.errors?.length
    ? ` — ${e.errors.map((x) => (x.stop ? `stop ${x.stop}: ` : '') + x.message).join('; ')}`
    : '';
  return `${msg}${details}${e.correlationId ? ` (ref ${e.correlationId.slice(0, 8)})` : ''}`;
}

export interface Me {
  id: string;
  phone: string | null;
  displayName: string | null;
  roles: string[];
}

export const STAFF_ROLES = ['OPS_COORDINATOR', 'OPS_MANAGER', 'FINANCE'];

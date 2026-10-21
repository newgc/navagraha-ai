import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { api, type Me } from '@/lib/api';
import { signOut } from '../sign-in/actions';

export const metadata = { title: 'My trips — Navagraha AI' };

/** The customer's own area (FS §4.10). The API only ever returns their own requests and bookings. */
export default async function TripsLayout({ children }: { children: ReactNode }) {
  const me = await api<Me>('/me');
  if (!me.ok) redirect('/sign-in');
  return (
    <div className="customer">
      <header className="ops-header">
        <Link href="/trips" className="brand">
          Navagraha AI · My trips
        </Link>
        <nav>
          <Link href="/plan">Plan a pilgrimage</Link>
        </nav>
        <div className="who">
          <span>{me.data.displayName ?? me.data.phone}</span>
          <form action={signOut}>
            <button type="submit" className="link">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}

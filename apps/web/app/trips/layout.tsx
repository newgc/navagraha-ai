import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { SitePage } from '@/components/site-header';
import { api, type Me } from '@/lib/api';
import { signOut } from '../sign-in/actions';

export const metadata = { title: 'My trips — Navagraha AI' };

/** The customer's own area (FS §4.10). The API only ever returns their own requests and bookings. */
export default async function TripsLayout({ children }: { children: ReactNode }) {
  const me = await api<Me>('/me');
  if (!me.ok) redirect('/sign-in');
  return (
    <SitePage
      right={
        <div className="who">
          <span>{me.data.displayName ?? me.data.phone}</span>
          <form action={signOut}>
            <button type="submit" className="link">
              Sign out
            </button>
          </form>
        </div>
      }
    >
      <main>{children}</main>
    </SitePage>
  );
}

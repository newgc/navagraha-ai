import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { BOOKING_ROLES, STAFF_ROLES, TEMPLE_DATA_ROLES, api, type Me } from '@/lib/api';
import { humanize } from '@/lib/format';
import { signOut } from '../sign-in/actions';

export const metadata = { title: 'Operations — Navagraha AI' };

/** Every /ops page needs a signed-in staff member. The API enforces roles again on each call. */
export default async function OpsLayout({ children }: { children: ReactNode }) {
  const me = await api<Me>('/me');
  if (!me.ok) redirect('/sign-in');
  const staffRoles = me.data.roles.filter((r) => STAFF_ROLES.includes(r));
  const canCreate = staffRoles.some((r) => r === 'OPS_COORDINATOR' || r === 'OPS_MANAGER');

  return (
    <div className="ops">
      <header className="ops-header">
        <Link href="/ops" className="brand">
          Navagraha AI · Operations
        </Link>
        <nav>
          {staffRoles.some((r) => BOOKING_ROLES.includes(r)) && <Link href="/ops">Bookings</Link>}
          {canCreate && <Link href="/ops/bookings/new">New booking</Link>}
          {staffRoles.some((r) => TEMPLE_DATA_ROLES.includes(r)) && (
            <Link href="/ops/temples">Temple data</Link>
          )}
          {staffRoles.includes('SYSTEM_ADMIN') && <Link href="/ops/team">Team</Link>}
        </nav>
        <div className="who">
          <span>
            {me.data.displayName ?? me.data.phone} ·{' '}
            {staffRoles.map(humanize).join(', ') || 'Customer'}
          </span>
          <form action={signOut}>
            <button type="submit" className="link">
              Sign out
            </button>
          </form>
        </div>
      </header>
      {staffRoles.length === 0 ? (
        <main>
          <h1>No access</h1>
          <p>This area is for the operations team. Ask a manager to give you a role.</p>
        </main>
      ) : (
        <main className="wide">{children}</main>
      )}
    </div>
  );
}

import { api, type Me } from '@/lib/api';
import { NewBookingForm } from './new-booking-form';

export const metadata = { title: 'New booking — Navagraha AI' };

interface Temple {
  code: string;
  commonName: string;
  graha: string | null;
  verification: { isVerified: boolean };
}

export default async function NewBookingPage() {
  const [temples, me] = await Promise.all([api<{ temples: Temple[] }>('/temples'), api<Me>('/me')]);
  const roles = me.ok ? me.data.roles : [];
  if (!roles.includes('OPS_COORDINATOR') && !roles.includes('OPS_MANAGER')) {
    return <p>Only coordinators and managers can create bookings.</p>;
  }
  return (
    <>
      <h1>New booking</h1>
      <p className="muted">For bookings taken by phone, WhatsApp or in person.</p>
      <NewBookingForm temples={temples.ok ? temples.data.temples : []} />
    </>
  );
}

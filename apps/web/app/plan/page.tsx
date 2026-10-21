import Link from 'next/link';
import { SitePage } from '@/components/site-header';
import { api, type Me } from '@/lib/api';
import { PlanForm } from './plan-form';

export const metadata = { title: 'Plan My Pilgrimage — Navagraha AI' };

// Self-service, first version: the customer tells us what they need, our team plans and
// prices it, and the customer accepts and pays online. The AI planner comes later (P5).
export default async function Plan() {
  const me = await api<Me>('/me');
  return (
    <SitePage>
      <main className="narrow plan-page">
        <h1>Plan My Pilgrimage</h1>
        <p>
          Tell us about your trip to the nine Navagraha temples around Kumbakonam. Our team plans it
          personally — temple timings, travel, rest and darshan — and sends you the itinerary and
          price on WhatsApp, usually within a day. You pay only when you accept it.
        </p>
        <PlanForm
          signedIn={me.ok}
          name={me.ok ? (me.data.displayName ?? '') : ''}
          phone={me.ok ? (me.data.phone ?? '') : ''}
        />
        <p className="small muted">
          Already sent a request? <Link href="/trips">See my trips</Link>
        </p>
      </main>
    </SitePage>
  );
}

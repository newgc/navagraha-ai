import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BookingForm } from '@/components/booking-form';
import { api, errorText } from '@/lib/api';
import type { BookingFormState } from '@/lib/booking-form';
import { todayIso } from '@/lib/format';
import { proposeChange } from './actions';

export const metadata = { title: 'Propose a change — Navagraha AI' };

interface Booking {
  reference: string;
  startDate: string;
  template: '1D' | '2D1N';
  mode: string;
  pickup: { location: string | null; time: string | null };
  booker: { phone: string | null };
  travellers: {
    id: string;
    fullName: string;
    ageBand: string;
    relationshipToBooker: string;
    needsWheelchair: boolean;
    isLead: boolean;
  }[];
  itinerary: { stops: { templeCode: string; day: number; plannedArrival: string | null }[] } | null;
  quote: {
    lines: {
      kind: string;
      description: string;
      quantity: number;
      unitPricePaise: number;
      taxPaise: number;
    }[];
  } | null;
  changeRequests: { id: string; state: string; kind: string; description: string }[];
}

interface Temple {
  code: string;
  commonName: string;
  graha: string | null;
  verification: { isVerified: boolean };
}

const rupees = (paise: number) => (paise / 100).toFixed(2).replace(/\.00$/, '');

export default async function ProposeChangePage({
  params,
}: {
  params: Promise<{ reference: string; id: string }>;
}) {
  const { reference, id } = await params;
  const [b, t] = await Promise.all([
    api<Booking>(`/bookings/${reference}`),
    api<{ temples: Temple[] }>('/temples'),
  ]);
  if (!b.ok && (b.status === 404 || b.status === 400)) notFound();
  if (!b.ok)
    return (
      <p role="alert" className="error">
        {errorText(b.error)}
      </p>
    );
  const cr = b.data.changeRequests.find((c) => c.id === id);
  if (!cr) notFound();
  if (cr.state !== 'REQUESTED' && cr.state !== 'REVIEWING') {
    return <p>This change request is {cr.state.toLowerCase()} and can no longer be changed.</p>;
  }
  const temples = t.ok ? t.data.temples : [];
  const current = b.data.itinerary?.stops ?? [];
  const lead = b.data.travellers.findIndex((x) => x.isLead);

  // Start from the booking as it is now: current temples in order, then the rest unticked.
  const initial: Partial<BookingFormState> = {
    bookerPhone: b.data.booker.phone ?? '',
    startDate: b.data.startDate,
    template: b.data.template,
    mode: b.data.mode,
    pickupLocation: b.data.pickup.location ?? '',
    pickupTime: b.data.pickup.time?.slice(0, 5) ?? '',
    travellers: b.data.travellers.map((x) => ({
      travellerId: x.id,
      fullName: x.fullName,
      ageBand: x.ageBand,
      relationshipToBooker: x.relationshipToBooker,
      needsWheelchair: x.needsWheelchair,
      mobilityNotes: '',
    })),
    leadIndex: lead < 0 ? 0 : lead,
    stops: [
      ...current.map((s) => ({
        templeCode: s.templeCode,
        include: true,
        day: s.day,
        plannedArrival: s.plannedArrival?.slice(0, 5) ?? '',
      })),
      ...temples
        .filter((x) => !current.some((s) => s.templeCode === x.code))
        .map((x) => ({ templeCode: x.code, include: false, day: 1, plannedArrival: '' })),
    ],
    lines: (b.data.quote?.lines ?? []).map((l) => ({
      kind: l.kind,
      description: l.description,
      quantity: String(l.quantity),
      unitPrice: rupees(l.unitPricePaise),
      tax: l.taxPaise ? rupees(l.taxPaise) : '',
    })),
    validUntil: todayIso(7),
  };

  return (
    <>
      <p className="small">
        <Link href={`/ops/bookings/${reference}`}>← {reference}</Link>
      </p>
      <h1>Propose a change</h1>
      <p className="notice">
        Customer asked ({cr.kind.toLowerCase()}): {cr.description}
      </p>
      <p className="muted">
        Edit the plan and price below. Nothing changes on the booking until the customer accepts the
        proposal. A new travel date means every supplier is asked again.
      </p>
      <BookingForm
        temples={temples}
        mode="change"
        initial={initial}
        submit={proposeChange.bind(null, reference, id)}
        submitLabel="Save proposal"
      />
    </>
  );
}

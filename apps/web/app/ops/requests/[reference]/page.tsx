import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { Badge } from '@/components/badge';
import { BookingForm } from '@/components/booking-form';
import { api, errorText } from '@/lib/api';
import type { BookingFormState } from '@/lib/booking-form';
import {
  AGE_BANDS,
  RELATIONSHIPS,
  formatDate,
  formatDateTime,
  formatRupees,
  humanize,
  todayIso,
} from '@/lib/format';
import { markLost, sendProposal, startPlanning } from './actions';

interface Traveller {
  fullName: string;
  ageBand: string;
  relationshipToBooker: string;
  needsWheelchair?: boolean;
}

interface Plan {
  trip: {
    startDate: string;
    template: '1D' | '2D1N';
    mode: string;
    pickupLocation?: string;
    pickupTime?: string;
    notes?: string;
  };
  travellers: Traveller[];
  itinerary: { stops: { templeCode: string; day: number; plannedArrival?: string }[] };
  quote: {
    lines: {
      kind: string;
      description: string;
      quantity: number;
      unitPricePaise: number;
      taxPaise?: number;
    }[];
  };
  fulfilment?: { kind: string; capacity?: number }[];
}

interface LeadDetail {
  reference: string;
  state: string;
  createdAt: string;
  request: {
    startDate: string;
    flexibleDates?: boolean;
    days: string;
    pickup: { location: string; time?: string };
    travellers: Traveller[];
    purpose: string;
    hotelRequired?: boolean;
    notes?: string;
    contact: { name: string; email?: string };
  };
  customer: { name: string | null; phone: string | null; email: string | null };
  lostReason: string | null;
  booking: { reference: string } | null;
  proposals: {
    version: number;
    plan: Plan;
    totalPaise: number;
    validUntil: string;
    createdAt: string;
    accepted: boolean;
  }[];
  history: {
    from: string | null;
    to: string;
    actorRole: string;
    reason: string | null;
    recordedAt: string;
  }[];
}

interface Temple {
  code: string;
  commonName: string;
  graha: string | null;
  verification: { isVerified: boolean };
}

const OPEN = ['NEW', 'QUALIFIED', 'PLANNING', 'QUOTED'];
const DAYS: Record<string, string> = {
  '1': 'One day',
  '2': 'Two days, one night',
  RECOMMEND: 'Recommend for them',
};
const rupees = (paise: number) => (paise / 100).toFixed(2).replace(/\.00$/, '');

export default async function RequestPage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  const [r, t] = await Promise.all([
    api<LeadDetail>(`/trip-requests/${reference}`),
    api<{ temples: Temple[] }>('/temples'),
  ]);
  if (!r.ok && (r.status === 404 || r.status === 400)) notFound();
  if (!r.ok)
    return (
      <p role="alert" className="error">
        {errorText(r.error)}
      </p>
    );
  const q = r.data;
  const req = q.request;
  const temples = t.ok ? t.data.temples : [];
  const latest = q.proposals.at(-1);
  const open = OPEN.includes(q.state);

  // Start from the latest proposal, or from what the customer asked for.
  const base = latest?.plan;
  const wantsTwoDays = req.days === '2' || (req.days !== '1' && !!req.hotelRequired);
  const initial: Partial<BookingFormState> = {
    bookerPhone: q.customer.phone ?? '',
    startDate: base?.trip.startDate ?? req.startDate,
    template: base?.trip.template ?? (wantsTwoDays ? '2D1N' : '1D'),
    mode: base?.trip.mode ?? 'BALANCED',
    pickupLocation: base?.trip.pickupLocation ?? req.pickup.location,
    pickupTime: base?.trip.pickupTime ?? req.pickup.time ?? '',
    notes: base?.trip.notes ?? req.notes ?? '',
    travellers: (base?.travellers ?? req.travellers).map((x) => ({
      fullName: x.fullName,
      ageBand: x.ageBand,
      relationshipToBooker: x.relationshipToBooker,
      needsWheelchair: !!x.needsWheelchair,
      mobilityNotes: '',
    })),
    leadIndex: 0,
    ...(base
      ? {
          stops: [
            ...base.itinerary.stops.map((s) => ({
              templeCode: s.templeCode,
              include: true,
              day: s.day,
              plannedArrival: s.plannedArrival ?? '',
            })),
            ...temples
              .filter((x) => !base.itinerary.stops.some((s) => s.templeCode === x.code))
              .map((x) => ({ templeCode: x.code, include: false, day: 1, plannedArrival: '' })),
          ],
          lines: base.quote.lines.map((l) => ({
            kind: l.kind,
            description: l.description,
            quantity: String(l.quantity),
            unitPrice: rupees(l.unitPricePaise),
            tax: l.taxPaise ? rupees(l.taxPaise) : '',
          })),
          vehicleSeats: String(base.fulfilment?.find((f) => f.kind === 'VEHICLE')?.capacity ?? ''),
        }
      : {}),
    validUntil: todayIso(3),
  };

  return (
    <>
      <p className="small">
        <Link href="/ops/requests">← Trip requests</Link>
      </p>
      <h1>
        {q.reference} <Badge state={q.state} />
      </h1>
      {q.booking && (
        <p className="notice">
          Accepted and booked as{' '}
          <Link href={`/ops/bookings/${q.booking.reference}`}>{q.booking.reference}</Link>.
        </p>
      )}
      {q.lostReason && <p className="muted">Closed: {q.lostReason}</p>}

      <div className="grid">
        <section className="card">
          <h2>What the customer asked for</h2>
          <p>
            <strong>{req.contact.name}</strong> · {q.customer.phone}
            {req.contact.email && <> · {req.contact.email}</>}
          </p>
          <p>
            {formatDate(req.startDate)}
            {req.flexibleDates && ' (flexible)'} · {DAYS[req.days] ?? req.days}
            {req.hotelRequired && ' · needs a hotel'}
          </p>
          <p>
            Pickup: {req.pickup.location}
            {req.pickup.time && ` at ${req.pickup.time}`}
          </p>
          <p>Purpose: {humanize(req.purpose)}</p>
          <ul>
            {req.travellers.map((x, i) => (
              <li key={i}>
                {x.fullName} · {AGE_BANDS[x.ageBand]} · {RELATIONSHIPS[x.relationshipToBooker]}
                {x.needsWheelchair && ' · wheelchair'}
              </li>
            ))}
          </ul>
          {req.notes && <p className="notice">{req.notes}</p>}
          <p className="small muted">Received {formatDateTime(q.createdAt)}</p>
          {open && (
            <div className="row">
              {(q.state === 'NEW' || q.state === 'QUALIFIED') && (
                <ActionForm
                  action={startPlanning.bind(null, q.reference)}
                  label="Start planning"
                  inline
                />
              )}
              <ActionForm
                action={markLost.bind(null, q.reference)}
                label="Close request"
                variant="danger"
                inline
              >
                <input name="reason" placeholder="Why" required aria-label="Close reason" />
              </ActionForm>
            </div>
          )}
        </section>

        <section className="card">
          <h2>Proposals sent</h2>
          {q.proposals.length === 0 ? (
            <p className="muted">None yet.</p>
          ) : (
            <ul className="plain">
              {q.proposals.map((p) => (
                <li key={p.version}>
                  v{p.version} · {formatRupees(p.totalPaise)} · {humanize(p.plan.trip.template)} on{' '}
                  {formatDate(p.plan.trip.startDate)} · valid until {formatDateTime(p.validUntil)}
                  {p.accepted && <strong> · accepted</strong>}
                  {!p.accepted && p !== latest && <span className="muted"> · replaced</span>}
                </li>
              ))}
            </ul>
          )}
          <h3>History</h3>
          <ul className="plain small">
            {q.history.map((h, i) => (
              <li key={i}>
                {formatDateTime(h.recordedAt)} · {h.from ? `${humanize(h.from)} → ` : ''}
                {humanize(h.to)} · {humanize(h.actorRole)}
                {h.reason && <span className="muted"> · {h.reason}</span>}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {open && (
        <section>
          <h2>{latest ? 'Send an updated proposal' : 'Send a proposal'}</h2>
          <p className="muted">
            Plan and price it as for a phone booking. The customer gets it on WhatsApp, sees it at
            /trips and accepts it online; a new version replaces the previous one.
          </p>
          <BookingForm
            temples={temples}
            mode="proposal"
            initial={initial}
            submit={sendProposal.bind(null, q.reference)}
            submitLabel={latest ? 'Send updated proposal' : 'Send proposal'}
          />
        </section>
      )}
    </>
  );
}

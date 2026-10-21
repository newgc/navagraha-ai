import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { api, errorText } from '@/lib/api';
import { AGE_BANDS, formatDate, formatDateTime, formatRupees, humanize } from '@/lib/format';
import { BOOKING_STATUS, REQUEST_STATUS } from '../status';
import { acceptPlan, payNow } from './actions';

interface Line {
  description: string;
  quantity: number;
  unitPricePaise: number;
  taxPaise: number;
}

interface MyRequest {
  reference: string;
  status: string;
  request: { startDate: string; days: string; pickup: { location: string } };
  booking: { reference: string } | null;
  proposal: {
    version: number;
    validUntil: string;
    expired: boolean;
    trip: {
      startDate: string;
      template: string;
      pickupLocation: string | null;
      pickupTime: string | null;
    };
    travellers: { fullName: string; ageBand: string }[];
    stops: { day: number; temple: string; plannedArrival: string | null }[];
    lines: Line[];
    subtotalPaise: number;
    taxPaise: number;
    totalPaise: number;
    checked: string;
  } | null;
}

interface MyBooking {
  reference: string;
  state: string;
  startDate: string;
  template: string;
  pickup: { location: string | null; time: string | null };
  travellers: { fullName: string; ageBand: string }[];
  stops: { day: number; templeName: string; plannedArrival: string | null }[];
  quote: { totalPaise: number; taxPaise: number; lines: Line[] } | null;
  payment: {
    totalPaise: number;
    paidPaise: number;
    duePaise: number;
    payable: boolean;
    openLink: string | null;
  };
  confirmation: { open: boolean; waitingFor?: string[] };
  arrangements: { state: string; confirmed: number; total: number };
}

function Lines({
  lines,
  totalPaise,
  taxPaise,
}: {
  lines: Line[];
  totalPaise: number;
  taxPaise: number;
}) {
  return (
    <table className="lines">
      <tbody>
        {lines.map((l, i) => (
          <tr key={i}>
            <td>
              {l.description}
              {l.quantity > 1 && ` × ${l.quantity}`}
            </td>
            <td className="num">{formatRupees(l.quantity * l.unitPricePaise + l.taxPaise)}</td>
          </tr>
        ))}
        {taxPaise > 0 && (
          <tr className="muted small">
            <td>Includes taxes</td>
            <td className="num">{formatRupees(taxPaise)}</td>
          </tr>
        )}
        <tr>
          <th>Total</th>
          <th className="num">{formatRupees(totalPaise)}</th>
        </tr>
      </tbody>
    </table>
  );
}

function Days({
  stops,
  temple,
}: {
  stops: { day: number; plannedArrival: string | null }[];
  temple: (i: number) => string;
}) {
  const days = [...new Set(stops.map((s) => s.day))].sort();
  return (
    <>
      {days.map((d) => (
        <div key={d}>
          {days.length > 1 && <h3>Day {d}</h3>}
          <ol>
            {stops.map((s, i) =>
              s.day === d ? (
                <li key={i}>
                  {temple(i)}
                  {s.plannedArrival && (
                    <span className="muted small"> · around {s.plannedArrival.slice(0, 5)}</span>
                  )}
                </li>
              ) : null,
            )}
          </ol>
        </div>
      ))}
    </>
  );
}

export default async function TripPage({
  params,
  searchParams,
}: {
  params: Promise<{ reference: string }>;
  searchParams: Promise<{ accepted?: string }>;
}) {
  const { reference } = await params;
  const { accepted } = await searchParams;
  if (reference.startsWith('REQ-')) return <RequestView reference={reference} />;
  if (!reference.startsWith('NAV-')) notFound();

  const r = await api<MyBooking>(`/my/bookings/${reference}`);
  if (!r.ok && (r.status === 404 || r.status === 400)) notFound();
  if (!r.ok)
    return (
      <p role="alert" className="error">
        {errorText(r.error)}
      </p>
    );
  const b = r.data;
  return (
    <>
      <p className="small">
        <Link href="/trips">← My trips</Link>
      </p>
      <h1>
        Booking {b.reference} · {BOOKING_STATUS[b.state] ?? humanize(b.state)}
      </h1>
      {accepted && (
        <p className="notice">Thank you — your plan is booked. Pay below to go ahead.</p>
      )}
      <section className="card">
        <h2>Payment</h2>
        <p>
          Paid {formatRupees(b.payment.paidPaise)} of {formatRupees(b.payment.totalPaise)}
          {b.payment.duePaise > 0 && (
            <>
              {' '}
              · <strong>Due {formatRupees(b.payment.duePaise)}</strong>
            </>
          )}
        </p>
        {(b.payment.payable || b.payment.openLink) && (
          <ActionForm action={payNow.bind(null, b.reference)} label="Pay now" />
        )}
        <p className="small muted">
          Secure payment by Cashfree (UPI, cards, netbanking). It shows here a few seconds after you
          pay.
        </p>
      </section>
      <section className="card">
        <h2>Your pilgrimage</h2>
        <p>
          {formatDate(b.startDate)} · {b.template === '2D1N' ? '2 days, 1 night' : '1 day'}
          {b.pickup.location && <> · pickup at {b.pickup.location}</>}
          {b.pickup.time && <> at {b.pickup.time.slice(0, 5)}</>}
        </p>
        <Days stops={b.stops} temple={(i) => b.stops[i]!.templeName} />
        <p className="small muted">
          Arrangements confirmed: {b.arrangements.confirmed} of {b.arrangements.total}. We confirm
          your trip when payment is received and every arrangement is in place.
        </p>
      </section>
      {b.quote && (
        <section className="card">
          <h2>Price</h2>
          <Lines
            lines={b.quote.lines}
            totalPaise={b.quote.totalPaise}
            taxPaise={b.quote.taxPaise}
          />
        </section>
      )}
      <section className="card">
        <h2>Travellers</h2>
        <ul>
          {b.travellers.map((t, i) => (
            <li key={i}>
              {t.fullName} <span className="muted small">{AGE_BANDS[t.ageBand]}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

async function RequestView({ reference }: { reference: string }) {
  const r = await api<MyRequest>(`/my/trip-requests/${reference}`);
  if (!r.ok && (r.status === 404 || r.status === 400)) notFound();
  if (!r.ok)
    return (
      <p role="alert" className="error">
        {errorText(r.error)}
      </p>
    );
  const q = r.data;
  const p = q.proposal;
  return (
    <>
      <p className="small">
        <Link href="/trips">← My trips</Link>
      </p>
      <h1>
        Request {q.reference} · {REQUEST_STATUS[q.status] ?? humanize(q.status)}
      </h1>
      {q.booking && (
        <p>
          Booked as <Link href={`/trips/${q.booking.reference}`}>{q.booking.reference}</Link>.
        </p>
      )}
      {!p && !q.booking && q.status !== 'CLOSED' && (
        <p>
          Thank you. Our team is planning your pilgrimage for {formatDate(q.request.startDate)} and
          will send you the itinerary and price on WhatsApp. This page shows it as soon as it is
          ready.
        </p>
      )}
      {p && (
        <>
          <section className="card">
            <h2>Your plan</h2>
            <p>
              {formatDate(p.trip.startDate)} ·{' '}
              {p.trip.template === '2D1N' ? '2 days, 1 night' : '1 day'}
              {p.trip.pickupLocation && <> · pickup at {p.trip.pickupLocation}</>}
              {p.trip.pickupTime && <> at {p.trip.pickupTime}</>}
            </p>
            <Days stops={p.stops} temple={(i) => p.stops[i]!.temple} />
            <p className="small muted">{p.checked}</p>
          </section>
          <section className="card">
            <h2>Price</h2>
            <Lines lines={p.lines} totalPaise={p.totalPaise} taxPaise={p.taxPaise} />
            <p className="small muted">
              For {p.travellers.length} traveller{p.travellers.length > 1 ? 's' : ''}:{' '}
              {p.travellers.map((t) => t.fullName).join(', ')}.{' '}
              {p.expired
                ? 'This price has expired.'
                : `Price valid until ${formatDateTime(p.validUntil)}.`}
            </p>
            {p.expired ? (
              <p className="notice">Ask our team on WhatsApp for an updated plan.</p>
            ) : (
              <ActionForm
                action={acceptPlan.bind(null, q.reference, p.version)}
                label="Accept and book"
              />
            )}
          </section>
        </>
      )}
    </>
  );
}

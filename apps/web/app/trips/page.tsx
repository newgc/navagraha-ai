import Link from 'next/link';
import { api, errorText } from '@/lib/api';
import { formatDate, formatRupees, humanize } from '@/lib/format';
import { REQUEST_STATUS } from './status';

interface MyTrips {
  requests: {
    reference: string;
    status: string;
    startDate: string;
    proposal: { totalPaise: number; validUntil: string } | null;
  }[];
  bookings: { reference: string; state: string; startDate: string; template: string }[];
}

export default async function MyTripsPage() {
  const r = await api<MyTrips>('/my/trips');
  if (!r.ok)
    return (
      <p role="alert" className="error">
        {errorText(r.error)}
      </p>
    );
  const { requests, bookings } = r.data;
  return (
    <>
      <h1>My trips</h1>
      {requests.length === 0 && bookings.length === 0 && (
        <p>
          Nothing here yet. <Link href="/plan">Plan your pilgrimage</Link>.
        </p>
      )}
      {bookings.length > 0 && (
        <section>
          <h2>Bookings</h2>
          <ul className="plain">
            {bookings.map((b) => (
              <li key={b.reference} className="card">
                <Link href={`/trips/${b.reference}`}>
                  <strong>{b.reference}</strong>
                </Link>{' '}
                · {formatDate(b.startDate)} · {b.template === '2D1N' ? '2 days' : '1 day'} ·{' '}
                {humanize(b.state)}
              </li>
            ))}
          </ul>
        </section>
      )}
      {requests.length > 0 && (
        <section>
          <h2>Requests</h2>
          <ul className="plain">
            {requests.map((q) => (
              <li key={q.reference} className="card">
                <Link href={`/trips/${q.reference}`}>
                  <strong>{q.reference}</strong>
                </Link>{' '}
                · {formatDate(q.startDate)} · {REQUEST_STATUS[q.status] ?? humanize(q.status)}
                {q.proposal && <> · {formatRupees(q.proposal.totalPaise)}</>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

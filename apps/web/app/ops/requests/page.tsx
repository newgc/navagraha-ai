import Link from 'next/link';
import { Badge } from '@/components/badge';
import { api, errorText } from '@/lib/api';
import { formatDate, formatDateTime, humanize } from '@/lib/format';

interface Row {
  reference: string;
  state: string;
  startDate: string;
  createdAt: string;
  customer: { name: string | null; phone: string | null };
  travellers: number;
  days: string;
}

const DAYS: Record<string, string> = { '1': '1 day', '2': '2 days', RECOMMEND: 'Recommend' };

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;
  const r = await api<Row[]>(`/trip-requests${state ? `?state=${encodeURIComponent(state)}` : ''}`);
  return (
    <>
      <h1>Trip requests from the website</h1>
      <p className="muted">
        Plan each request and send the customer a proposal; they accept and pay online.
      </p>
      <p className="small">
        Show:{' '}
        {['', 'NEW', 'PLANNING', 'QUOTED', 'CONVERTED', 'LOST'].map((s) => (
          <span key={s}>
            <Link href={s ? `/ops/requests?state=${s}` : '/ops/requests'}>
              {s ? humanize(s) : 'All'}
            </Link>{' '}
          </span>
        ))}
      </p>
      {!r.ok ? (
        <p role="alert" className="error">
          {errorText(r.error)}
        </p>
      ) : r.data.length === 0 ? (
        <p>No requests.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Request</th>
              <th>Travel</th>
              <th>Customer</th>
              <th>Group</th>
              <th>Received</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {r.data.map((q) => (
              <tr key={q.reference}>
                <td>
                  <Link href={`/ops/requests/${q.reference}`}>{q.reference}</Link>
                </td>
                <td>
                  {formatDate(q.startDate)} · {DAYS[q.days] ?? q.days}
                </td>
                <td>
                  {q.customer.name ?? '—'} <span className="muted small">{q.customer.phone}</span>
                </td>
                <td>{q.travellers}</td>
                <td className="small">{formatDateTime(q.createdAt)}</td>
                <td>
                  <Badge state={q.state} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

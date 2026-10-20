import Link from 'next/link';
import { Badge } from '@/components/badge';
import { api, errorText } from '@/lib/api';
import { formatDate, formatRupees, humanize, todayIso } from '@/lib/format';

interface Row {
  reference: string;
  state: string;
  startDate: string;
  template: string;
  mode: string;
  seniorFriendly: boolean;
  sourceChannel: string;
  bookerName: string | null;
  bookerPhone: string | null;
  totalPaise: number | null;
  travellers: number;
}

const STATES = [
  'REQUESTED',
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
];

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; state?: string }>;
}) {
  const sp = await searchParams;
  const from = sp.from || todayIso();
  const to = sp.to || todayIso(60);
  const qs = new URLSearchParams({ from, to, ...(sp.state ? { state: sp.state } : {}) });
  const r = await api<{ bookings: Row[] }>(`/bookings?${qs}`);

  return (
    <>
      <div className="page-head">
        <h1>Bookings</h1>
        <form className="filters" method="get">
          <label>
            From <input type="date" name="from" defaultValue={from} />
          </label>
          <label>
            To <input type="date" name="to" defaultValue={to} />
          </label>
          <label>
            State
            <select name="state" defaultValue={sp.state ?? ''}>
              <option value="">Any</option>
              {STATES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="secondary">
            Show
          </button>
        </form>
      </div>
      {!r.ok ? (
        <p role="alert" className="error">
          {errorText(r.error)}
        </p>
      ) : r.data.bookings.length === 0 ? (
        <p className="muted">
          No bookings between {formatDate(from)} and {formatDate(to)}.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Reference</th>
              <th>Travel date</th>
              <th>Booker</th>
              <th>Travellers</th>
              <th>Trip</th>
              <th className="num">Total</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {r.data.bookings.map((b) => (
              <tr key={b.reference}>
                <td>
                  <Link href={`/ops/bookings/${b.reference}`}>{b.reference}</Link>
                </td>
                <td>{formatDate(b.startDate)}</td>
                <td>
                  {b.bookerName ?? '—'}
                  <div className="muted small">{b.bookerPhone}</div>
                </td>
                <td>{b.travellers}</td>
                <td>
                  {b.template === '2D1N' ? '2 days / 1 night' : '1 day'} · {humanize(b.mode)}
                  {b.seniorFriendly && <span className="badge neutral">Senior-Friendly</span>}
                </td>
                <td className="num">{formatRupees(b.totalPaise)}</td>
                <td>
                  <Badge state={b.state} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

import Link from 'next/link';
import { Badge } from '@/components/badge';
import { api, errorText, type Me } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { UploadForm } from './upload-form';

export const metadata = { title: 'Temple data — Navagraha AI' };

interface Tally {
  total: number;
  verified: number;
  needsRecheck: number;
}

interface Overview {
  circuit: { code: string; name: string; status: string };
  recheckAfterDays: number;
  temples: {
    code: string;
    commonName: string;
    graha: string | null;
    verificationStatus: string;
    lastVerifiedOn: string | null;
    stale: boolean;
    schedules: Tally;
    currentVerifiedSchedules: number;
    upcomingSpecialDays: number;
    services: Tally & { active: number };
    entryRules: Tally;
  }[];
  travel: Tally & { templePairs: { total: number; verified: number } };
  tripWideEntryRules: Tally;
  readiness: { check: string; done: number; of: number; ok: boolean; lowerIsBetter?: boolean }[];
}

interface ImportRow {
  at: string;
  sha256: string;
  actor?: string;
  fileName?: string;
  counts?: Record<string, number>;
}

export default async function TempleDataPage() {
  const [o, history, me] = await Promise.all([
    api<Overview>('/admin/temple-data'),
    api<{ imports: ImportRow[] }>('/admin/temple-data/imports'),
    api<Me>('/me'),
  ]);
  if (!o.ok)
    return (
      <p role="alert" className="error">
        {errorText(o.error)}
      </p>
    );
  const d = o.data;
  const canImport =
    me.ok && me.data.roles.some((r) => r === 'CONTENT_ADMIN' || r === 'SYSTEM_ADMIN');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Temple data</h1>
          <p className="muted">
            {d.circuit.name} circuit · <Badge state={d.circuit.status} /> · The workbook is the
            master copy; only facts marked Verified are shown to customers as fact.
          </p>
        </div>
        <Link href="/ops/temples/queue" className="button-link">
          Data verification queue
        </Link>
      </div>

      <section className="card">
        <h2>Ready for the pilot?</h2>
        <ul className="plain checklist">
          {d.readiness.map((c) => (
            <li key={c.check} className={c.ok ? 'ok' : 'todo'}>
              <span aria-hidden>{c.ok ? '✓' : '○'}</span> {c.check}:{' '}
              <strong>{c.lowerIsBetter ? c.done : `${c.done} of ${c.of}`}</strong>
            </li>
          ))}
        </ul>
        <p className="muted small">
          Verified facts are flagged for a re-check after {d.recheckAfterDays} days.
        </p>
      </section>

      <section className="card">
        <h2>Temples</h2>
        <table>
          <thead>
            <tr>
              <th>Temple</th>
              <th>Record</th>
              <th>Opening hours</th>
              <th>Services</th>
              <th>Special days ahead</th>
              <th>Entry rules</th>
            </tr>
          </thead>
          <tbody>
            {d.temples.map((t) => (
              <tr key={t.code}>
                <td>
                  <Link href={`/ops/temples/${t.code}`}>{t.commonName}</Link>
                  <div className="muted small">{t.graha}</div>
                </td>
                <td>
                  <Badge state={t.verificationStatus} />
                  {t.stale && <span className="badge warn">Re-check due</span>}
                  <div className="muted small">
                    {t.lastVerifiedOn
                      ? `checked ${formatDate(t.lastVerifiedOn)}`
                      : 'not checked yet'}
                  </div>
                </td>
                <td>
                  {t.schedules.verified} of {t.schedules.total} verified
                  {t.currentVerifiedSchedules === 0 && (
                    <div className="muted small">none in force today</div>
                  )}
                </td>
                <td>
                  {t.services.verified} of {t.services.total} verified
                  <div className="muted small">{t.services.active} offered</div>
                </td>
                <td>{t.upcomingSpecialDays}</td>
                <td>
                  {t.entryRules.verified} of {t.entryRules.total}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small">
          Travel times: {d.travel.verified} of {d.travel.total} rows verified ·{' '}
          {d.travel.templePairs.verified} of {d.travel.templePairs.total} temple-to-temple pairs
          covered · Trip-wide entry rules: {d.tripWideEntryRules.verified} of{' '}
          {d.tripWideEntryRules.total} verified
        </p>
      </section>

      <div className="grid">
        {canImport && (
          <section className="card">
            <h2>Upload the workbook</h2>
            <UploadForm />
          </section>
        )}
        <section className="card">
          <h2>Recent imports</h2>
          {!history.ok || history.data.imports.length === 0 ? (
            <p className="muted">No imports yet.</p>
          ) : (
            <table>
              <tbody>
                {history.data.imports.map((h) => (
                  <tr key={h.sha256 + h.at}>
                    <td className="small">{formatDateTime(h.at)}</td>
                    <td>
                      {h.fileName}
                      <div className="muted small">
                        by {h.actor} · {h.counts?.verified ?? 0} verified rows · file{' '}
                        {h.sha256.slice(0, 10)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}

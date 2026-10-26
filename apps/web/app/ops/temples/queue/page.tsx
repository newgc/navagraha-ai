import { SOURCE_LABELS, SOURCE_PRIORITY, SOURCE_TYPES } from '@navagraha/domain';
import Link from 'next/link';
import { Fragment } from 'react';
import { ActionForm } from '@/components/action-form';
import { Badge } from '@/components/badge';
import { api, errorText, type Me } from '@/lib/api';
import { formatDate, formatDateTime, todayIso } from '@/lib/format';
import { acceptCheck, addCheck, markConflicting, rejectCheck, verifyFact } from './actions';

export const metadata = { title: 'Data verification queue — Navagraha AI' };

type Confidence =
  'VERIFIED' | 'OPERATIONAL_CONFIRMED' | 'ESTIMATED' | 'UNCONFIRMED' | 'CONFLICTING' | 'STALE';

interface CheckView {
  id: string;
  field: string;
  fieldLabel: string;
  value: string;
  currentValue: string;
  agrees: boolean | null;
  source: string;
  sourceLabel: string;
  priority: number;
  canSettle: boolean;
  sourceUrl: string | null;
  observedOn: string;
  note: string | null;
  status: string;
  recordedBy: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

interface Item {
  subject: string;
  subjectKey: string;
  templeCode: string | null;
  title: string;
  confidence: Confidence;
  fields: { field: string; label: string; type: string; value: string }[];
  source: string | null;
  sourceLabel: string | null;
  priority: number | null;
  verifiedBy: string | null;
  verifiedOn: string | null;
  verificationStatus: string;
  openChecks: CheckView[];
}

interface Queue {
  view: string;
  recheckAfterDays: number;
  counts: Record<Confidence, number>;
  items: Item[];
  recentDecisions: (CheckView & { subjectKey: string })[];
}

const VIEWS = [
  { view: 'conflicts', label: 'Conflicts', counts: ['CONFLICTING'] },
  { view: 'recheck', label: 'Re-check due', counts: ['STALE'] },
  { view: 'unverified', label: 'Not verified yet', counts: ['UNCONFIRMED', 'ESTIMATED'] },
  { view: 'all', label: 'Everything', counts: [] },
] as const;

const CONFIDENCE_HELP: Record<Confidence, string> = {
  VERIFIED: 'Verified from an official source',
  OPERATIONAL_CONFIRMED: 'Confirmed by our team or a verified local operator',
  ESTIMATED: 'An estimate — not shown to customers as fact',
  UNCONFIRMED: 'Not collected or not verified yet',
  CONFLICTING: 'Sources disagree — not used for planning until someone decides',
  STALE: 'Needs a re-check',
};

/** Strong sources first; weaker ones can only flag a fact (V2 §26 source priority). */
const sourceOptions = [...SOURCE_TYPES].sort((a, b) => SOURCE_PRIORITY[a] - SOURCE_PRIORITY[b]);
const verifyingSources = sourceOptions.filter((s) => SOURCE_PRIORITY[s] <= 4);

function SourceSelect({ only }: { only?: readonly string[] }) {
  return (
    <label>
      Source type
      <select name="sourceType" required defaultValue="">
        <option value="" disabled>
          Choose…
        </option>
        {(only ?? sourceOptions).map((s) => (
          <option key={s} value={s}>
            {SOURCE_PRIORITY[s as keyof typeof SOURCE_PRIORITY]}.{' '}
            {SOURCE_LABELS[s as keyof typeof SOURCE_LABELS]}
          </option>
        ))}
      </select>
    </label>
  );
}

export default async function VerificationQueue({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; temple?: string }>;
}) {
  const sp = await searchParams;
  const view = VIEWS.some((v) => v.view === sp.view) ? sp.view! : 'conflicts';
  const temple = sp.temple && /^[A-Z0-9-]{3,32}$/.test(sp.temple) ? sp.temple : '';
  const [q, me] = await Promise.all([
    api<Queue>(`/admin/temple-data/queue?view=${view}${temple ? `&temple=${temple}` : ''}`),
    api<Me>('/me'),
  ]);
  if (!q.ok)
    return (
      <p role="alert" className="error">
        {errorText(q.error)}
      </p>
    );
  const d = q.data;
  const canDecide =
    me.ok &&
    me.data.roles.some((r) => r === 'CONTENT_ADMIN' || r === 'OPS_MANAGER' || r === 'SYSTEM_ADMIN');
  const today = todayIso();
  const link = (v: string) => `/ops/temples/queue?view=${v}${temple ? `&temple=${temple}` : ''}`;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted small">
            <Link href="/ops/temples">← Temple data</Link>
          </p>
          <h1>Data verification queue</h1>
          <p className="muted">
            Every fact keeps its source. When two sources disagree the fact is flagged, not guessed:
            planning stops using it until a content admin or operations manager decides. Facts are
            due for a re-check after {d.recheckAfterDays} days.
          </p>
        </div>
      </div>

      <nav className="tabs" aria-label="Queue views">
        {VIEWS.map((v) => {
          const n = v.counts.reduce((sum, c) => sum + (d.counts[c] ?? 0), 0);
          return (
            <Link
              key={v.view}
              href={link(v.view)}
              aria-current={v.view === view ? 'page' : undefined}
            >
              {v.label}
              {v.counts.length > 0 && <span className="count">{n}</span>}
            </Link>
          );
        })}
      </nav>
      {temple && (
        <p className="small">
          Showing {temple} only ·{' '}
          <Link href={`/ops/temples/queue?view=${view}`}>show all temples</Link>
        </p>
      )}

      {d.items.length === 0 ? (
        <section className="card">
          <p className="muted">Nothing here.</p>
        </section>
      ) : (
        d.items.map((i) => (
          <section key={i.subjectKey} className="card fact-item">
            <div className="fact-head">
              <h2>{i.title}</h2>
              <span title={CONFIDENCE_HELP[i.confidence]}>
                <Badge state={i.confidence} />
              </span>
            </div>
            <p className="muted small">{CONFIDENCE_HELP[i.confidence]}</p>
            <dl className="facts">
              {i.fields.map((f) => (
                <Fragment key={f.field}>
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </Fragment>
              ))}
            </dl>
            <p className="small">
              {i.sourceLabel ? (
                <>
                  Source: {i.priority}. {i.sourceLabel}
                  {i.source && ` — ${i.source}`}
                </>
              ) : (
                'No source recorded'
              )}
              {i.verifiedOn && (
                <>
                  {' '}
                  · verified {formatDate(i.verifiedOn)}
                  {i.verifiedBy && ` by ${i.verifiedBy}`}
                </>
              )}
            </p>

            {i.openChecks.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>Fact</th>
                    <th>Current</th>
                    <th>Other source says</th>
                    <th>Second source</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {i.openChecks.map((c) => (
                    <tr key={c.id} className={c.agrees ? undefined : 'conflict'}>
                      <td>{c.fieldLabel}</td>
                      <td>{c.currentValue}</td>
                      <td>
                        <strong>{c.value}</strong>
                        {c.agrees && <span className="muted small"> (agrees)</span>}
                      </td>
                      <td className="small">
                        {c.priority}. {c.sourceLabel} — {c.source}
                        {c.sourceUrl && (
                          <>
                            {' '}
                            <a href={c.sourceUrl} rel="noreferrer noopener" target="_blank">
                              link
                            </a>
                          </>
                        )}
                        <div className="muted">
                          {formatDate(c.observedOn)}
                          {c.recordedBy && `, recorded by ${c.recordedBy}`}
                        </div>
                        {c.note && <div className="muted">{c.note}</div>}
                      </td>
                      <td>
                        {c.status === 'ACCEPTED' && (
                          <p className="muted small">
                            Accepted{c.decidedAt && ` ${formatDate(c.decidedAt)}`}
                            {c.decidedBy && ` by ${c.decidedBy}`}, but the data now says otherwise
                            (a workbook upload?). Verify to keep the current value, or correct the
                            workbook.
                          </p>
                        )}
                        {canDecide && c.status === 'OPEN' && (
                          <div className="row">
                            {c.canSettle ? (
                              <ActionForm
                                action={acceptCheck.bind(null, c.id)}
                                label="Update"
                                variant="secondary"
                                inline
                              />
                            ) : (
                              <span className="muted small">Too weak to settle</span>
                            )}
                            <ActionForm
                              action={rejectCheck.bind(null, c.id)}
                              label="Reject"
                              variant="danger"
                              inline
                            >
                              <input
                                name="reason"
                                placeholder="Why"
                                required
                                aria-label={`Why reject ${c.fieldLabel}`}
                              />
                            </ActionForm>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="fact-actions">
              {canDecide && (
                <details>
                  <summary>Verify the current values</summary>
                  <ActionForm action={verifyFact.bind(null, i.subjectKey)} label="Verify">
                    <SourceSelect only={verifyingSources} />
                    <label>
                      Who or which page
                      <input name="source" required placeholder="e.g. Temple office, Mr Kumar" />
                    </label>
                    <label>
                      Checked on
                      <input
                        name="checkedOn"
                        type="date"
                        required
                        max={today}
                        defaultValue={today}
                      />
                    </label>
                    {i.openChecks.some((c) => !c.agrees) && (
                      <p className="muted small">
                        Disagreeing sources above are closed as rejected: you are confirming the
                        current values.
                      </p>
                    )}
                  </ActionForm>
                </details>
              )}
              <details>
                <summary>Add a second source</summary>
                <ActionForm action={addCheck.bind(null, i.subjectKey)} label="Record">
                  <label>
                    Fact
                    <select name="field" required>
                      {i.fields.map((f) => (
                        <option key={f.field} value={f.field}>
                          {f.label} (now {f.value})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    What this source says
                    <input name="value" required placeholder="e.g. 06:30, 45, yes, 150" />
                  </label>
                  <SourceSelect />
                  <label>
                    Who or which page
                    <input name="source" required />
                  </label>
                  <label>
                    Link (optional)
                    <input name="sourceUrl" type="url" placeholder="https://" />
                  </label>
                  <label>
                    Seen on
                    <input
                      name="observedOn"
                      type="date"
                      required
                      max={today}
                      defaultValue={today}
                    />
                  </label>
                  <label>
                    Note (optional)
                    <input name="note" />
                  </label>
                </ActionForm>
              </details>
              {canDecide && i.verificationStatus !== 'NEEDS_RECHECK' && (
                <details>
                  <summary>Mark conflicting</summary>
                  <ActionForm
                    action={markConflicting.bind(null, i.subjectKey)}
                    label="Mark conflicting"
                    variant="danger"
                  >
                    <label>
                      What disagrees
                      <input name="note" required />
                    </label>
                    <p className="muted small">
                      Planning stops using this until it is verified again.
                    </p>
                  </ActionForm>
                </details>
              )}
            </div>
          </section>
        ))
      )}

      {d.recentDecisions.length > 0 && (
        <section className="card">
          <h2>Recent decisions</h2>
          <table>
            <tbody>
              {d.recentDecisions.map((c) => (
                <tr key={c.id}>
                  <td className="small">{c.decidedAt && formatDateTime(c.decidedAt)}</td>
                  <td>
                    {c.fieldLabel}: {c.value} <Badge state={c.status} />
                    <div className="muted small">
                      {c.subjectKey} · {c.sourceLabel} — {c.source}
                      {c.decidedBy && ` · decided by ${c.decidedBy}`}
                      {c.decisionNote && ` · ${c.decisionNote}`}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

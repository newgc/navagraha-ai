import Link from 'next/link';
import { humanize } from '@/lib/format';

type DayEvent =
  | { kind: 'TRAVEL'; from: string; to: string; depart: string; arrive: string; minutes: number }
  | {
      kind: 'VISIT';
      temple: string;
      arrive: string;
      enter: string;
      leave: string;
      waitMinutes: number;
      busy: string | null;
    }
  | { kind: 'MEAL'; start: string; end: string; late: boolean };

export interface Candidate {
  id: string;
  template: string;
  mode: string;
  feasible: boolean;
  days: {
    day: number;
    date: string;
    temples: string[];
    events: DayEvent[];
    start: string;
    end: string;
    travelMinutes: number;
    waitMinutes: number;
  }[];
  failure: { message: string } | null;
  score: number | null;
}

export interface Decision {
  id: string;
  status: string;
  input: { startDate: string; startTime?: string; fromPlace: string };
  result: {
    candidates: Candidate[];
    recommended: string | null;
    reasons: string[];
    gaps: { message: string }[];
    notes: { message: string }[];
    configVersion: string;
    factsVersion: string;
  };
}

const label = (c: Candidate) =>
  `${c.template === '1D' ? '1 day' : '2 days, 1 night'} · ${humanize(c.mode)}`;

/** The engine's DecisionRecord (FS §8.2) for a request: every option, why, and the timetable. */
export function PlanSuggestions({
  reference,
  decision,
  names,
  places,
}: {
  reference: string;
  decision: Decision;
  names: Record<string, string>;
  places: Record<string, string>;
}) {
  const r = decision.result;
  const name = (code: string) => names[code] ?? places[code] ?? code;
  const best = r.candidates.find((c) => c.id === r.recommended);
  return (
    <div className="plans">
      {decision.status === 'DATA_INCOMPLETE' && (
        <div className="notice">
          <p>
            <strong>The engine cannot plan yet:</strong> these verified facts are missing. It never
            guesses them (NAV-AI-007) — verify them on Temple data, or plan by hand below.
          </p>
          <ul className="small">
            {r.gaps.slice(0, 12).map((g, i) => (
              <li key={i}>{g.message}</li>
            ))}
            {r.gaps.length > 12 && <li>…and {r.gaps.length - 12} more</li>}
          </ul>
        </div>
      )}
      {decision.status === 'NO_FEASIBLE_PLAN' && (
        <p className="notice">No option fits the verified timings for this date (EC-17).</p>
      )}
      {r.candidates.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Option</th>
              <th>Possible?</th>
              <th>Score</th>
              <th>Back by</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {r.candidates.map((c) => (
              <tr key={c.id}>
                <td>
                  {label(c)}
                  {c.id === r.recommended && <strong> · recommended</strong>}
                </td>
                <td>
                  {c.feasible ? 'Yes' : <span className="muted small">{c.failure?.message}</span>}
                </td>
                <td>{c.score ?? '—'}</td>
                <td>{c.feasible ? c.days.map((d) => d.end).join(' / ') : '—'}</td>
                <td>
                  {c.feasible && (
                    <Link
                      href={`/ops/requests/${reference}?decision=${decision.id}&use=${c.id}#proposal`}
                    >
                      Use this plan
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {r.reasons.length > 0 && (
        <ul className="small">
          {r.reasons.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      )}
      {best && (
        <>
          <h3>Timetable — {label(best)}</h3>
          {best.days.map((d) => (
            <div key={d.day}>
              {best.days.length > 1 && <h4>Day {d.day}</h4>}
              <ol className="small timetable">
                {d.events.map((e, i) => (
                  <li key={i}>
                    {e.kind === 'TRAVEL' && (
                      <span className="muted">
                        {e.depart}–{e.arrive} drive to {name(e.to)} ({e.minutes} min)
                      </span>
                    )}
                    {e.kind === 'VISIT' && (
                      <span>
                        <strong>
                          {e.enter}–{e.leave}
                        </strong>{' '}
                        {name(e.temple)}
                        {e.waitMinutes > 0 && (
                          <span className="muted"> (wait {e.waitMinutes} min)</span>
                        )}
                        {e.busy && <span className="muted"> · busy: {e.busy}</span>}
                      </span>
                    )}
                    {e.kind === 'MEAL' && (
                      <span>
                        {e.start}–{e.end} meal{e.late && ' (late)'}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </>
      )}
      {r.notes.length > 0 && (
        <ul className="small notice">
          {r.notes.map((n, i) => (
            <li key={i}>{n.message}</li>
          ))}
        </ul>
      )}
      <p className="small muted">
        Decision record {decision.id.slice(0, 8)} · settings {r.configVersion} · facts{' '}
        {r.factsVersion}
      </p>
    </div>
  );
}

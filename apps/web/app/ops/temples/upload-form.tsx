'use client';

import { useActionState } from 'react';
import { uploadWorkbook, type ImportState } from './actions';

const LABELS: Record<string, string> = {
  temples: 'temples',
  schedules: 'opening-hour rows',
  specialDays: 'special days',
  services: 'services',
  travelTimes: 'travel times',
  entryRules: 'entry rules',
  verified: 'rows marked Verified',
};

export function UploadForm() {
  const [state, action, pending] = useActionState(uploadWorkbook, {} as ImportState);
  const r = state.report;
  return (
    <form action={action} className="action-form">
      <label>
        Temple data workbook (.xlsx)
        <input type="file" name="workbook" accept=".xlsx" required />
      </label>
      <div className="row">
        <button type="submit" name="mode" value="check" className="secondary" disabled={pending}>
          {pending ? 'Working…' : 'Check only'}
        </button>
        <button type="submit" name="mode" value="import" disabled={pending}>
          {pending ? 'Working…' : 'Check and import'}
        </button>
      </div>
      <p className="muted small">
        Importing replaces opening hours, special days, travel times and entry rules with what is in
        the workbook. Nothing is written if the workbook has any error.
      </p>
      {state.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      {r && (
        <div className={r.applied ? 'gate good' : r.errors ? 'error' : 'notice'} role="status">
          <p>
            <strong>
              {r.applied
                ? `Imported ${state.fileName}.`
                : r.errors
                  ? `${state.fileName}: ${r.errors} problem${r.errors === 1 ? '' : 's'} to fix — nothing was imported.`
                  : `${state.fileName} looks good. Nothing written yet — use “Check and import”.`}
            </strong>
          </p>
          <p className="small">
            {Object.entries(r.counts)
              .map(([k, v]) => `${v} ${LABELS[k] ?? k}`)
              .join(' · ')}
            {r.warnings > 0 && ` · ${r.warnings} warning${r.warnings === 1 ? '' : 's'}`}
          </p>
          {r.issues.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Sheet</th>
                  <th>Row</th>
                  <th>Column</th>
                  <th>Problem</th>
                </tr>
              </thead>
              <tbody>
                {r.issues.map((i, n) => (
                  <tr key={n}>
                    <td>{i.sheet}</td>
                    <td>{i.row ?? '—'}</td>
                    <td>{i.column ?? '—'}</td>
                    <td>
                      {i.severity === 'warning' ? 'Warning: ' : ''}
                      {i.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </form>
  );
}

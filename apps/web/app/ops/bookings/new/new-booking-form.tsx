'use client';

import { ACCEPTANCE_CHANNELS, MODES, QUOTE_LINE_KINDS, SOURCE_CHANNELS } from '@navagraha/domain';
import { useState, useTransition } from 'react';
import {
  previewTotalPaise,
  toManualBookingPayload,
  type BookingFormState,
  type LineRow,
  type TravellerRow,
} from '@/lib/booking-form';
import { AGE_BANDS, RELATIONSHIPS, formatRupees, humanize, todayIso } from '@/lib/format';
import { createBooking, type CreateResult } from './actions';

interface Temple {
  code: string;
  commonName: string;
  graha: string | null;
  verification: { isVerified: boolean };
}

const blankTraveller = (): TravellerRow => ({
  fullName: '',
  ageBand: 'ADULT_18_59',
  relationshipToBooker: 'SELF',
  needsWheelchair: false,
  mobilityNotes: '',
});
const blankLine = (): LineRow => ({
  kind: 'VEHICLE',
  description: '',
  quantity: '1',
  unitPrice: '',
  tax: '',
});

export function NewBookingForm({ temples }: { temples: Temple[] }) {
  const [f, setF] = useState<BookingFormState>({
    bookerPhone: '',
    bookerName: '',
    channel: 'PHONE',
    sourceReference: '',
    startDate: todayIso(7),
    template: '1D',
    mode: 'BALANCED',
    pickupLocation: '',
    pickupTime: '',
    notes: '',
    travellers: [blankTraveller()],
    leadIndex: 0,
    stops: temples.map((t) => ({ templeCode: t.code, include: true, day: 1, plannedArrival: '' })),
    vehicleSeats: '',
    lines: [blankLine()],
    validUntil: todayIso(7),
    acceptedVia: 'PHONE',
    timingsChecked: false,
  });
  const [problems, setProblems] = useState<string[]>([]);
  const [result, setResult] = useState<CreateResult>({});
  const [pending, start] = useTransition();

  const set = <K extends keyof BookingFormState>(k: K, v: BookingFormState[K]) => {
    setF((s) => ({ ...s, [k]: v }));
    // Any edit clears earlier messages; they come back on the next submit if still true.
    setProblems([]);
    setResult({});
  };
  const setTraveller = (i: number, patch: Partial<TravellerRow>) =>
    set(
      'travellers',
      f.travellers.map((t, j) => (j === i ? { ...t, ...patch } : t)),
    );
  const setLine = (i: number, patch: Partial<LineRow>) =>
    set(
      'lines',
      f.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)),
    );
  const setStop = (i: number, patch: Partial<BookingFormState['stops'][number]>) =>
    set(
      'stops',
      f.stops.map((s, j) => (j === i ? { ...s, ...patch } : s)),
    );
  const move = (i: number, by: -1 | 1) => {
    const next = [...f.stops];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    set('stops', next);
  };
  const templeName = (code: string) => temples.find((t) => t.code === code)?.commonName ?? code;
  const total = previewTotalPaise(f.lines);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const built = toManualBookingPayload(f);
    if (!built.ok) {
      setProblems(built.errors);
      return;
    }
    setProblems([]);
    start(async () => setResult(await createBooking(built.payload)));
  }

  return (
    <form onSubmit={submit} className="booking-form">
      <fieldset>
        <legend>Booker</legend>
        <div className="row">
          <label>
            Mobile number
            <input
              type="tel"
              required
              value={f.bookerPhone}
              onChange={(e) => set('bookerPhone', e.target.value)}
            />
          </label>
          <label>
            Name
            <input value={f.bookerName} onChange={(e) => set('bookerName', e.target.value)} />
          </label>
          <label>
            Came in by
            <select value={f.channel} onChange={(e) => set('channel', e.target.value)}>
              {SOURCE_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {humanize(c)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reference / note
            <input
              value={f.sourceReference}
              onChange={(e) => set('sourceReference', e.target.value)}
            />
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Travellers</legend>
        <p className="muted small">
          Senior-Friendly planning switches on automatically when anyone is 60 or over.
        </p>
        {f.travellers.map((t, i) => (
          <div className="row" key={i}>
            <label>
              Name
              <input
                aria-label={`Traveller ${i + 1} name`}
                value={t.fullName}
                onChange={(e) => setTraveller(i, { fullName: e.target.value })}
              />
            </label>
            <label>
              Age
              <select
                value={t.ageBand}
                onChange={(e) => setTraveller(i, { ageBand: e.target.value })}
              >
                {Object.entries(AGE_BANDS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Relationship
              <select
                value={t.relationshipToBooker}
                onChange={(e) => setTraveller(i, { relationshipToBooker: e.target.value })}
              >
                {Object.entries(RELATIONSHIPS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={t.needsWheelchair}
                onChange={(e) => setTraveller(i, { needsWheelchair: e.target.checked })}
              />
              Wheelchair
            </label>
            <label className="check">
              <input
                type="radio"
                name="lead"
                checked={f.leadIndex === i}
                onChange={() => set('leadIndex', i)}
              />
              Lead
            </label>
            {f.travellers.length > 1 && (
              <button
                type="button"
                className="link"
                onClick={() => {
                  set(
                    'travellers',
                    f.travellers.filter((_, j) => j !== i),
                  );
                  set('leadIndex', 0);
                }}
              >
                Remove
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="secondary"
          onClick={() => set('travellers', [...f.travellers, blankTraveller()])}
        >
          Add traveller
        </button>
      </fieldset>

      <fieldset>
        <legend>Trip</legend>
        <div className="row">
          <label>
            Travel date
            <input
              type="date"
              required
              min={todayIso()}
              value={f.startDate}
              onChange={(e) => set('startDate', e.target.value)}
            />
          </label>
          <label>
            Length
            <select
              value={f.template}
              onChange={(e) => set('template', e.target.value as '1D' | '2D1N')}
            >
              <option value="1D">1 day</option>
              <option value="2D1N">2 days / 1 night</option>
            </select>
          </label>
          <label>
            Pace
            <select value={f.mode} onChange={(e) => set('mode', e.target.value)}>
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {humanize(m)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Vehicle seats
            <input
              type="number"
              min={1}
              value={f.vehicleSeats}
              onChange={(e) => set('vehicleSeats', e.target.value)}
            />
          </label>
        </div>
        <div className="row">
          <label className="grow">
            Pickup location
            <input
              value={f.pickupLocation}
              onChange={(e) => set('pickupLocation', e.target.value)}
            />
          </label>
          <label>
            Pickup time
            <input
              type="time"
              value={f.pickupTime}
              onChange={(e) => set('pickupTime', e.target.value)}
            />
          </label>
        </div>
        <label>
          Notes
          <textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </label>
      </fieldset>

      <fieldset>
        <legend>Temples, in visiting order</legend>
        <table>
          <tbody>
            {f.stops.map((s, i) => (
              <tr key={s.templeCode}>
                <td>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={s.include}
                      onChange={(e) => setStop(i, { include: e.target.checked })}
                    />
                    {templeName(s.templeCode)}
                  </label>
                </td>
                {f.template === '2D1N' && (
                  <td>
                    <select
                      aria-label={`${templeName(s.templeCode)} day`}
                      value={s.day}
                      onChange={(e) => setStop(i, { day: Number(e.target.value) })}
                    >
                      <option value={1}>Day 1</option>
                      <option value={2}>Day 2</option>
                    </select>
                  </td>
                )}
                <td>
                  <input
                    type="time"
                    aria-label={`${templeName(s.templeCode)} arrival`}
                    value={s.plannedArrival}
                    onChange={(e) => setStop(i, { plannedArrival: e.target.value })}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="link"
                    aria-label="Move up"
                    onClick={() => move(i, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="link"
                    aria-label="Move down"
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </fieldset>

      <fieldset>
        <legend>Quote</legend>
        <p className="muted small">
          Enter prices in rupees. Tax is entered per line until GST rules are set (D-07).
        </p>
        {f.lines.map((l, i) => (
          <div className="row" key={i}>
            <label>
              Type
              <select value={l.kind} onChange={(e) => setLine(i, { kind: e.target.value })}>
                {QUOTE_LINE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {humanize(k)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grow">
              Description
              <input
                aria-label={`Line ${i + 1} description`}
                value={l.description}
                onChange={(e) => setLine(i, { description: e.target.value })}
              />
            </label>
            <label>
              Qty
              <input
                className="short"
                inputMode="numeric"
                value={l.quantity}
                onChange={(e) => setLine(i, { quantity: e.target.value })}
              />
            </label>
            <label>
              Price (₹)
              <input
                aria-label={`Line ${i + 1} price`}
                inputMode="decimal"
                value={l.unitPrice}
                onChange={(e) => setLine(i, { unitPrice: e.target.value })}
              />
            </label>
            <label>
              Tax (₹)
              <input
                aria-label={`Line ${i + 1} tax`}
                inputMode="decimal"
                value={l.tax}
                onChange={(e) => setLine(i, { tax: e.target.value })}
              />
            </label>
            {f.lines.length > 1 && (
              <button
                type="button"
                className="link"
                onClick={() =>
                  set(
                    'lines',
                    f.lines.filter((_, j) => j !== i),
                  )
                }
              >
                Remove
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="secondary"
          onClick={() => set('lines', [...f.lines, blankLine()])}
        >
          Add line
        </button>
        <p>
          Estimated total: <strong>{total == null ? '—' : formatRupees(total)}</strong>{' '}
          <span className="muted small">(the system calculates the final total)</span>
        </p>
        <div className="row">
          <label>
            Quote valid until
            <input
              type="date"
              required
              min={todayIso()}
              value={f.validUntil}
              onChange={(e) => set('validUntil', e.target.value)}
            />
          </label>
          <label>
            Customer accepted via
            <select value={f.acceptedVia} onChange={(e) => set('acceptedVia', e.target.value)}>
              {ACCEPTANCE_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {humanize(c)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>

      <label className="check signoff">
        <input
          type="checkbox"
          checked={f.timingsChecked}
          onChange={(e) => set('timingsChecked', e.target.checked)}
        />
        I have checked temple opening hours and travel times for this plan by hand. (The planning
        engine does not check concierge plans yet — D-20.)
      </label>

      {(problems.length > 0 || result.error) && (
        <div role="alert" className="error">
          {problems.length > 0 ? (
            <ul>
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : (
            <>
              <p>{result.error}</p>
              {result.findings && (
                <ul>
                  {result.findings.map((x, i) => (
                    <li key={i}>
                      {x.stop ? `Temple ${x.stop}: ` : ''}
                      {x.message}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
      <button type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Create booking'}
      </button>
    </form>
  );
}

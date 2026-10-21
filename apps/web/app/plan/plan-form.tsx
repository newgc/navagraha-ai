'use client';

import { useState, useTransition } from 'react';
import { AGE_BANDS, RELATIONSHIPS, todayIso } from '@/lib/format';
import { sendPlanCode, submitPlan, verifyAndSubmit, type PlanResult } from './actions';

interface Traveller {
  fullName: string;
  ageBand: string;
  relationshipToBooker: string;
  needsWheelchair: boolean;
}

const PURPOSES: Record<string, string> = {
  ALL_NINE: 'Darshan at all nine temples',
  PARIHARAM: 'Pariharam / remedy for a particular graha',
  PEACEFUL_DARSHAN: 'Peaceful darshan, unhurried',
  FAMILY: 'Family pilgrimage',
  OTHER: 'Something else (tell us below)',
};

const blank = (relationshipToBooker = 'SELF'): Traveller => ({
  fullName: '',
  ageBand: 'ADULT_18_59',
  relationshipToBooker,
  needsWheelchair: false,
});

/** FS §8.1 TripRequest, collected as a form until the conversational planner exists (P5). */
export function PlanForm({
  signedIn,
  name: initialName,
  phone: initialPhone,
}: {
  signedIn: boolean;
  name: string;
  phone: string;
}) {
  const [f, setF] = useState({
    startDate: todayIso(14),
    flexibleDates: false,
    days: 'RECOMMEND',
    pickupLocation: '',
    pickupTime: '',
    purpose: 'ALL_NINE',
    hotelRequired: false,
    notes: '',
    name: initialName,
    email: '',
    phone: initialPhone,
    travellers: [{ ...blank(), fullName: initialName }],
  });
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState<PlanResult['codeSent']>();
  const [problems, setProblems] = useState<string[]>([]);
  const [pending, start] = useTransition();

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => {
    setF((s) => ({ ...s, [k]: v }));
    setProblems([]);
  };
  const setTraveller = (i: number, patch: Partial<Traveller>) =>
    set(
      'travellers',
      f.travellers.map((t, j) => (j === i ? { ...t, ...patch } : t)),
    );

  function payload(): Record<string, unknown> | null {
    const errors: string[] = [];
    if (!f.startDate || f.startDate <= todayIso(0))
      errors.push('Choose a travel date from tomorrow');
    if (!f.pickupLocation.trim()) errors.push('Tell us where to pick you up (city or area)');
    if (!f.name.trim()) errors.push('Enter your name');
    if (!signedIn && !f.phone.trim()) errors.push('Enter your mobile number');
    f.travellers.forEach((t, i) => {
      if (!t.fullName.trim()) errors.push(`Traveller ${i + 1}: enter a name`);
    });
    setProblems(errors);
    if (errors.length) return null;
    return {
      startDate: f.startDate,
      flexibleDates: f.flexibleDates || undefined,
      days: f.days,
      pickup: { location: f.pickupLocation.trim(), time: f.pickupTime || undefined },
      travellers: f.travellers.map((t) => ({
        fullName: t.fullName.trim(),
        ageBand: t.ageBand,
        relationshipToBooker: t.relationshipToBooker,
        needsWheelchair: t.needsWheelchair || undefined,
      })),
      purpose: f.purpose,
      hotelRequired: f.hotelRequired || undefined,
      notes: f.notes.trim() || undefined,
      contact: { name: f.name.trim(), email: f.email.trim() || undefined },
    };
  }

  const show = (r: PlanResult) => {
    if (r.error) setProblems([r.error]);
    if (r.codeSent) setCodeSent(r.codeSent);
  };

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = payload();
    if (!body) return;
    start(async () => {
      if (signedIn) show(await submitPlan(body));
      else if (!codeSent) show(await sendPlanCode(f.phone));
      else show(await verifyAndSubmit(code, body));
    });
  }

  return (
    <form onSubmit={onSubmit} className="stack plan-form">
      <fieldset>
        <legend>Your trip</legend>
        <label>
          Travel date
          <input
            type="date"
            value={f.startDate}
            min={todayIso(1)}
            onChange={(e) => set('startDate', e.target.value)}
            required
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={f.flexibleDates}
            onChange={(e) => set('flexibleDates', e.target.checked)}
          />{' '}
          My dates are flexible
        </label>
        <label>
          How long
          <select value={f.days} onChange={(e) => set('days', e.target.value)}>
            <option value="RECOMMEND">Recommend what suits us</option>
            <option value="1">One day</option>
            <option value="2">Two days, one night</option>
          </select>
        </label>
        <label>
          Pickup (city or area)
          <input
            value={f.pickupLocation}
            onChange={(e) => set('pickupLocation', e.target.value)}
            placeholder="e.g. Kumbakonam railway station, or Chennai"
            required
          />
        </label>
        <label>
          Preferred pickup time (optional)
          <input
            type="time"
            value={f.pickupTime}
            onChange={(e) => set('pickupTime', e.target.value)}
          />
        </label>
        <label>
          Purpose
          <select value={f.purpose} onChange={(e) => set('purpose', e.target.value)}>
            {Object.entries(PURPOSES).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={f.hotelRequired}
            onChange={(e) => set('hotelRequired', e.target.checked)}
          />{' '}
          We need a hotel for the night
        </label>
      </fieldset>

      <fieldset>
        <legend>Who is travelling</legend>
        {f.travellers.map((t, i) => (
          <div key={i} className="traveller">
            <label>
              Name
              <input
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
              Relation to you
              <select
                value={t.relationshipToBooker}
                onChange={(e) => setTraveller(i, { relationshipToBooker: e.target.value })}
              >
                {Object.entries(RELATIONSHIPS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {v === 'SELF' ? 'Me' : l}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={t.needsWheelchair}
                onChange={(e) => setTraveller(i, { needsWheelchair: e.target.checked })}
              />{' '}
              Needs a wheelchair
            </label>
            {f.travellers.length > 1 && (
              <button
                type="button"
                className="link"
                onClick={() =>
                  set(
                    'travellers',
                    f.travellers.filter((_, j) => j !== i),
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
          onClick={() => set('travellers', [...f.travellers, blank('PARENT')])}
        >
          Add a traveller
        </button>
      </fieldset>

      <label>
        Anything we should know (optional)
        <textarea
          value={f.notes}
          onChange={(e) => set('notes', e.target.value)}
          rows={3}
          placeholder="e.g. mother walks slowly, vegetarian meals, a pooja you would like"
        />
      </label>

      <fieldset>
        <legend>Your details</legend>
        <label>
          Your name
          <input value={f.name} onChange={(e) => set('name', e.target.value)} required />
        </label>
        <label>
          Email (optional)
          <input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
        </label>
        {signedIn ? (
          <p className="small muted">We will reply on WhatsApp to {f.phone}.</p>
        ) : (
          <label>
            Mobile number (WhatsApp)
            <input
              type="tel"
              autoComplete="tel"
              value={f.phone}
              onChange={(e) => {
                set('phone', e.target.value);
                setCodeSent(undefined);
              }}
              placeholder="98765 43210"
              disabled={!!codeSent}
            />
          </label>
        )}
        {codeSent && (
          <label>
            {codeSent.channel === 'whatsapp'
              ? 'Enter the 6-digit code we sent you on WhatsApp'
              : 'Enter the 6-digit code we sent you'}
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              autoFocus
            />
          </label>
        )}
      </fieldset>

      {problems.length > 0 && (
        <div role="alert" className="error">
          {problems.map((p) => (
            <div key={p}>{p}</div>
          ))}
        </div>
      )}
      <button type="submit" disabled={pending}>
        {pending
          ? 'Sending…'
          : signedIn || codeSent
            ? 'Send my request'
            : 'Verify my number and send'}
      </button>
      {!signedIn && !codeSent && (
        <p className="small muted">
          We send a 6-digit code to your WhatsApp to confirm your number.
        </p>
      )}
    </form>
  );
}

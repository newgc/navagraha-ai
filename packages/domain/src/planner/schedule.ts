import type { SessionFact, SpecialDayFact, TempleFacts } from './facts.js';

/** Minutes since midnight for HH:MM or HH:MM:SS. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
}

export function toHhmm(minutes: number): string {
  const m = Math.round(minutes);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function weekdayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()]!;
}

/** Day types tied to the lunar calendar: the engine cannot tell when they fall (no panchang). */
export const LUNAR_DAY_TYPES = ['Tamil month first day', 'Amavasai', 'Pournami', 'Pradosham'];

export interface Window {
  open: number;
  /** Latest time to enter. */
  lastEntry: number;
  close: number;
}

export interface DaySchedule {
  windows: Window[];
  closed: boolean;
  /** Crowd effect from a special day: use busy visit minutes plus this extra wait. */
  busy: { extraWaitMinutes: number; reason: string } | null;
  notes: { code: string; message: string }[];
}

function specialApplies(s: SpecialDayFact, date: string) {
  if (s.recursYearly) {
    const md = date.slice(5);
    const from = s.fromDate.slice(5);
    const to = s.toDate.slice(5);
    return from <= to ? md >= from && md <= to : md >= from || md <= to;
  }
  return date >= s.fromDate && date <= s.toDate;
}

function sessionWindow(s: SessionFact): Window {
  const close = toMinutes(s.closesAt);
  return {
    open: toMinutes(s.opensAt),
    lastEntry: s.lastEntryAt ? toMinutes(s.lastEntryAt) : close,
    close,
  };
}

/**
 * Opening windows of a temple on a date. Most specific day type wins (a "Sunday" row
 * replaces "Every day" for Sundays); special days close, re-time or crowd the temple.
 */
export function scheduleFor(t: TempleFacts, date: string): DaySchedule {
  const notes: DaySchedule['notes'] = [];
  const weekday = weekdayOf(date);
  const valid = t.sessions.filter((s) => s.validFrom <= date && (!s.validTo || s.validTo >= date));
  if (valid.some((s) => LUNAR_DAY_TYPES.includes(s.dayType))) {
    notes.push({
      code: 'LUNAR_DAY_UNCHECKED',
      message: `${t.name} has different timings on lunar days (Amavasai, Pradosham…); check whether ${date} is one`,
    });
  }
  const group =
    weekday === 'Saturday' || weekday === 'Sunday' ? 'Weekends (Sat-Sun)' : 'Weekdays (Mon-Fri)';
  const byType = (type: string) => valid.filter((s) => s.dayType === type);
  const chosen = [weekday, group, 'Every day'].map(byType).find((rows) => rows.length) ?? [];
  let windows = chosen.map(sessionWindow).sort((a, b) => a.open - b.open);

  let closed = false;
  let busy = null as DaySchedule['busy'];
  for (const s of t.specialDays.filter((x) => specialApplies(x, date))) {
    const effect = s.effect.toLowerCase();
    if (effect === 'closed') {
      closed = true;
      notes.push({ code: 'SPECIAL_CLOSED', message: `${t.name} is closed on ${date} (${s.name})` });
    } else if (effect === 'changed timings' || effect === 'extended timings') {
      if (s.changedOpensAt && s.changedClosesAt) {
        const close = toMinutes(s.changedClosesAt);
        windows = [{ open: toMinutes(s.changedOpensAt), lastEntry: close, close }];
        notes.push({ code: 'SPECIAL_TIMINGS', message: `${t.name}: ${s.name} timings apply` });
      } else {
        notes.push({
          code: 'SPECIAL_TIMINGS_UNKNOWN',
          message: `${t.name}: ${s.name} changes the timings, but the new timings are not recorded`,
        });
      }
    } else if (effect.includes('crowd')) {
      busy = {
        extraWaitMinutes: Math.max(busy?.extraWaitMinutes ?? 0, s.expectedExtraWaitMinutes ?? 0),
        reason: s.name,
      };
    } else {
      notes.push({ code: 'SPECIAL_DAY', message: `${t.name}: ${s.name} (${s.effect})` });
    }
  }
  return { windows: closed ? [] : windows, closed, busy, notes };
}

import type { PlanningMode } from '../catalog.js';
import type { EngineConfig } from './config.js';
import { travelKey, type PlanningFacts, type TempleFacts } from './facts.js';
import { scheduleFor, toHhmm, toMinutes, type DaySchedule } from './schedule.js';

export interface Finding {
  code: string;
  message: string;
  temple?: string;
}

export type DayEvent =
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

export interface DayPlan {
  day: number;
  date: string;
  temples: string[];
  events: DayEvent[];
  start: string;
  end: string;
  travelMinutes: number;
  waitMinutes: number;
  visitMinutes: number;
  /** Smallest margin before a last entry or the latest return, minutes (reliability). */
  slackMinutes: number;
}

export interface DayContext {
  day: number;
  date: string;
  startAt: number;
  fromPlace: string;
  toPlace: string;
  mode: PlanningMode;
  senior: boolean;
}

/** Running state while a day is built stop by stop. */
export interface State {
  t: number;
  at: string;
  mealTaken: boolean;
  events: DayEvent[];
  temples: string[];
  /** Bit per visited temple (index in the facts), for cheap dominance keys. */
  mask: number;
  travel: number;
  wait: number;
  visit: number;
  slack: number;
}

/**
 * Simulates and searches single days for one set of facts and config. Facts must be
 * complete for the temples involved (checked by `gapsFor` first).
 */
export class DayPlanner {
  private readonly temples: Map<string, TempleFacts>;
  private readonly bit: Map<string, number>;
  private readonly schedules = new Map<string, DaySchedule>();
  readonly notes = new Map<string, Finding>();

  constructor(
    private readonly facts: PlanningFacts,
    private readonly config: EngineConfig,
  ) {
    this.temples = new Map(facts.temples.map((t) => [t.code, t]));
    this.bit = new Map(facts.temples.map((t, i) => [t.code, 1 << i]));
  }

  temple(code: string) {
    return this.temples.get(code)!;
  }

  schedule(code: string, date: string) {
    const key = `${code}@${date}`;
    let s = this.schedules.get(key);
    if (!s) {
      s = scheduleFor(this.temple(code), date);
      this.schedules.set(key, s);
      for (const n of s.notes) this.notes.set(`${n.code}:${code}:${date}`, { ...n, temple: code });
    }
    return s;
  }

  travel(from: string, to: string): number | undefined {
    return this.facts.travelMinutes[travelKey(from, to)];
  }

  private leg(ctx: DayContext, from: string, to: string) {
    return Math.ceil(this.travel(from, to)! * this.config.modes[ctx.mode].travelBuffer);
  }

  private dwell(ctx: DayContext, t: TempleFacts, busy: DaySchedule['busy']) {
    const base = (busy ? (t.visitMinutesBusy ?? t.visitMinutesNormal) : t.visitMinutesNormal)!;
    const m = this.config.modes[ctx.mode].dwellMultiplier;
    const s = ctx.senior ? this.config.senior.dwellMultiplier : 1;
    return Math.ceil(base * m * s) + (busy?.extraWaitMinutes ?? 0);
  }

  private rest(ctx: DayContext) {
    return (
      this.config.modes[ctx.mode].restMinutes +
      (ctx.senior ? this.config.senior.extraRestMinutes : 0)
    );
  }

  start(ctx: DayContext): State {
    return {
      t: ctx.startAt,
      at: ctx.fromPlace,
      mealTaken: false,
      events: [],
      temples: [],
      mask: 0,
      travel: 0,
      wait: 0,
      visit: 0,
      slack: Number.POSITIVE_INFINITY,
    };
  }

  /** Travel to the temple and visit it, or say why that is not possible. */
  step(ctx: DayContext, s: State, code: string): State | Finding {
    const temple = this.temple(code);
    const meal = this.config.meal;
    const mealFrom = toMinutes(meal.from);
    const mealTo = toMinutes(meal.to);
    let t = s.t;
    const events = [...s.events];
    let mealTaken = s.mealTaken;

    if (ctx.senior && s.temples.length >= this.config.senior.maxTemplesPerDay) {
      return {
        code: 'TOO_MANY_TEMPLES_FOR_SENIORS',
        message: `More than ${this.config.senior.maxTemplesPerDay} temples in a day is too much with senior travellers`,
      };
    }
    // Missed the lunch window: eat now, before driving on.
    if (!mealTaken && t > mealTo) {
      events.push({ kind: 'MEAL', start: toHhmm(t), end: toHhmm(t + meal.minutes), late: true });
      t += meal.minutes;
      mealTaken = true;
    }

    const minutes = this.leg(ctx, s.at, temple.placeCode!);
    events.push({
      kind: 'TRAVEL',
      from: s.at,
      to: temple.placeCode!,
      depart: toHhmm(t),
      arrive: toHhmm(t + minutes),
      minutes,
    });
    t += minutes;

    const sched = this.schedule(code, ctx.date);
    if (sched.closed) {
      return {
        code: 'TEMPLE_CLOSED',
        message: `${temple.name} is closed on ${ctx.date}`,
        temple: code,
      };
    }
    const dwell = this.dwell(ctx, temple, sched.busy);
    const w = sched.windows.find((x) => {
      const enter = Math.max(t, x.open);
      return enter <= x.lastEntry && enter + dwell <= x.close;
    });
    if (!w) {
      const last = sched.windows.at(-1);
      return {
        code: 'ARRIVES_AFTER_CLOSING',
        message: last
          ? `${temple.name}: arriving at ${toHhmm(t)} leaves no time for a ${dwell}-minute visit before it closes (${toHhmm(last.close)})`
          : `${temple.name} has no opening on ${ctx.date}`,
        temple: code,
      };
    }
    const enter = Math.max(t, w.open);
    const wait = enter - t;
    // Lunch while waiting for the temple to open, when the wait allows it.
    if (!mealTaken && wait >= meal.minutes) {
      const mealStart = Math.max(t, mealFrom);
      if (mealStart <= mealTo && mealStart + meal.minutes <= enter) {
        events.push({
          kind: 'MEAL',
          start: toHhmm(mealStart),
          end: toHhmm(mealStart + meal.minutes),
          late: false,
        });
        mealTaken = true;
      }
    }
    events.push({
      kind: 'VISIT',
      temple: code,
      arrive: toHhmm(t),
      enter: toHhmm(enter),
      leave: toHhmm(enter + dwell),
      waitMinutes: wait,
      busy: sched.busy?.reason ?? null,
    });
    const slack = Math.min(s.slack, w.lastEntry - enter);
    t = enter + dwell;
    if (!mealTaken && t >= mealFrom && t <= mealTo) {
      events.push({ kind: 'MEAL', start: toHhmm(t), end: toHhmm(t + meal.minutes), late: false });
      t += meal.minutes;
      mealTaken = true;
    }
    t += this.rest(ctx);
    return {
      t,
      at: temple.placeCode!,
      mealTaken,
      events,
      temples: [...s.temples, code],
      mask: s.mask | this.bit.get(code)!,
      travel: s.travel + minutes,
      wait: s.wait + wait,
      visit: s.visit + dwell,
      slack,
    };
  }

  /** Drive to the drop point / hotel; fails when that is after the latest return. */
  finish(ctx: DayContext, s: State): DayPlan | Finding {
    const minutes = this.leg(ctx, s.at, ctx.toPlace);
    const end = s.t + minutes;
    const latest = toMinutes(this.config.latestReturn);
    if (end > latest) {
      return {
        code: 'RETURNS_TOO_LATE',
        message: `Back at ${this.facts.places[ctx.toPlace] ?? ctx.toPlace} only at ${toHhmm(end)}, after ${this.config.latestReturn}`,
      };
    }
    return {
      day: ctx.day,
      date: ctx.date,
      temples: s.temples,
      events: [
        ...s.events,
        {
          kind: 'TRAVEL',
          from: s.at,
          to: ctx.toPlace,
          depart: toHhmm(s.t),
          arrive: toHhmm(end),
          minutes,
        },
      ],
      start: toHhmm(ctx.startAt),
      end: toHhmm(end),
      travelMinutes: s.travel + minutes,
      waitMinutes: s.wait,
      visitMinutes: s.visit,
      slackMinutes: Math.min(s.slack, latest - end),
    };
  }

  /** The given order exactly as given (evaluating a hand-made itinerary). */
  simulate(ctx: DayContext, order: string[]): DayPlan | Finding {
    let s = this.start(ctx);
    for (const code of order) {
      const next = this.step(ctx, s, code);
      if ('code' in next) return next;
      s = next;
    }
    return this.finish(ctx, s);
  }

  /**
   * The order of these temples that gets back earliest (less strain, more margin). Depth-first
   * over orders, pruned as soon as a temple cannot be reached in time. Returns the best plan,
   * or the failure from the attempt that got furthest (to explain why).
   */
  best(ctx: DayContext, codes: string[]): DayPlan | Finding {
    const memoKey = `${ctx.day}|${ctx.date}|${ctx.startAt}|${ctx.fromPlace}|${ctx.toPlace}|${ctx.mode}|${ctx.senior}|${[...codes].sort().join(',')}`;
    const memo = this.memo.get(memoKey);
    if (memo) return memo;
    const result = this.search(ctx, codes);
    this.memo.set(memoKey, result);
    return result;
  }

  private readonly memo = new Map<string, DayPlan | Finding>();

  private search(ctx: DayContext, codes: string[]): DayPlan | Finding {
    let best: DayPlan | null = null;
    let furthest: { depth: number; finding: Finding } = {
      depth: -1,
      finding: { code: 'NO_ORDER', message: 'No order of these temples fits the day' },
    };
    const endOf = (p: DayPlan) => toMinutes(p.end);
    // Dominance (time windows with waiting): reaching the same place, having visited the same
    // temples and in the same meal state, later than before can never end earlier.
    const earliest = new Map<string, number>();
    const visit = (s: State, rest: string[]) => {
      const key = `${s.mask}|${s.at}|${s.mealTaken ? 1 : 0}`;
      const seen = earliest.get(key);
      if (seen !== undefined && seen <= s.t) return;
      earliest.set(key, s.t);
      if (best) {
        const home = this.travel(s.at, ctx.toPlace) ?? 0;
        if (s.t + home >= endOf(best)) return;
      }
      if (rest.length === 0) {
        const done = this.finish(ctx, s);
        if ('code' in done) {
          if (s.temples.length > furthest.depth)
            furthest = { depth: s.temples.length, finding: done };
          return;
        }
        if (
          !best ||
          endOf(done) < endOf(best) ||
          (endOf(done) === endOf(best) && done.travelMinutes < best.travelMinutes)
        ) {
          best = done;
        }
        return;
      }
      for (const code of rest) {
        const next = this.step(ctx, s, code);
        if ('code' in next) {
          if (s.temples.length > furthest.depth)
            furthest = { depth: s.temples.length, finding: next };
          continue;
        }
        visit(
          next,
          rest.filter((c) => c !== code),
        );
      }
    };
    visit(this.start(ctx), codes);
    return best ?? furthest.finding;
  }
}

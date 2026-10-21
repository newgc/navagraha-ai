import type { PlanningMode, TemplateCode, TripPurpose } from '../catalog.js';
import { DEFAULT_ENGINE_CONFIG, type EngineConfig } from './config.js';
import { DayPlanner, type DayContext, type DayPlan, type Finding } from './day.js';
import { travelKey, type PlanningFacts } from './facts.js';
import { toMinutes } from './schedule.js';

export interface PlanTraveller {
  ageBand: string;
  needsWheelchair?: boolean;
}

export interface PlanRequest {
  startDate: string;
  /** Pickup time (HH:MM); the config's default start otherwise. */
  startTime?: string | null;
  /** Travel-matrix place the day starts from (HUB-KUM, ORG-MAA…). */
  fromPlace: string;
  /** Where the trip ends; the start place by default. */
  toPlace?: string | null;
  /** Temples to visit (codes); usually all nine. */
  temples: string[];
  travellers: PlanTraveller[];
  purpose: TripPurpose;
  /** What the customer asked for (FS §8.1). */
  days: '1' | '2' | 'RECOMMEND';
}

export type Factor =
  'purposeFit' | 'comfort' | 'travelEfficiency' | 'budget' | 'reliability' | 'preferenceFit';

export interface Candidate {
  id: string;
  template: TemplateCode;
  mode: PlanningMode;
  feasible: boolean;
  days: DayPlan[];
  /** Why it is not possible (the constraint that failed in the attempt that got furthest). */
  failure: Finding | null;
  factors: Record<Factor, number> | null;
  score: number | null;
}

export interface PlanResult {
  status: 'OK' | 'NO_FEASIBLE_PLAN' | 'DATA_INCOMPLETE';
  senior: boolean;
  candidates: Candidate[];
  recommended: string | null;
  /** NAV-AI-006: why the recommended option is preferred, from the factors. */
  reasons: string[];
  /** Facts that are missing or not verified; nothing is planned until they are. */
  gaps: Finding[];
  /** Things to check by hand (lunar-day timings, festivals, wheelchair access…). */
  notes: Finding[];
  configVersion: string;
  factsVersion: string;
}

/** The FS §9.1 candidates the engine evaluates (3D/2N is P1). */
export const PLAN_OPTIONS: { template: TemplateCode; mode: PlanningMode }[] = [
  { template: '1D', mode: 'FAST' },
  { template: '1D', mode: 'BALANCED' },
  { template: '1D', mode: 'RELAXED' },
  { template: '2D1N', mode: 'BALANCED' },
  { template: '2D1N', mode: 'RELAXED' },
];

const isSenior = (t: PlanTraveller) => t.ageBand.startsWith('SENIOR');

function addDays(date: string, n: number) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}

/**
 * Facts the plan cannot do without (NAV-AI-007: never guessed): verified visit minutes,
 * verified opening hours and a travel-matrix place for each temple, and verified travel
 * times between every pair the search may use.
 */
export function gapsFor(facts: PlanningFacts, temples: string[], places: string[]): Finding[] {
  const gaps: Finding[] = [];
  const byCode = new Map(facts.temples.map((t) => [t.code, t]));
  const nodes: string[] = [...places];
  for (const code of temples) {
    const t = byCode.get(code);
    if (!t) {
      gaps.push({ code: 'TEMPLE_UNKNOWN', message: `${code} is not a known temple`, temple: code });
      continue;
    }
    if (t.visitMinutesNormal == null) {
      gaps.push({
        code: 'VISIT_MINUTES_MISSING',
        message: `${t.name}: verified visit time is missing`,
        temple: code,
      });
    }
    if (t.sessions.length === 0) {
      gaps.push({
        code: 'OPENING_HOURS_MISSING',
        message: `${t.name}: verified opening hours are missing`,
        temple: code,
      });
    }
    if (!t.placeCode) {
      gaps.push({
        code: 'PLACE_MISSING',
        message: `${t.name} is not in the travel-time matrix`,
        temple: code,
      });
    } else nodes.push(t.placeCode);
  }
  const missing = new Set<string>();
  for (const a of nodes) {
    for (const b of nodes) {
      if (a === b || (places.includes(a) && places.includes(b))) continue;
      if (facts.travelMinutes[travelKey(a, b)] == null) {
        const pair = [a, b].sort().join(' – ');
        if (!missing.has(pair)) {
          missing.add(pair);
          const name = (p: string) => facts.places[p] ?? p;
          gaps.push({
            code: 'TRAVEL_TIME_MISSING',
            message: `Verified travel time ${name(a)} → ${name(b)} is missing`,
          });
        }
      }
    }
  }
  return gaps;
}

function dayContexts(
  req: PlanRequest,
  template: TemplateCode,
  mode: PlanningMode,
  senior: boolean,
  facts: PlanningFacts,
  config: EngineConfig,
): DayContext[] {
  const startAt = toMinutes(req.startTime ?? config.defaultStart);
  const to = req.toPlace ?? req.fromPlace;
  if (template === '1D') {
    return [
      { day: 1, date: req.startDate, startAt, fromPlace: req.fromPlace, toPlace: to, mode, senior },
    ];
  }
  return [
    {
      day: 1,
      date: req.startDate,
      startAt,
      fromPlace: req.fromPlace,
      toPlace: facts.overnightPlace,
      mode,
      senior,
    },
    {
      day: 2,
      date: addDays(req.startDate, 1),
      startAt: toMinutes(config.defaultStart),
      fromPlace: facts.overnightPlace,
      toPlace: to,
      mode,
      senior,
    },
  ];
}

/**
 * Best two-day plan: one search over day 1 in which, after any temple, day 1 may end at the
 * hotel and day 2 takes the rest (best order of the remainder, remembered per set).
 * Minimises the total time out on both days.
 */
function bestTwoDays(planner: DayPlanner, ctx: DayContext[], temples: string[]) {
  const [d1, d2] = ctx as [DayContext, DayContext];
  let best: { days: DayPlan[]; total: number } | null = null;
  let failure: Finding | null = null;
  const length = (d: DayPlan) => toMinutes(d.end) - toMinutes(d.start);
  const earliest = new Map<string, number>();
  type S = ReturnType<DayPlanner['start']>;
  const go = (s: S, rest: string[]) => {
    const key = `${s.mask}|${s.at}|${s.mealTaken ? 1 : 0}`;
    const seen = earliest.get(key);
    if (seen !== undefined && seen <= s.t) return;
    earliest.set(key, s.t);
    if (best && s.t - d1.startAt >= best.total) return;

    if (s.temples.length > 0 && rest.length > 0) {
      const day1 = planner.finish(d1, s);
      if ('code' in day1) failure ??= day1;
      else {
        const day2 = planner.best(d2, rest);
        if ('code' in day2) failure ??= day2;
        else {
          const total = length(day1) + length(day2);
          if (!best || total < best.total) best = { days: [day1, day2], total };
        }
      }
    }
    for (const code of rest) {
      const next = planner.step(d1, s, code);
      if ('code' in next) {
        failure ??= next;
        continue;
      }
      go(
        next,
        rest.filter((c) => c !== code),
      );
    }
  };
  go(planner.start(d1), temples);
  const found = best as { days: DayPlan[] } | null;
  return (
    found?.days ?? failure ?? { code: 'NO_SPLIT', message: 'No split of the temples fits two days' }
  );
}

function score(c: Candidate, req: PlanRequest, senior: boolean): Record<Factor, number> {
  const minutes = (d: DayPlan) => toMinutes(d.end) - toMinutes(d.start);
  const longest = Math.max(...c.days.map(minutes));
  const visit = c.days.reduce((s, d) => s + d.visitMinutes, 0);
  const travel = c.days.reduce((s, d) => s + d.travelMinutes, 0);
  const wait = c.days.reduce((s, d) => s + d.waitMinutes, 0);
  const slack = Math.min(...c.days.map((d) => d.slackMinutes));
  const planned = c.days.reduce((s, d) => s + d.temples.length, 0);
  const comfortBase = { FAST: 0.4, BALANCED: 0.7, RELAXED: 1 }[c.mode];
  const longDay = longest > 12 * 60 ? 0.3 : longest > 10 * 60 ? 0.15 : 0;
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  const peaceful =
    req.purpose === 'PEACEFUL_DARSHAN' ? { FAST: 0.5, BALANCED: 0.8, RELAXED: 1 }[c.mode] : 1;
  return {
    purposeFit: clamp((planned / req.temples.length) * peaceful),
    comfort: clamp(
      comfortBase - longDay * (senior ? 2 : 1) + (senior && c.template === '2D1N' ? 0.2 : 0),
    ),
    travelEfficiency: clamp(visit / Math.max(1, visit + travel + wait)),
    // Indicative only: an extra night costs more. Real prices come from the rate card (D-08).
    budget: c.template === '1D' ? 1 : 0.6,
    reliability: clamp(slack / 60),
    preferenceFit:
      req.days === 'RECOMMEND' ? 1 : (req.days === '1') === (c.template === '1D') ? 1 : 0.3,
  };
}

const LABEL: Record<Factor, string> = {
  purposeFit: 'fits the purpose of the trip',
  comfort: 'more comfortable',
  travelEfficiency: 'less time on the road',
  budget: 'costs less (no overnight stay)',
  reliability: 'more margin before temples close',
  preferenceFit: 'matches what was asked for',
};

function describe(c: Candidate) {
  return `${c.template === '1D' ? '1 day' : '2 days, 1 night'}, ${c.mode.toLowerCase()}`;
}

/** FS §9 — feasibility for every template × mode, then a scored, explained recommendation. */
export function planTrip(
  req: PlanRequest,
  facts: PlanningFacts,
  config: EngineConfig = DEFAULT_ENGINE_CONFIG,
): PlanResult {
  const senior = req.travellers.some(isSenior);
  const base = {
    senior,
    configVersion: config.version,
    factsVersion: facts.version,
  };
  const places = [req.fromPlace, req.toPlace ?? req.fromPlace, facts.overnightPlace];
  const gaps = gapsFor(facts, req.temples, [...new Set(places)]);
  if (gaps.length) {
    return {
      ...base,
      status: 'DATA_INCOMPLETE',
      candidates: [],
      recommended: null,
      reasons: [],
      gaps,
      notes: [],
    };
  }

  const planner = new DayPlanner(facts, config);
  const candidates: Candidate[] = PLAN_OPTIONS.map(({ template, mode }) => {
    const ctx = dayContexts(req, template, mode, senior, facts, config);
    const result =
      template === '1D'
        ? planner.best(ctx[0]!, req.temples)
        : bestTwoDays(planner, ctx, req.temples);
    const days = Array.isArray(result) ? result : 'code' in result ? null : [result];
    const c: Candidate = {
      id: `${template}-${mode}`,
      template,
      mode,
      feasible: !!days,
      days: days ?? [],
      failure: days ? null : (result as Finding),
      factors: null,
      score: null,
    };
    if (days) {
      c.factors = score(c, req, senior);
      c.score = Math.round(
        (Object.keys(c.factors) as Factor[]).reduce(
          (s, f) => s + c.factors![f] * config.weights[f],
          0,
        ),
      );
    }
    return c;
  });

  const notes = wheelchairNotes(req, facts);
  for (const n of planner.notes.values()) notes.push(n);
  const feasible = candidates.filter((c) => c.feasible).sort((a, b) => b.score! - a.score!);
  if (!feasible.length) {
    return {
      ...base,
      status: 'NO_FEASIBLE_PLAN',
      candidates,
      recommended: null,
      reasons: [],
      gaps: [],
      notes,
    };
  }
  const [top, next] = feasible as [Candidate, Candidate | undefined];
  const reasons = [`${describe(top)} scores highest (${top.score}/100).`];
  if (next) {
    const better = (Object.keys(top.factors!) as Factor[])
      .filter((f) => top.factors![f] - next.factors![f] > 0.05)
      .sort((a, b) => config.weights[b] - config.weights[a])
      .slice(0, 3);
    if (better.length) {
      reasons.push(`Compared with ${describe(next)}: ${better.map((f) => LABEL[f]).join(', ')}.`);
    }
  }
  if (senior)
    reasons.push('Senior-friendly pacing applied: longer visits, more rest, fewer temples a day.');
  for (const c of candidates.filter((x) => !x.feasible)) {
    reasons.push(`${describe(c)} is not possible: ${c.failure!.message}.`);
  }
  return { ...base, status: 'OK', candidates, recommended: top.id, reasons, gaps: [], notes };
}

function wheelchairNotes(req: PlanRequest, facts: PlanningFacts): Finding[] {
  if (!req.travellers.some((t) => t.needsWheelchair)) return [];
  return facts.temples
    .filter((t) => req.temples.includes(t.code) && t.wheelchairAccess === false)
    .map((t) => ({
      code: 'NO_WHEELCHAIR_ACCESS',
      message: `${t.name} has no wheelchair access; arrange help`,
      temple: t.code,
    }));
}

export interface EvaluateRequest {
  template: TemplateCode;
  mode: PlanningMode;
  startDate: string;
  startTime?: string | null;
  fromPlace: string;
  toPlace?: string | null;
  travellers: PlanTraveller[];
  /** The itinerary as planned by hand: temples in order, with their day. */
  stops: { templeCode: string; day: number }[];
}

export interface EvaluateResult {
  status: 'FEASIBLE' | 'NOT_FEASIBLE' | 'DATA_INCOMPLETE';
  days: DayPlan[];
  failure: Finding | null;
  gaps: Finding[];
  notes: Finding[];
  configVersion: string;
  factsVersion: string;
}

/**
 * Checks a hand-made itinerary in exactly its order (D-20 → engine): the same simulation as
 * planning, so a concierge plan can be ENGINE-validated when the facts are verified.
 */
export function evaluateItinerary(
  req: EvaluateRequest,
  facts: PlanningFacts,
  config: EngineConfig = DEFAULT_ENGINE_CONFIG,
): EvaluateResult {
  const base = { configVersion: config.version, factsVersion: facts.version };
  const senior = req.travellers.some(isSenior);
  const temples = req.stops.map((s) => s.templeCode);
  const places = [...new Set([req.fromPlace, req.toPlace ?? req.fromPlace, facts.overnightPlace])];
  const gaps = gapsFor(facts, temples, places);
  if (gaps.length)
    return { ...base, status: 'DATA_INCOMPLETE', days: [], failure: null, gaps, notes: [] };

  const planner = new DayPlanner(facts, config);
  const ctx = dayContexts(
    {
      startDate: req.startDate,
      startTime: req.startTime,
      fromPlace: req.fromPlace,
      toPlace: req.toPlace,
      temples,
      travellers: req.travellers,
      purpose: 'ALL_NINE',
      days: 'RECOMMEND',
    },
    req.template,
    req.mode,
    senior,
    facts,
    config,
  );
  const days: DayPlan[] = [];
  for (const c of ctx) {
    const order = req.stops.filter((s) => s.day === c.day).map((s) => s.templeCode);
    if (!order.length) continue;
    const r = planner.simulate(c, order);
    if ('code' in r) {
      return {
        ...base,
        status: 'NOT_FEASIBLE',
        days,
        failure: r,
        gaps: [],
        notes: [...planner.notes.values()],
      };
    }
    days.push(r);
  }
  const notes = [
    ...wheelchairNotes({ ...req, temples, purpose: 'ALL_NINE', days: 'RECOMMEND' }, facts),
    ...planner.notes.values(),
  ];
  return { ...base, status: 'FEASIBLE', days, failure: null, gaps: [], notes };
}

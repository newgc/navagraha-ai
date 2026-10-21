import type { PlanningMode } from '../catalog.js';

/**
 * Planning parameters (FS §9.2–9.3, NAV-IT-002). Configuration, not product logic: the
 * values below are the starting point for operations to review, and every DecisionRecord
 * stores the version it used.
 */
export interface ModeConfig {
  /** Time inside each temple × the temple's verified visit minutes. */
  dwellMultiplier: number;
  /** Travel time × this safety factor (FS §9.2 "configurable safety/buffer factor"). */
  travelBuffer: number;
  /** Rest after each temple, minutes. */
  restMinutes: number;
}

export interface EngineConfig {
  version: string;
  /** Pickup time when the request gives none (HH:MM). */
  defaultStart: string;
  /** Latest time to be back at the drop point or hotel (HH:MM). */
  latestReturn: string;
  /** A meal break must start inside this window. */
  meal: { from: string; to: string; minutes: number };
  modes: Record<PlanningMode, ModeConfig>;
  /** Senior-Friendly overlay (FS §34): applied on top of the mode when a traveller is 60+. */
  senior: { dwellMultiplier: number; extraRestMinutes: number; maxTemplesPerDay: number };
  /** FS §9.3 recommendation weights (percent, sum 100). */
  weights: {
    purposeFit: number;
    comfort: number;
    travelEfficiency: number;
    budget: number;
    reliability: number;
    preferenceFit: number;
  };
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  version: 'engine-config-2026-10-21',
  defaultStart: '06:00',
  latestReturn: '21:30',
  meal: { from: '12:00', to: '14:30', minutes: 45 },
  modes: {
    FAST: { dwellMultiplier: 1, travelBuffer: 1.1, restMinutes: 0 },
    BALANCED: { dwellMultiplier: 1.2, travelBuffer: 1.2, restMinutes: 10 },
    RELAXED: { dwellMultiplier: 1.5, travelBuffer: 1.3, restMinutes: 20 },
  },
  senior: { dwellMultiplier: 1.25, extraRestMinutes: 10, maxTemplesPerDay: 6 },
  weights: {
    purposeFit: 25,
    comfort: 20,
    travelEfficiency: 20,
    budget: 15,
    reliability: 10,
    preferenceFit: 10,
  },
};

/**
 * FS §13.2 / D-05 — Passport progress is derived only from validated TempleVisit
 * completions. Self-reported completion is never an input here (NFR-18).
 */

export interface TempleVisitSnapshot {
  templeId: string;
  state: 'PLANNED' | 'ARRIVED' | 'VISITING' | 'COMPLETED' | 'SKIPPED';
}

export interface PassportProgress {
  completed: number;
  total: number;
  completedTempleIds: string[];
  remainingTempleIds: string[];
  isComplete: boolean;
}

/**
 * @param circuitTempleIds the circuit's eligible temples (9 for Navagraha)
 * @param visits all of the traveller's visits for this circuit, across trips (D-04 Q12)
 */
export function derivePassport(
  circuitTempleIds: readonly string[],
  visits: readonly TempleVisitSnapshot[],
): PassportProgress {
  const done = new Set(
    visits
      .filter((v) => v.state === 'COMPLETED' && circuitTempleIds.includes(v.templeId))
      .map((v) => v.templeId),
  );
  const completedTempleIds = circuitTempleIds.filter((id) => done.has(id));
  const remainingTempleIds = circuitTempleIds.filter((id) => !done.has(id));
  return {
    completed: completedTempleIds.length,
    total: circuitTempleIds.length,
    completedTempleIds,
    remainingTempleIds,
    isComplete: circuitTempleIds.length > 0 && remainingTempleIds.length === 0,
  };
}

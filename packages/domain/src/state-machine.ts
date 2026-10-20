import type { Role } from './roles.js';

/**
 * Minimal, data-driven state machine engine.
 *
 * Machines are plain data so they can be reviewed against D-04 line by line,
 * rendered in docs, and tested exhaustively. Business guards that need other
 * objects (e.g. the booking confirmation gate) live in `rules/` and are checked
 * by the calling service before it asks this engine for a decision.
 */

/** Special `from` value: any non-terminal state other than the target itself. */
export const ANY_OPEN = '*' as const;

export interface TransitionRule<S extends string> {
  from: readonly S[] | typeof ANY_OPEN;
  to: S;
  by: readonly Role[];
  /** A human-readable reason must be supplied (audited). */
  requiresReason?: boolean;
  /** Pointer back to the spec / decision for reviewers. */
  note?: string;
}

export interface MachineDefinition<S extends string> {
  name: string;
  states: readonly S[];
  /** States an object may be created in, and who may create it. */
  create: readonly { state: S; by: readonly Role[] }[];
  terminal: readonly S[];
  transitions: readonly TransitionRule<S>[];
}

export type TransitionError =
  | 'UNKNOWN_STATE'
  | 'FROM_TERMINAL_STATE'
  | 'ILLEGAL_TRANSITION'
  | 'ROLE_NOT_ALLOWED'
  | 'REASON_REQUIRED';

export type Decision<S extends string> =
  { ok: true; rule: TransitionRule<S> } | { ok: false; error: TransitionError; message: string };

export interface TransitionRequest<S extends string> {
  from: S;
  to: S;
  role: Role;
  reason?: string | null;
}

export function defineMachine<const S extends string>(
  def: MachineDefinition<S>,
): MachineDefinition<S> {
  const known = new Set<string>(def.states);
  const check = (s: string, where: string) => {
    if (!known.has(s)) throw new Error(`${def.name}: unknown state "${s}" in ${where}`);
  };
  def.terminal.forEach((s) => check(s, 'terminal'));
  def.create.forEach((c) => check(c.state, 'create'));
  for (const t of def.transitions) {
    check(t.to, `transition to ${t.to}`);
    if (t.from !== ANY_OPEN) t.from.forEach((s) => check(s, `transition to ${t.to}`));
    if (t.from !== ANY_OPEN && t.from.some((s) => def.terminal.includes(s))) {
      throw new Error(`${def.name}: transition to ${t.to} starts from a terminal state`);
    }
    if (t.by.length === 0)
      throw new Error(`${def.name}: transition to ${t.to} has no allowed roles`);
  }
  return def;
}

function matchesFrom<S extends string>(
  def: MachineDefinition<S>,
  rule: TransitionRule<S>,
  from: S,
) {
  return rule.from === ANY_OPEN
    ? !def.terminal.includes(from) && from !== rule.to
    : rule.from.includes(from);
}

/** Decide whether `role` may move an object from `from` to `to`. Pure; records nothing. */
export function decide<S extends string>(
  def: MachineDefinition<S>,
  req: TransitionRequest<NoInfer<S>>,
): Decision<S> {
  if (!def.states.includes(req.from) || !def.states.includes(req.to)) {
    return { ok: false, error: 'UNKNOWN_STATE', message: `${def.name}: unknown state` };
  }
  if (def.terminal.includes(req.from)) {
    return {
      ok: false,
      error: 'FROM_TERMINAL_STATE',
      message: `${def.name}: ${req.from} is terminal`,
    };
  }
  const candidates = def.transitions.filter(
    (t) => t.to === req.to && matchesFrom(def, t, req.from),
  );
  if (candidates.length === 0) {
    return {
      ok: false,
      error: 'ILLEGAL_TRANSITION',
      message: `${def.name}: ${req.from} → ${req.to} is not allowed`,
    };
  }
  const rule = candidates.find((t) => t.by.includes(req.role));
  if (!rule) {
    return {
      ok: false,
      error: 'ROLE_NOT_ALLOWED',
      message: `${def.name}: ${req.role} may not move ${req.from} → ${req.to}`,
    };
  }
  if (rule.requiresReason && !req.reason?.trim()) {
    return {
      ok: false,
      error: 'REASON_REQUIRED',
      message: `${def.name}: ${req.from} → ${req.to} needs a reason`,
    };
  }
  return { ok: true, rule };
}

/** Whether `role` may create an object of this machine in `state`. */
export function canCreate<S extends string>(
  def: MachineDefinition<S>,
  state: NoInfer<S>,
  role: Role,
): boolean {
  return def.create.some((c) => c.state === state && c.by.includes(role));
}

/** Every (from, to) pair the machine allows, with `ANY_OPEN` expanded. Useful for docs and tests. */
export function edges<S extends string>(def: MachineDefinition<S>) {
  return def.transitions.flatMap((t) => {
    const froms = def.states.filter((s) => matchesFrom(def, t, s));
    return froms.map((from) => ({ from, to: t.to, rule: t }));
  });
}

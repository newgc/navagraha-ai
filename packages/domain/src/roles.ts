/**
 * Actors that may perform state transitions (FS §36, D-18 vocabulary).
 *
 * There is deliberately no role for the AI planner: the LLM has no transition
 * authority (FS §2.1, §8.3). Anything the planner triggers runs as SYSTEM after
 * deterministic validation.
 */
export const ROLES = [
  'CUSTOMER',
  'OPS_COORDINATOR',
  'OPS_MANAGER',
  'DRIVER',
  'FINANCE',
  'CONTENT_ADMIN',
  'SYSTEM_ADMIN',
  /** Automated server-side process. */
  'SYSTEM',
  /** A verified payment-provider webhook. */
  'PAYMENT_GATEWAY',
] as const;

export type Role = (typeof ROLES)[number];

/** Roles that act on behalf of the operations team. */
export const OPS: readonly Role[] = ['OPS_COORDINATOR', 'OPS_MANAGER'];

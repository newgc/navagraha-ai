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

/**
 * The order in which a person's roles are tried when they act. Staff roles come before
 * CUSTOMER, so a coordinator who is also a customer is recorded as the coordinator when
 * working in the operations console; within staff, the least privileged role that is
 * allowed is the one recorded.
 */
const ACTING_ORDER: readonly Role[] = [
  'OPS_COORDINATOR',
  'FINANCE',
  'DRIVER',
  'CONTENT_ADMIN',
  'OPS_MANAGER',
  'SYSTEM_ADMIN',
  'SYSTEM',
  'PAYMENT_GATEWAY',
  'CUSTOMER',
];

export function inActingOrder(roles: readonly Role[]): Role[] {
  return [...roles].sort((a, b) => ACTING_ORDER.indexOf(a) - ACTING_ORDER.indexOf(b));
}

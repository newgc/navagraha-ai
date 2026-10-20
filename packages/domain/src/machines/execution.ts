import { OPS } from '../roles.js';
import { defineMachine } from '../state-machine.js';

// D-04 §4 — execution.

export const tripMachine = defineMachine({
  name: 'Trip',
  states: [
    'SCHEDULED',
    'DRIVER_ASSIGNED',
    'PICKUP_READY',
    'STARTED',
    'IN_PROGRESS',
    'INCIDENT',
    'COMPLETED',
    'CANCELLED',
  ],
  create: [{ state: 'SCHEDULED', by: ['SYSTEM'] }],
  terminal: ['COMPLETED', 'CANCELLED'],
  transitions: [
    {
      from: ['SCHEDULED'],
      to: 'DRIVER_ASSIGNED',
      by: OPS,
      note: 'Vehicle and driver assigned; capacity ≥ travellers.',
    },
    {
      from: ['DRIVER_ASSIGNED'],
      to: 'PICKUP_READY',
      by: [...OPS, 'SYSTEM'],
      note: 'Manifest generated (MR-25), T-12h checklist sent (MR-03), booking still CONFIRMED.',
    },
    { from: ['PICKUP_READY'], to: 'STARTED', by: [...OPS, 'DRIVER'], note: 'Pickup recorded.' },
    {
      from: ['STARTED'],
      to: 'IN_PROGRESS',
      by: ['SYSTEM'],
      note: 'D-04 Q7 [PROPOSED]: first temple ARRIVED.',
    },
    {
      from: ['STARTED', 'IN_PROGRESS'],
      to: 'INCIDENT',
      by: [...OPS, 'DRIVER'],
      requiresReason: true,
    },
    {
      from: ['INCIDENT'],
      to: 'IN_PROGRESS',
      by: ['OPS_MANAGER'],
      requiresReason: true,
      note: 'D-04 Q8 [PROPOSED]: operational clearance recorded.',
    },
    {
      from: ['IN_PROGRESS', 'INCIDENT'],
      to: 'COMPLETED',
      by: OPS,
      note: 'Partial completion allowed (EC-56).',
    },
    {
      from: ['SCHEDULED', 'DRIVER_ASSIGNED', 'PICKUP_READY'],
      to: 'CANCELLED',
      by: ['SYSTEM'],
      note: 'Booking cancelled.',
    },
    {
      from: ['STARTED', 'IN_PROGRESS', 'INCIDENT'],
      to: 'CANCELLED',
      by: ['OPS_MANAGER'],
      requiresReason: true,
      note: 'Trip abandoned (EC-14, EC-29); raises a Cancellation for refunds.',
    },
  ],
});

/**
 * NFR-18 / EC-45: no transition here may ever list CUSTOMER.
 * DRIVER transitions additionally require an assigned, active trip (FS §37) — enforced by the service.
 */
export const templeVisitMachine = defineMachine({
  name: 'TempleVisit',
  states: ['PLANNED', 'ARRIVED', 'VISITING', 'COMPLETED', 'SKIPPED'],
  create: [{ state: 'PLANNED', by: ['SYSTEM', ...OPS] }],
  terminal: ['SKIPPED'],
  transitions: [
    { from: ['PLANNED'], to: 'ARRIVED', by: [...OPS, 'DRIVER'] },
    { from: ['ARRIVED'], to: 'VISITING', by: [...OPS, 'DRIVER'] },
    { from: ['VISITING'], to: 'COMPLETED', by: [...OPS, 'DRIVER'] },
    {
      from: ['PLANNED'],
      to: 'COMPLETED',
      by: OPS,
      requiresReason: true,
      note: 'D-04 Q9 [PROPOSED]: coordinator recording after a phone call (D-15 fallback).',
    },
    {
      from: ['PLANNED', 'ARRIVED', 'VISITING'],
      to: 'SKIPPED',
      by: OPS,
      requiresReason: true,
    },
    {
      from: ['COMPLETED'],
      to: 'SKIPPED',
      by: ['OPS_MANAGER'],
      requiresReason: true,
      note: 'D-04 Q10: correcting a false completion (EC-37).',
    },
  ],
});

export const changeRequestMachine = defineMachine({
  name: 'ChangeRequest',
  states: ['REQUESTED', 'REVIEWING', 'APPROVED', 'REJECTED', 'APPLIED', 'WITHDRAWN'],
  create: [{ state: 'REQUESTED', by: ['CUSTOMER', ...OPS] }],
  terminal: ['REJECTED', 'APPLIED', 'WITHDRAWN'],
  transitions: [
    { from: ['REQUESTED'], to: 'REVIEWING', by: OPS },
    {
      from: ['REVIEWING'],
      to: 'APPROVED',
      by: OPS,
      note: 'Feasible, and the customer accepted any price difference (new quote LOCKED).',
    },
    { from: ['REVIEWING'], to: 'REJECTED', by: OPS, requiresReason: true },
    { from: ['APPROVED'], to: 'APPLIED', by: ['SYSTEM'] },
    {
      from: ['REQUESTED', 'REVIEWING'],
      to: 'WITHDRAWN',
      by: ['CUSTOMER', ...OPS],
      note: 'D-04 Q11 [PROPOSED].',
    },
  ],
});

export const cancellationMachine = defineMachine({
  name: 'Cancellation',
  states: [
    'REQUESTED',
    'REVIEWING',
    'APPROVED',
    'REJECTED',
    'REFUND_PENDING',
    'REFUNDED',
    'CLOSED_NO_REFUND',
  ],
  create: [{ state: 'REQUESTED', by: ['CUSTOMER', ...OPS] }],
  terminal: ['REJECTED', 'REFUNDED', 'CLOSED_NO_REFUND'],
  transitions: [
    {
      from: ['REQUESTED'],
      to: 'REVIEWING',
      by: OPS,
      note: 'Refund calculated per component from the D-06 policy (EC-47).',
    },
    { from: ['REVIEWING'], to: 'APPROVED', by: ['OPS_MANAGER'] },
    { from: ['REVIEWING'], to: 'REJECTED', by: ['OPS_MANAGER'], requiresReason: true },
    { from: ['APPROVED'], to: 'REFUND_PENDING', by: ['SYSTEM'], note: 'Refund amount > 0.' },
    { from: ['REFUND_PENDING'], to: 'REFUNDED', by: ['SYSTEM'] },
    {
      from: ['APPROVED'],
      to: 'CLOSED_NO_REFUND',
      by: ['SYSTEM'],
      note: 'D-04 Q11 [PROPOSED]: refund amount is zero under policy.',
    },
  ],
});

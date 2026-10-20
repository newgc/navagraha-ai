import { OPS } from '../roles.js';
import { ANY_OPEN, defineMachine } from '../state-machine.js';

// D-04 §3 — planning.

export const leadMachine = defineMachine({
  name: 'Lead',
  states: ['NEW', 'QUALIFIED', 'PLANNING', 'QUOTED', 'CONVERTED', 'LOST'],
  create: [{ state: 'NEW', by: ['SYSTEM', ...OPS] }],
  terminal: ['CONVERTED'],
  transitions: [
    { from: ['NEW'], to: 'QUALIFIED', by: ['SYSTEM', ...OPS] },
    {
      from: ['NEW', 'QUALIFIED'],
      to: 'PLANNING',
      by: ['SYSTEM', ...OPS],
      note: 'NEW → PLANNING allowed for concierge leads (FS §12.1).',
    },
    { from: ['PLANNING'], to: 'QUOTED', by: ['SYSTEM'] },
    { from: ['QUOTED'], to: 'CONVERTED', by: ['SYSTEM'] },
    { from: ANY_OPEN, to: 'LOST', by: ['SYSTEM', ...OPS], requiresReason: true },
    { from: ['LOST'], to: 'PLANNING', by: ['SYSTEM', ...OPS], note: '[PROPOSED] lead returns.' },
  ],
});

export const planningSessionMachine = defineMachine({
  name: 'PlanningSession',
  states: ['OPEN', 'COLLECTING', 'READY', 'PLAN_GENERATED', 'EXPIRED', 'CANCELLED'],
  create: [{ state: 'OPEN', by: ['CUSTOMER', 'SYSTEM'] }],
  terminal: ['EXPIRED', 'CANCELLED'],
  transitions: [
    { from: ['OPEN'], to: 'COLLECTING', by: ['SYSTEM'] },
    {
      from: ['COLLECTING'],
      to: 'READY',
      by: ['SYSTEM'],
      note: 'TripRequest passes schema validation (MR-07).',
    },
    {
      from: ['READY'],
      to: 'PLAN_GENERATED',
      by: ['SYSTEM'],
      note: 'Engine returned candidates and a DecisionRecord was saved.',
    },
    {
      from: ['PLAN_GENERATED'],
      to: 'COLLECTING',
      by: ['SYSTEM'],
      note: '[PROPOSED] customer changed a material input.',
    },
    { from: ANY_OPEN, to: 'EXPIRED', by: ['SYSTEM'] },
    { from: ANY_OPEN, to: 'CANCELLED', by: ['CUSTOMER', 'SYSTEM'] },
  ],
});

/** States apply to one immutable itinerary version (NAV-IT-004/005). */
export const itineraryMachine = defineMachine({
  name: 'Itinerary',
  states: [
    'DRAFT',
    'VALIDATED',
    'PROPOSED',
    'ACCEPTED',
    'OPS_ADJUSTED',
    'LIVE',
    'COMPLETED',
    'ABANDONED',
    'SUPERSEDED',
  ],
  create: [{ state: 'DRAFT', by: ['SYSTEM', ...OPS] }],
  terminal: ['COMPLETED', 'ABANDONED', 'SUPERSEDED'],
  transitions: [
    {
      from: ['DRAFT'],
      to: 'VALIDATED',
      by: ['SYSTEM'],
      note: 'Feasibility engine only (FS §9.2). An infeasible draft stays DRAFT.',
    },
    { from: ['VALIDATED'], to: 'PROPOSED', by: ['SYSTEM', ...OPS] },
    { from: ['PROPOSED'], to: 'ACCEPTED', by: ['CUSTOMER', ...OPS] },
    {
      from: ['VALIDATED'],
      to: 'OPS_ADJUSTED',
      by: OPS,
      requiresReason: true,
      note: 'Ops-made version replacing the active one; previous active → SUPERSEDED.',
    },
    { from: ['ACCEPTED', 'OPS_ADJUSTED'], to: 'LIVE', by: ['SYSTEM'] },
    { from: ['LIVE'], to: 'COMPLETED', by: ['SYSTEM'] },
    { from: ANY_OPEN, to: 'ABANDONED', by: ['SYSTEM'] },
    { from: ANY_OPEN, to: 'SUPERSEDED', by: ['SYSTEM'], note: 'D-04 Q6 [PROPOSED].' },
  ],
});

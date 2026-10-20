import { OPS } from '../roles.js';
import { ANY_OPEN, defineMachine } from '../state-machine.js';

// D-04 §2 — transactional core. Every `note` points back to the draft or the spec.

export const bookingMachine = defineMachine({
  name: 'Booking',
  states: [
    'REQUESTED',
    'PENDING_CONFIRMATION',
    'CONFIRMED',
    'IN_PROGRESS',
    'COMPLETED',
    'CANCELLED',
  ],
  create: [{ state: 'REQUESTED', by: ['CUSTOMER', ...OPS] }],
  terminal: ['COMPLETED', 'CANCELLED'],
  transitions: [
    { from: ['REQUESTED'], to: 'PENDING_CONFIRMATION', by: ['SYSTEM'] },
    {
      from: ['PENDING_CONFIRMATION'],
      to: 'CONFIRMED',
      by: ['SYSTEM'],
      note: 'Only when the confirmation gate is open: payment condition (D-06) AND fulfilment ALL_REQUIRED_CONFIRMED.',
    },
    {
      from: ['CONFIRMED'],
      to: 'PENDING_CONFIRMATION',
      by: ['SYSTEM', 'OPS_MANAGER'],
      requiresReason: true,
      note: 'D-04 Q2 [PROPOSED]: gate no longer holds (EC-08, applied change request).',
    },
    { from: ['CONFIRMED'], to: 'IN_PROGRESS', by: ['SYSTEM'], note: 'Trip STARTED.' },
    { from: ['IN_PROGRESS'], to: 'COMPLETED', by: ['SYSTEM'], note: 'Trip COMPLETED.' },
    {
      from: ANY_OPEN,
      to: 'CANCELLED',
      by: ['SYSTEM'],
      note: 'Only as the effect of an APPROVED Cancellation.',
    },
  ],
});

export const paymentMachine = defineMachine({
  name: 'Payment',
  states: ['NOT_REQUIRED', 'PENDING', 'SUCCESS', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED'],
  create: [
    { state: 'PENDING', by: ['SYSTEM'] },
    { state: 'NOT_REQUIRED', by: ['SYSTEM', 'OPS_MANAGER'] },
  ],
  terminal: ['NOT_REQUIRED', 'REFUNDED'],
  transitions: [
    {
      from: ['PENDING'],
      to: 'SUCCESS',
      by: ['PAYMENT_GATEWAY', 'SYSTEM'],
      note: 'Verified webhook or server-side reconciliation only — never a client signal (FS §11.2).',
    },
    { from: ['PENDING'], to: 'FAILED', by: ['PAYMENT_GATEWAY', 'SYSTEM'] },
    {
      from: ['FAILED'],
      to: 'SUCCESS',
      by: ['PAYMENT_GATEWAY', 'SYSTEM'],
      note: 'D-04 Q4 [PROPOSED]: late capture, e.g. UPI pending (EC-25).',
    },
    {
      from: ['SUCCESS', 'PARTIALLY_REFUNDED'],
      to: 'PARTIALLY_REFUNDED',
      by: ['PAYMENT_GATEWAY', 'SYSTEM'],
      note: 'Gateway confirmed a refund that leaves part of the capture.',
    },
    {
      from: ['SUCCESS', 'PARTIALLY_REFUNDED'],
      to: 'REFUNDED',
      by: ['PAYMENT_GATEWAY', 'SYSTEM'],
      note: 'Gateway confirmed refunds equal to the capture.',
    },
  ],
});

export const refundMachine = defineMachine({
  name: 'Refund',
  states: ['INITIATED', 'CONFIRMED', 'FAILED'],
  create: [{ state: 'INITIATED', by: ['FINANCE', 'OPS_MANAGER', 'SYSTEM'] }],
  terminal: ['CONFIRMED', 'FAILED'],
  transitions: [
    { from: ['INITIATED'], to: 'CONFIRMED', by: ['PAYMENT_GATEWAY', 'SYSTEM'] },
    { from: ['INITIATED'], to: 'FAILED', by: ['PAYMENT_GATEWAY', 'SYSTEM'] },
  ],
});

/** D-04 §2.3 [PROPOSED] — one per vehicle / hotel / pooja / pickup. The aggregate is derived. */
export const fulfilmentComponentMachine = defineMachine({
  name: 'FulfilmentComponent',
  states: ['PENDING', 'REQUESTED', 'CONFIRMED', 'DECLINED', 'RELEASED', 'CANCELLED'],
  create: [{ state: 'PENDING', by: ['SYSTEM', ...OPS] }],
  terminal: ['DECLINED', 'RELEASED', 'CANCELLED'],
  transitions: [
    { from: ['PENDING'], to: 'REQUESTED', by: [...OPS, 'SYSTEM'] },
    {
      from: ['REQUESTED'],
      to: 'CONFIRMED',
      by: [...OPS, 'SYSTEM'],
      note: 'Supplier reference must be captured (FS §12).',
    },
    { from: ['REQUESTED'], to: 'DECLINED', by: [...OPS, 'SYSTEM'], requiresReason: true },
    { from: ['CONFIRMED'], to: 'RELEASED', by: [...OPS, 'SYSTEM'] },
    { from: ['PENDING', 'REQUESTED'], to: 'CANCELLED', by: [...OPS, 'SYSTEM'] },
  ],
});

export const quoteMachine = defineMachine({
  name: 'Quote',
  states: ['DRAFT', 'CALCULATED', 'PRESENTED', 'LOCKED', 'EXPIRED', 'CANCELLED'],
  create: [{ state: 'DRAFT', by: ['SYSTEM', ...OPS] }],
  terminal: ['EXPIRED', 'CANCELLED'],
  transitions: [
    {
      from: ['DRAFT'],
      to: 'CALCULATED',
      by: ['SYSTEM'],
      note: 'Quote engine only. Immutable from here; changes create a new quote (EC-26/27).',
    },
    { from: ['CALCULATED'], to: 'PRESENTED', by: ['SYSTEM', ...OPS] },
    {
      from: ['PRESENTED'],
      to: 'LOCKED',
      by: ['CUSTOMER', ...OPS],
      note: 'D-04 Q5: ACCEPTED and LOCKED are one state. Within validity (MR-13).',
    },
    { from: ['PRESENTED', 'LOCKED'], to: 'EXPIRED', by: ['SYSTEM'] },
    { from: ['DRAFT', 'CALCULATED', 'PRESENTED'], to: 'CANCELLED', by: ['SYSTEM', ...OPS] },
  ],
});

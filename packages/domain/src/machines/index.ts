import {
  cancellationMachine,
  changeRequestMachine,
  templeVisitMachine,
  tripMachine,
} from './execution.js';
import { itineraryMachine, leadMachine, planningSessionMachine } from './planning.js';
import {
  bookingMachine,
  fulfilmentComponentMachine,
  paymentMachine,
  quoteMachine,
  refundMachine,
} from './transactional.js';

export * from './execution.js';
export * from './planning.js';
export * from './transactional.js';

/** Every canonical machine, for docs generation and cross-cutting tests. */
export const ALL_MACHINES = [
  leadMachine,
  planningSessionMachine,
  itineraryMachine,
  quoteMachine,
  bookingMachine,
  paymentMachine,
  refundMachine,
  fulfilmentComponentMachine,
  tripMachine,
  templeVisitMachine,
  changeRequestMachine,
  cancellationMachine,
] as const;

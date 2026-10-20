/** D-04 §2.3 — the aggregate fulfilment state is derived from components, never set by hand. */

export type FulfilmentComponentState =
  'PENDING' | 'REQUESTED' | 'CONFIRMED' | 'DECLINED' | 'RELEASED' | 'CANCELLED';

export type FulfilmentState =
  'PENDING' | 'PARTIAL' | 'ALL_REQUIRED_CONFIRMED' | 'FAILED' | 'RELEASED' | 'CANCELLED';

export interface FulfilmentComponentSnapshot {
  /**
   * What the component fulfils, e.g. `vehicle`, `hotel:night-1`, `pooja:TEM-SHA`.
   * A declined component is replaced by a new component with the same slot.
   */
  slot: string;
  /** Mandatory for the selected Package (FS §10). */
  mandatory: boolean;
  state: FulfilmentComponentState;
}

export interface FulfilmentContext {
  bookingCancelled?: boolean;
  /** Ops marked a declined mandatory slot as unrecoverable. */
  markedUnrecoverable?: boolean;
}

export function deriveFulfilmentState(
  components: readonly FulfilmentComponentSnapshot[],
  ctx: FulfilmentContext = {},
): FulfilmentState {
  if (ctx.bookingCancelled) {
    return components.some((c) => c.state === 'RELEASED') ? 'RELEASED' : 'CANCELLED';
  }
  if (ctx.markedUnrecoverable) return 'FAILED';

  const mandatorySlots = new Set(components.filter((c) => c.mandatory).map((c) => c.slot));
  if (mandatorySlots.size === 0) return 'ALL_REQUIRED_CONFIRMED';

  let confirmed = 0;
  for (const slot of mandatorySlots) {
    if (components.some((c) => c.slot === slot && c.mandatory && c.state === 'CONFIRMED')) {
      confirmed++;
    }
  }
  if (confirmed === mandatorySlots.size) return 'ALL_REQUIRED_CONFIRMED';
  return confirmed === 0 ? 'PENDING' : 'PARTIAL';
}

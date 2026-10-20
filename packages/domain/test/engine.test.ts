import { describe, expect, it } from 'vitest';
import { ANY_OPEN, canCreate, decide, defineMachine, edges } from '../src/index.js';

const door = defineMachine({
  name: 'Door',
  states: ['CLOSED', 'OPEN', 'LOCKED', 'BROKEN'],
  create: [{ state: 'CLOSED', by: ['SYSTEM'] }],
  terminal: ['BROKEN'],
  transitions: [
    { from: ['CLOSED'], to: 'OPEN', by: ['CUSTOMER'] },
    { from: ['CLOSED'], to: 'LOCKED', by: ['OPS_MANAGER'], requiresReason: true },
    { from: ANY_OPEN, to: 'BROKEN', by: ['SYSTEM'] },
  ],
});

describe('state machine engine', () => {
  it('allows a listed transition for a listed role', () => {
    expect(decide(door, { from: 'CLOSED', to: 'OPEN', role: 'CUSTOMER' }).ok).toBe(true);
  });

  it('rejects an unlisted transition', () => {
    const d = decide(door, { from: 'OPEN', to: 'LOCKED', role: 'OPS_MANAGER', reason: 'x' });
    expect(d).toMatchObject({ ok: false, error: 'ILLEGAL_TRANSITION' });
  });

  it('rejects a listed transition for the wrong role', () => {
    const d = decide(door, { from: 'CLOSED', to: 'OPEN', role: 'DRIVER' });
    expect(d).toMatchObject({ ok: false, error: 'ROLE_NOT_ALLOWED' });
  });

  it('requires a non-blank reason when the rule says so', () => {
    expect(decide(door, { from: 'CLOSED', to: 'LOCKED', role: 'OPS_MANAGER' })).toMatchObject({
      error: 'REASON_REQUIRED',
    });
    expect(
      decide(door, { from: 'CLOSED', to: 'LOCKED', role: 'OPS_MANAGER', reason: '  ' }),
    ).toMatchObject({ error: 'REASON_REQUIRED' });
    expect(
      decide(door, { from: 'CLOSED', to: 'LOCKED', role: 'OPS_MANAGER', reason: 'audit' }).ok,
    ).toBe(true);
  });

  it('never leaves a terminal state', () => {
    expect(decide(door, { from: 'BROKEN', to: 'CLOSED', role: 'SYSTEM' })).toMatchObject({
      error: 'FROM_TERMINAL_STATE',
    });
  });

  it('expands ANY_OPEN to every non-terminal state except the target', () => {
    const toBroken = edges(door)
      .filter((e) => e.to === 'BROKEN')
      .map((e) => e.from);
    expect(toBroken.sort()).toEqual(['CLOSED', 'LOCKED', 'OPEN']);
  });

  it('rejects unknown states', () => {
    // @ts-expect-error deliberately invalid
    expect(decide(door, { from: 'AJAR', to: 'OPEN', role: 'CUSTOMER' })).toMatchObject({
      error: 'UNKNOWN_STATE',
    });
  });

  it('checks creation rights', () => {
    expect(canCreate(door, 'CLOSED', 'SYSTEM')).toBe(true);
    expect(canCreate(door, 'CLOSED', 'CUSTOMER')).toBe(false);
    expect(canCreate(door, 'OPEN', 'SYSTEM')).toBe(false);
  });

  it('refuses malformed definitions', () => {
    expect(() =>
      defineMachine({
        name: 'Bad',
        states: ['A', 'B'],
        create: [{ state: 'A', by: ['SYSTEM'] }],
        terminal: ['B'],
        transitions: [{ from: ['B'], to: 'A', by: ['SYSTEM'] }],
      }),
    ).toThrow(/terminal/);
    expect(() =>
      defineMachine({
        name: 'Bad',
        states: ['A', 'B'],
        create: [{ state: 'A', by: ['SYSTEM'] }],
        terminal: [],
        transitions: [{ from: ['A'], to: 'B', by: [] }],
      }),
    ).toThrow(/no allowed roles/);
  });
});

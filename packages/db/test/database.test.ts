import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, seedDatabase, type Database } from '../src/index.js';
import { freshDatabase } from './reset.js';

const url = process.env.TEST_DATABASE_URL;

/** Drizzle wraps driver errors; the Postgres message is on `cause`. */
async function pgError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const err = e as Error & { cause?: Error };
    return err.cause?.message ?? err.message;
  }
  throw new Error('expected the query to fail');
}

/** Runs against a disposable database. Set TEST_DATABASE_URL (CI does). */
describe.skipIf(!url)('database', () => {
  let db: Database;
  let end: () => Promise<void>;

  beforeAll(async () => {
    ({ db, end } = await freshDatabase(url!));
  });

  afterAll(async () => end?.());

  it('seeds the Navagraha circuit idempotently, unverified and in DRAFT', async () => {
    await seedDatabase(db);
    await seedDatabase(db);
    const circuits = await db.select().from(schema.circuit);
    expect(circuits).toHaveLength(1);
    expect(circuits[0]).toMatchObject({ code: 'NAVAGRAHA', status: 'DRAFT' });
    const temples = await db.select().from(schema.temple);
    expect(temples).toHaveLength(9);
    expect(new Set(temples.map((t) => t.verificationStatus))).toEqual(new Set(['TO_COLLECT']));
    expect(await db.select().from(schema.circuitTemple)).toHaveLength(9);
    expect(await db.select().from(schema.place)).toHaveLength(15);
  });

  it('state_transition and audit_log are append-only', async () => {
    await db.insert(schema.stateTransition).values({
      machine: 'Booking',
      entityId: '00000000-0000-0000-0000-000000000001',
      toState: 'REQUESTED',
      actorRole: 'CUSTOMER',
      occurredAt: new Date(),
      correlationId: 'test-corr',
    });
    await db.insert(schema.auditLog).values({ action: 'test.write', correlationId: 'test-corr' });

    for (const table of ['state_transition', 'audit_log']) {
      for (const stmt of [
        `UPDATE ${table} SET correlation_id = 'x'`,
        `DELETE FROM ${table}`,
        `TRUNCATE ${table}`,
      ]) {
        expect(await pgError(db.execute(sql.raw(stmt)))).toMatch(/append-only/);
      }
    }
  });

  it('webhook idempotency keys are unique (NFR-09)', async () => {
    const row = {
      machine: 'Payment',
      entityId: '00000000-0000-0000-0000-000000000002',
      fromState: 'PENDING',
      toState: 'SUCCESS',
      actorRole: 'PAYMENT_GATEWAY',
      occurredAt: new Date(),
      correlationId: 'test-corr',
      idempotencyKey: 'pay_evt_123',
    };
    await db.insert(schema.stateTransition).values(row);
    await expect(db.insert(schema.stateTransition).values(row)).rejects.toThrow();
  });

  it('users need a phone or email; phones are E.164; emails unique ignoring case', async () => {
    await expect(db.insert(schema.appUser).values({ displayName: 'Nobody' })).rejects.toThrow();
    await expect(db.insert(schema.appUser).values({ phone: '9876543210' })).rejects.toThrow();
    await db
      .insert(schema.appUser)
      .values({ phone: '+919876543210', email: 'Pilgrim@Example.com' });
    await expect(
      db.insert(schema.appUser).values({ email: 'pilgrim@example.com' }),
    ).rejects.toThrow();
  });
});

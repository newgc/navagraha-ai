import { createDb, resetDatabase, seedDatabase, type Database } from '../src/index.js';

/** Fresh, migrated (and optionally seeded) database for a test file. */
export async function freshDatabase(url: string, opts: { seed?: boolean } = {}) {
  const { db, pool } = createDb(url);
  await resetDatabase(db);
  if (opts.seed) await seedDatabase(db);
  return { db: db as Database, end: () => pool.end() };
}

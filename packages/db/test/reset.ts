import { sql } from 'drizzle-orm';
import { createDb, migrateDatabase, seedDatabase, type Database } from '../src/index.js';

/** Fresh, migrated (and optionally seeded) database for a test file. */
export async function freshDatabase(url: string, opts: { seed?: boolean } = {}) {
  const { db, pool } = createDb(url);
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await migrateDatabase(db);
  if (opts.seed) await seedDatabase(db);
  return { db: db as Database, end: () => pool.end() };
}

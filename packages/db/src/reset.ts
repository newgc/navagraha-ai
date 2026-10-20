import { sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { migrateDatabase } from './migrate.js';

/**
 * DESTRUCTIVE — for test databases only. Drops every table and re-applies all migrations.
 * Refuses to run when NODE_ENV is production.
 */
export async function resetDatabase(db: Database): Promise<void> {
  if (process.env.NODE_ENV === 'production')
    throw new Error('resetDatabase is refused in production');
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await migrateDatabase(db);
}

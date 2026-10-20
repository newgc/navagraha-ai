import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;

export type DbHandle = { db: Database; pool: Pool };

export function createDb(connectionString: string): DbHandle {
  const pool = new Pool({ connectionString, max: 10 });
  return { db: drizzle(pool, { schema }), pool };
}

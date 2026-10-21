import { readFileSync } from 'node:fs';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;

export type DbHandle = { db: Database; pool: Pool };

/**
 * TLS for managed databases. When DATABASE_SSL_CA names a CA bundle file (the Docker image
 * ships Amazon's RDS bundle, which also covers Lightsail databases), connections are encrypted
 * and the server certificate is verified. Without it (local development, CI) TLS is not used.
 */
export function sslFromEnv(env: NodeJS.ProcessEnv = process.env): PoolConfig['ssl'] {
  const caFile = env.DATABASE_SSL_CA;
  if (!caFile) return undefined;
  return { ca: readFileSync(caFile, 'utf8'), rejectUnauthorized: true };
}

export function createDb(connectionString: string): DbHandle {
  const url = new URL(connectionString);
  const ssl = sslFromEnv();
  if (ssl && url.searchParams.has('sslmode')) {
    // A sslmode in the URL would override the verified TLS settings above; refuse the mix.
    throw new Error('Remove sslmode from DATABASE_URL; TLS comes from DATABASE_SSL_CA');
  }
  const pool = new Pool({ connectionString, ssl, max: 10 });
  return { db: drizzle(pool, { schema }), pool };
}

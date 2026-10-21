import { readFileSync } from 'node:fs';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;

export type DbHandle = { db: Database; pool: Pool };

/**
 * TLS for managed databases; the server certificate is always verified when TLS is on.
 * - DATABASE_SSL_CA names a CA bundle file. The Docker image ships Amazon's RDS bundle, which
 *   also covers Lightsail databases.
 * - DATABASE_SSL=verify uses Node's built-in public CAs, for hosts with publicly signed
 *   certificates such as Neon (the staging database).
 * With neither (local development, CI) TLS is not used.
 */
export function sslFromEnv(env: NodeJS.ProcessEnv = process.env): PoolConfig['ssl'] {
  const caFile = env.DATABASE_SSL_CA;
  if (caFile) return { ca: readFileSync(caFile, 'utf8'), rejectUnauthorized: true };
  if (env.DATABASE_SSL === 'verify') return { rejectUnauthorized: true };
  if (env.DATABASE_SSL) throw new Error('DATABASE_SSL must be "verify" or unset');
  return undefined;
}

/** URL parameters that would override the verified TLS settings from sslFromEnv. */
const TLS_URL_PARAMS = [
  'ssl',
  'sslmode',
  'sslrootcert',
  'sslcert',
  'sslkey',
  'sslnegotiation',
  'uselibpqcompat',
];

export function createDb(connectionString: string): DbHandle {
  const ssl = sslFromEnv();
  let enableChannelBinding = false;
  if (ssl) {
    // Hosted databases hand out URLs like Neon's `?sslmode=require&channel_binding=require`.
    // Drop the TLS parameters so they cannot weaken the verified settings above, and honour
    // channel binding (pg's own option, not a URL parameter).
    const url = new URL(connectionString);
    for (const p of TLS_URL_PARAMS) url.searchParams.delete(p);
    enableChannelBinding = url.searchParams.get('channel_binding') === 'require';
    url.searchParams.delete('channel_binding');
    connectionString = url.toString();
  }
  const pool = new Pool({ connectionString, ssl, enableChannelBinding, max: 10 });
  // An idle connection can be closed by the server (Neon suspends idle databases). Without a
  // listener pg's 'error' event would crash the process; the pool reconnects on next use.
  pool.on('error', (err) => {
    console.warn(`Database connection closed by the server: ${err.message}`);
  });
  return { db: drizzle(pool, { schema }), pool };
}

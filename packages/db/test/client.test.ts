import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb, sslFromEnv } from '../src/index.js';

describe('database TLS', () => {
  afterEach(() => {
    delete process.env.DATABASE_SSL_CA;
    delete process.env.DATABASE_SSL;
  });

  it('uses no TLS without a CA bundle', () => {
    expect(sslFromEnv({})).toBeUndefined();
  });

  it('verifies the server against the bundled CA when one is configured', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ca-'));
    const file = path.join(dir, 'ca.pem');
    writeFileSync(file, '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----\n');
    expect(sslFromEnv({ DATABASE_SSL_CA: file })).toEqual({
      ca: expect.stringContaining('BEGIN CERTIFICATE'),
      rejectUnauthorized: true,
    });
  });

  it('verifies against the public CAs for hosted databases such as Neon', () => {
    expect(sslFromEnv({ DATABASE_SSL: 'verify' })).toEqual({ rejectUnauthorized: true });
    expect(() => sslFromEnv({ DATABASE_SSL: 'require' })).toThrow(/DATABASE_SSL/);
  });

  it('drops URL TLS parameters so they cannot weaken verification', async () => {
    process.env.DATABASE_SSL = 'verify';
    const { pool } = createDb(
      'postgres://u:p@ep-x.ap-southeast-1.aws.neon.tech/db?sslmode=require&channel_binding=require',
    );
    const options = pool.options as {
      connectionString: string;
      ssl: unknown;
      enableChannelBinding: boolean;
    };
    expect(options.connectionString).toBe('postgres://u:p@ep-x.ap-southeast-1.aws.neon.tech/db');
    expect(options.ssl).toEqual({ rejectUnauthorized: true });
    expect(options.enableChannelBinding).toBe(true);
    await pool.end();
  });

  it('leaves the URL alone without TLS settings (local development)', async () => {
    const { pool } = createDb('postgres://u:p@localhost/db?sslmode=disable');
    expect((pool.options as { connectionString: string }).connectionString).toBe(
      'postgres://u:p@localhost/db?sslmode=disable',
    );
    await pool.end();
  });
});

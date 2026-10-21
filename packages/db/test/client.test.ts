import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb, sslFromEnv } from '../src/index.js';

describe('database TLS', () => {
  afterEach(() => {
    delete process.env.DATABASE_SSL_CA;
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

  it('refuses sslmode in the URL alongside the CA bundle', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ca-'));
    const file = path.join(dir, 'ca.pem');
    writeFileSync(file, 'x');
    process.env.DATABASE_SSL_CA = file;
    expect(() => createDb('postgres://u:p@h/db?sslmode=require')).toThrow(/sslmode/);
  });
});

import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = {
  DATABASE_URL: 'postgres://u:p@h/db',
  AUTH_SECRET: 'a-development-secret-that-is-long-enough',
};

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig(base)).toEqual({
      ...base,
      NODE_ENV: 'development',
      API_PORT: 4000,
      OTP_SENDER: 'console',
    });
  });

  it('fails fast listing every bad variable', () => {
    expect(() => loadConfig({ DATABASE_URL: 'mysql://x', API_PORT: 'abc' })).toThrow(
      /DATABASE_URL.*API_PORT.*AUTH_SECRET|API_PORT.*DATABASE_URL/s,
    );
  });

  it('the file sender needs an outbox and is refused in production', () => {
    expect(() => loadConfig({ ...base, OTP_SENDER: 'file' })).toThrow(/OTP_OUTBOX_FILE/);
    expect(
      loadConfig({ ...base, OTP_SENDER: 'file', OTP_OUTBOX_FILE: '/tmp/otp' }).OTP_SENDER,
    ).toBe('file');
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        OTP_SENDER: 'file',
        OTP_OUTBOX_FILE: '/tmp/otp',
      }),
    ).toThrow(/OTP_SENDER/);
  });

  it('refuses the console OTP sender and the example secret in production', () => {
    const prod = {
      ...base,
      NODE_ENV: 'production',
      AUTH_SECRET: 'change-me-change-me-change-me-change-me',
    };
    expect(() => loadConfig(prod)).toThrow(/OTP_SENDER.*AUTH_SECRET/s);
  });
});

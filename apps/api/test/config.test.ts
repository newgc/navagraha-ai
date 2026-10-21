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
      DEPLOY_ENV: 'local',
      API_HOST: '127.0.0.1',
      API_PORT: 4000,
      OTP_SENDER: 'console',
      HASHWA_API_URL: 'https://eco.hashwa.in/api',
      PAYMENT_GATEWAY: 'none',
      CASHFREE_ENV: 'sandbox',
      CASHFREE_API_VERSION: '2026-01-01',
      PAYMENT_LINK_EXPIRY_HOURS: 48,
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

  it('staging may print sign-in codes to the log; production may not', () => {
    const staging = { ...base, NODE_ENV: 'production', DEPLOY_ENV: 'staging' };
    expect(loadConfig(staging).OTP_SENDER).toBe('console');
    expect(() =>
      loadConfig({ ...staging, OTP_SENDER: 'file', OTP_OUTBOX_FILE: '/tmp/otp' }),
    ).toThrow(/OTP_SENDER/);
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', DEPLOY_ENV: 'production' })).toThrow(
      /use whatsapp/,
    );
    expect(() =>
      loadConfig({ ...staging, AUTH_SECRET: 'change-me-change-me-change-me-change-me' }),
    ).toThrow(/AUTH_SECRET/);
  });

  it('WhatsApp codes need the Hashwa secret and account, and are allowed everywhere', () => {
    const whatsapp = { ...base, OTP_SENDER: 'whatsapp' };
    expect(() => loadConfig(whatsapp)).toThrow(/WHATSAPP_API_SECRET.*WHATSAPP_ACCOUNT/s);
    const ready = { ...whatsapp, WHATSAPP_API_SECRET: 's3cret', WHATSAPP_ACCOUNT: 'acc-1' };
    expect(loadConfig(ready).OTP_SENDER).toBe('whatsapp');
    expect(loadConfig({ ...ready, NODE_ENV: 'production', DEPLOY_ENV: 'staging' }).OTP_SENDER).toBe(
      'whatsapp',
    );
    expect(
      loadConfig({ ...ready, NODE_ENV: 'production', DEPLOY_ENV: 'production' }).OTP_SENDER,
    ).toBe('whatsapp');
  });

  it('Cashfree needs keys, and test and real money never cross deployments', () => {
    const cf = { ...base, PAYMENT_GATEWAY: 'cashfree' };
    expect(() => loadConfig(cf)).toThrow(/CASHFREE_CLIENT_ID.*CASHFREE_CLIENT_SECRET/s);
    const keys = { ...cf, CASHFREE_CLIENT_ID: 'id', CASHFREE_CLIENT_SECRET: 'secret' };
    expect(loadConfig(keys).CASHFREE_ENV).toBe('sandbox');
    expect(
      loadConfig({ ...keys, CASHFREE_CLIENT_SECRET: ' secret\n' }).CASHFREE_CLIENT_SECRET,
    ).toBe('secret');
    expect(() => loadConfig({ ...keys, CASHFREE_ENV: 'production' })).toThrow(/DEPLOY_ENV/);
    const prod = {
      ...keys,
      NODE_ENV: 'production',
      DEPLOY_ENV: 'production',
      OTP_SENDER: 'whatsapp',
      WHATSAPP_API_SECRET: 's',
      WHATSAPP_ACCOUNT: 'a',
    };
    expect(() => loadConfig(prod)).toThrow(/production keys/);
    expect(loadConfig({ ...prod, CASHFREE_ENV: 'production' }).CASHFREE_ENV).toBe('production');
  });
});

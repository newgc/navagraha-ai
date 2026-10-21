import { schema, type Database } from '@navagraha/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type CapturingOtpSender } from './app.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('OTP sign-in, sessions and roles', () => {
  let app: NestExpressApplication;
  let db: Database;
  let otp: CapturingOtpSender;
  let close: () => Promise<void>;
  let n = 0;
  /** A fresh phone number per test, so rate limits from one test never affect another. */
  let phone: string;

  const http = () => request(app.getHttpServer());
  const requestCode = (p = phone) => http().post('/v1/auth/otp/request').send({ phone: p });
  const verify = (challengeId: string, code: string) =>
    http().post('/v1/auth/otp/verify').send({ challengeId, code });
  async function signIn(p = phone) {
    const r = await requestCode(p).expect(202);
    const v = await verify(r.body.challengeId, otp.last().code).expect(200);
    return v.body as { token: string; user: { id: string; roles: string[] } };
  }
  const audits = async (action: string) =>
    db.select().from(schema.auditLog).where(eq(schema.auditLog.action, action));

  beforeAll(async () => ({ app, db, otp, close } = await createTestApp(url!)));
  afterAll(async () => close?.());
  beforeEach(() => {
    n++;
    phone = `98765${String(n).padStart(5, '0')}`;
  });

  it('signs in a new customer with a 6-digit code', async () => {
    const r = await requestCode().expect(202);
    expect(r.body).toEqual({
      challengeId: expect.any(String),
      expiresAt: expect.any(String),
      channel: 'log',
    });
    expect(otp.last()).toEqual({ phone: `+91${phone}`, code: expect.stringMatching(/^\d{6}$/) });

    const v = await verify(r.body.challengeId, otp.last().code).expect(200);
    expect(v.body.user).toMatchObject({ phone: `+91${phone}`, roles: ['CUSTOMER'] });
    expect(v.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const me = await http()
      .get('/v1/me')
      .set('authorization', `Bearer ${v.body.token}`)
      .expect(200);
    expect(me.body).toMatchObject({ id: v.body.user.id, roles: ['CUSTOMER'] });
    expect((await audits('auth.login')).some((a) => a.actorUserId === v.body.user.id)).toBe(true);
  });

  it('stores neither the code nor the token in plain text', async () => {
    const r = await requestCode().expect(202);
    const code = otp.last().code;
    const [ch] = await db
      .select()
      .from(schema.otpChallenge)
      .where(eq(schema.otpChallenge.id, r.body.challengeId));
    expect(ch!.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(ch!.codeHash).not.toContain(code);
    const v = await verify(r.body.challengeId, code).expect(200);
    const sessions = await db.select().from(schema.authSession);
    expect(sessions.some((s) => s.tokenHash === v.body.token)).toBe(false);
  });

  it('a code works once', async () => {
    const r = await requestCode().expect(202);
    await verify(r.body.challengeId, otp.last().code).expect(200);
    await verify(r.body.challengeId, otp.last().code).expect(400);
  });

  it('locks a challenge after 5 wrong codes, even if the 6th is right', async () => {
    const r = await requestCode().expect(202);
    const right = otp.last().code;
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await verify(r.body.challengeId, wrong).expect(400);
    await verify(r.body.challengeId, right).expect(400);
    expect((await audits('auth.otp_locked')).some((a) => a.entityId === r.body.challengeId)).toBe(
      true,
    );
  });

  it('rejects an expired code', async () => {
    const r = await requestCode().expect(202);
    await db
      .update(schema.otpChallenge)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(eq(schema.otpChallenge.id, r.body.challengeId));
    const v = await verify(r.body.challengeId, otp.last().code).expect(400);
    expect(v.body.message).toMatch(/wrong or has expired/);
  });

  it('rate-limits: 30 s cooldown and 5 codes per number per hour', async () => {
    await requestCode().expect(202);
    await requestCode().expect(429);
    // Age the first request past the cooldown, then fill up the hourly allowance.
    await db
      .update(schema.otpChallenge)
      .set({ createdAt: sql`now() - interval '1 minute'` })
      .where(eq(schema.otpChallenge.phone, `+91${phone}`));
    await db.insert(schema.otpChallenge).values(
      Array.from({ length: 4 }, () => ({
        phone: `+91${phone}`,
        codeHash: 'x',
        expiresAt: new Date(),
        createdAt: new Date(Date.now() - 120_000),
      })),
    );
    const r = await requestCode().expect(429);
    expect(r.body.message).toMatch(/Too many codes/);
  });

  it('rate limits use the visitor address the web app forwards, not the server address', async () => {
    const r = await http()
      .post('/v1/auth/otp/request')
      .set('x-forwarded-for', '203.0.113.7')
      .send({ phone })
      .expect(202);
    const [ch] = await db
      .select()
      .from(schema.otpChallenge)
      .where(eq(schema.otpChallenge.id, r.body.challengeId));
    expect(ch!.requestIp).toBe('203.0.113.7');
  });

  it('validates input', async () => {
    await requestCode('12345').expect(400);
    await http().post('/v1/auth/otp/request').send({}).expect(400);
    await verify('not-a-uuid', '123456').expect(400);
    const r = await requestCode().expect(202);
    await verify(r.body.challengeId, '12345').expect(400);
  });

  it('reports a delivery failure without leaking provider details', async () => {
    otp.fail = true;
    try {
      const r = await requestCode().expect(503);
      expect(r.body.message).toBe('We could not send the code. Please try again.');
    } finally {
      otp.fail = false;
    }
  });

  it('MR-01: a customer that operations created signs in to the same record', async () => {
    const [existing] = await db
      .insert(schema.appUser)
      .values({ phone: `+91${phone}`, displayName: 'Lakshmi (booked by phone)' })
      .returning();
    const s = await signIn();
    expect(s.user.id).toBe(existing!.id);
    expect(
      await db
        .select()
        .from(schema.appUser)
        .where(eq(schema.appUser.phone, `+91${phone}`)),
    ).toHaveLength(1);
  });

  it('disabled accounts cannot sign in', async () => {
    await db.insert(schema.appUser).values({ phone: `+91${phone}`, disabledAt: new Date() });
    const r = await requestCode().expect(202);
    await verify(r.body.challengeId, otp.last().code).expect(403);
  });

  it('protects routes by default and logout revokes the session', async () => {
    await http().get('/v1/me').expect(401);
    await http().get('/v1/me').set('authorization', 'Bearer nonsense').expect(401);
    const s = await signIn();
    const auth = { authorization: `Bearer ${s.token}` };
    await http().get('/v1/me').set(auth).expect(200);
    await http().post('/v1/auth/logout').set(auth).expect(204);
    await http().get('/v1/me').set(auth).expect(401);
  });

  it('RBAC: customers cannot read the audit log; denials are audited (EC-53)', async () => {
    const s = await signIn();
    const auth = { authorization: `Bearer ${s.token}` };
    await http().get('/v1/audit-log').set(auth).expect(403);
    const denied = await audits('security.role_denied');
    expect(denied.some((d) => d.actorUserId === s.user.id)).toBe(true);

    await db.insert(schema.appUserRole).values({ userId: s.user.id, role: 'OPS_MANAGER' });
    const r = await http().get('/v1/audit-log?limit=5').set(auth).expect(200);
    expect(r.body.entries).toHaveLength(5);
    await http().get('/v1/audit-log?limit=500').set(auth).expect(400);
  });

  it('public routes stay public', async () => {
    await http().get('/v1/health').expect(200);
    await http().get('/v1/temples').expect(200);
  });
});

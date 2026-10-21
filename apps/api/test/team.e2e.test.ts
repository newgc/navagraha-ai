import { schema } from '@navagraha/db';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TeamService } from '../src/team/team.service.js';
import { createTestApp, signInAs } from './app.js';

const url = process.env.TEST_DATABASE_URL;
const BOOTSTRAP = '+919000000001';

describe.skipIf(!url)('team and staff roles (MR-36)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  const http = () => request(ctx.app.getHttpServer());

  /**
   * Signs in through the real OTP flow, once per number: the 30 s resend cooldown would refuse
   * a second code. Roles are read per request, so a cached session sees later role changes.
   */
  const sessions = new Map<
    string,
    Promise<{ header: Record<string, string>; user: { id: string; roles: string[] } }>
  >();
  function signInPhone(phone: string) {
    if (!sessions.has(phone)) sessions.set(phone, signInFresh(phone));
    return sessions.get(phone)!;
  }
  async function signInFresh(phone: string) {
    const r = await http().post('/v1/auth/otp/request').send({ phone }).expect(202);
    const v = await http()
      .post('/v1/auth/otp/verify')
      .send({ challengeId: r.body.challengeId, code: ctx.otp.last().code })
      .expect(200);
    return {
      header: { authorization: `Bearer ${v.body.token}` },
      user: v.body.user as { id: string; roles: string[] },
    };
  }

  beforeAll(async () => {
    ctx = await createTestApp(url!, {
      BOOTSTRAP_ADMIN_PHONES: `98765 43210, ${BOOTSTRAP}, not-a-phone`,
    });
  });
  afterAll(async () => ctx?.close());

  it('BOOTSTRAP_ADMIN_PHONES makes the first admins, once, with an audit entry', async () => {
    const admin = await signInPhone(BOOTSTRAP);
    expect(admin.user.roles).toEqual(['CUSTOMER', 'OPS_MANAGER', 'SYSTEM_ADMIN']);

    // Restarting does not grant twice.
    await ctx.app.get(TeamService).onApplicationBootstrap();
    const audits = await ctx.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'security.role_granted'));
    const mine = audits.filter((a) => a.entityId === admin.user.id);
    expect(mine).toHaveLength(2);
    expect(mine[0]!.metadata).toMatchObject({ via: 'bootstrap', phone: '+91******0001' });
  });

  it('a System Admin grants and revokes staff roles; everyone else is refused', async () => {
    const admin = await signInPhone(BOOTSTRAP);
    const coordinator = await signInAs(ctx, ['OPS_COORDINATOR']);
    await http().get('/v1/admin/team').set(coordinator.header).expect(403);

    const r = await http()
      .post('/v1/admin/team/roles')
      .set(admin.header)
      .send({ phone: '98400 55555', role: 'FINANCE', action: 'grant', name: 'Arun' })
      .expect(200);
    expect(r.body.members).toContainEqual(
      expect.objectContaining({ displayName: 'Arun', phone: '+919840055555', roles: ['FINANCE'] }),
    );
    // The new member signs in later with that number and has the role.
    const arun = await signInPhone('+919840055555');
    expect(arun.user.roles).toEqual(['CUSTOMER', 'FINANCE']);
    await http().get('/v1/bookings').set(arun.header).expect(200);

    const after = await http()
      .post('/v1/admin/team/roles')
      .set(admin.header)
      .send({ phone: '+919840055555', role: 'FINANCE', action: 'revoke' })
      .expect(200);
    expect(after.body.members.some((m: { phone: string }) => m.phone === '+919840055555')).toBe(
      false,
    );
    await http()
      .post('/v1/admin/team/roles')
      .set(admin.header)
      .send({ phone: '98400 55555', role: 'CUSTOMER', action: 'grant' })
      .expect(400);
  });

  it('an admin cannot remove their own admin role', async () => {
    const admin = await signInPhone(BOOTSTRAP);
    const r = await http()
      .post('/v1/admin/team/roles')
      .set(admin.header)
      .send({ phone: BOOTSTRAP, role: 'SYSTEM_ADMIN', action: 'revoke' })
      .expect(409);
    expect(r.body.message).toMatch(/your own/);
    // Another admin can.
    const other = await signInPhone('9876543210');
    await http()
      .post('/v1/admin/team/roles')
      .set(other.header)
      .send({ phone: BOOTSTRAP, role: 'SYSTEM_ADMIN', action: 'revoke' })
      .expect(200);
  });

  it('there is always at least one System Admin', async () => {
    // Only +919876543210 is admin now. Grant a second, let them remove the first, then nobody can remove the last.
    const first = await signInPhone('9876543210');
    await http()
      .post('/v1/admin/team/roles')
      .set(first.header)
      .send({ phone: '9000000002', role: 'SYSTEM_ADMIN', action: 'grant' })
      .expect(200);
    const second = await signInPhone('9000000002');
    await http()
      .post('/v1/admin/team/roles')
      .set(second.header)
      .send({ phone: '9876543210', role: 'SYSTEM_ADMIN', action: 'revoke' })
      .expect(200);
    const admins = await ctx.db
      .select()
      .from(schema.appUserRole)
      .where(eq(schema.appUserRole.role, 'SYSTEM_ADMIN'));
    expect(admins).toHaveLength(1);
  });
});

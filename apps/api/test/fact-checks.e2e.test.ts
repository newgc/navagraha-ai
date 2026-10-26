import { schema } from '@navagraha/db';
import { and, eq, inArray, like } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signInAs } from './app.js';
import { NINE, inDays } from './fixtures.js';

const url = process.env.TEST_DATABASE_URL;
const today = new Date().toISOString().slice(0, 10);

describe.skipIf(!url)('data source governance (V2 §8, §26)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let content: Awaited<ReturnType<typeof signInAs>>;
  let manager: Awaited<ReturnType<typeof signInAs>>;
  let coordinator: Awaited<ReturnType<typeof signInAs>>;
  let customer: Awaited<ReturnType<typeof signInAs>>;
  const http = () => request(ctx.app.getHttpServer());
  const SUR = 'TEMPLE:TEM-SUR';
  const MORNING = `SCHEDULE:TEM-SUR|Every day|Morning|2026-01-01`;
  const plan = () =>
    http()
      .post('/v1/planner/plan')
      .set(coordinator.header)
      .send({
        startDate: inDays(21),
        fromPlace: 'HUB-KUM',
        travellers: [{ ageBand: 'ADULT_18_59' }],
      })
      .expect(200);
  const queue = async (view = 'all', temple = 'TEM-SUR') =>
    (
      await http()
        .get(`/v1/admin/temple-data/queue?view=${view}&temple=${temple}`)
        .set(content.header)
        .expect(200)
    ).body;
  const item = async (key: string) =>
    (await queue()).items.find((i: { subjectKey: string }) => i.subjectKey === key);
  const addCheck = (who: { header: Record<string, string> }, body: object) =>
    http().post('/v1/admin/temple-data/checks').set(who.header).send(body);

  beforeAll(async () => {
    ctx = await createTestApp(url!);
    content = await signInAs(ctx, ['CONTENT_ADMIN']);
    manager = await signInAs(ctx, ['OPS_MANAGER']);
    coordinator = await signInAs(ctx, ['OPS_COORDINATOR']);
    customer = await signInAs(ctx, ['CUSTOMER']);

    // Every fact the engine needs, verified from the temple office today.
    const { temple, place, templeSchedule, travelTime } = schema;
    const verified = {
      verificationStatus: 'VERIFIED' as const,
      source: 'Temple office',
      sourceType: 'TEMPLE_OFFICE_PHONE' as const,
      verifiedBy: 'Ravi',
      verifiedOn: today,
    };
    await ctx.db
      .update(temple)
      .set({ visitMinutesNormal: 30, visitMinutesBusy: 60, wheelchairAccess: true, ...verified })
      .where(inArray(temple.code, NINE));
    const temples = await ctx.db.select().from(temple).where(inArray(temple.code, NINE));
    for (const t of temples) {
      await ctx.db.insert(templeSchedule).values([
        {
          templeId: t.id,
          dayType: 'Every day',
          session: 'Morning',
          opensAt: '06:00',
          closesAt: '12:30',
          validFrom: '2026-01-01',
          ...verified,
        },
        {
          templeId: t.id,
          dayType: 'Every day',
          session: 'Evening',
          opensAt: '16:00',
          closesAt: '20:30',
          validFrom: '2026-01-01',
          ...verified,
        },
      ]);
    }
    const places = await ctx.db
      .select()
      .from(place)
      .where(inArray(place.code, [...NINE, 'HUB-KUM']));
    for (const [i, a] of places.entries()) {
      for (const b of places.slice(i + 1)) {
        await ctx.db.insert(travelTime).values({
          fromPlaceId: a.id,
          toPlaceId: b.id,
          normalMinutes: 20,
          symmetric: true,
          ...verified,
          sourceType: 'MAPS_DATED',
        });
      }
    }
  });
  afterAll(async () => ctx?.close());

  it('shows every fact with its source and confidence; staff only', async () => {
    await http().get('/v1/admin/temple-data/queue').set(customer.header).expect(403);
    const sur = await item(SUR);
    expect(sur).toMatchObject({
      confidence: 'VERIFIED',
      sourceLabel: 'Temple office (phone)',
      priority: 2,
      verifiedBy: 'Ravi',
      openChecks: [],
    });
    expect(sur.fields).toContainEqual(
      expect.objectContaining({ field: 'visitMinutesNormal', value: '30' }),
    );
    const all = await queue('all', '');
    const drive = all.items.find((i: { subject: string }) => i.subject === 'TRAVEL_TIME');
    // A verified Google Maps time is usable but labelled as an estimate.
    expect(drive.confidence).toBe('ESTIMATED');
    expect((await plan()).body.status).toBe('OK');
  });

  it('a disagreeing second source makes the fact CONFLICTING and the engine stops using it', async () => {
    const r = await addCheck(coordinator, {
      subjectKey: SUR,
      field: 'visitMinutesNormal',
      value: '45',
      source: 'Our driver Murugan timed it',
      sourceType: 'OPERATIONS_OBSERVATION',
      observedOn: today,
    }).expect(201);
    expect(r.body.agrees).toBe(false);

    const conflicts = await queue('conflicts');
    expect(conflicts.items.map((i: { subjectKey: string }) => i.subjectKey)).toEqual([SUR]);
    expect(conflicts.items[0].openChecks[0]).toMatchObject({
      field: 'visitMinutesNormal',
      value: '45',
      currentValue: '30',
      agrees: false,
      priority: 4,
      canSettle: true,
    });

    const p = await plan();
    expect(p.body.status).toBe('DATA_INCOMPLETE');
    expect(p.body.gaps).toContainEqual(
      expect.objectContaining({ code: 'VISIT_MINUTES_MISSING', temple: 'TEM-SUR' }),
    );
    const overview = await http().get('/v1/admin/temple-data').set(content.header).expect(200);
    expect(overview.body.readiness).toContainEqual(
      expect.objectContaining({
        check: 'Facts with disagreeing sources (V2 §26)',
        done: 1,
        ok: false,
      }),
    );
  });

  it('a check that agrees is not a conflict; bad values and future dates are refused', async () => {
    const same = await addCheck(coordinator, {
      subjectKey: MORNING,
      field: 'opensAt',
      value: '6:00',
      source: 'Temple notice board',
      sourceType: 'TEMPLE_OFFICE_IN_PERSON',
      observedOn: today,
    }).expect(201);
    expect(same.body.agrees).toBe(true);
    expect((await item(MORNING)).confidence).toBe('VERIFIED');
    await addCheck(coordinator, {
      subjectKey: MORNING,
      field: 'opensAt',
      value: 'early',
      source: 'x',
      sourceType: 'OTHER',
      observedOn: today,
    }).expect(422);
    await addCheck(coordinator, {
      subjectKey: MORNING,
      field: 'notAField',
      value: '1',
      source: 'x',
      sourceType: 'OTHER',
      observedOn: today,
    }).expect(400);
    await addCheck(coordinator, {
      subjectKey: MORNING,
      field: 'opensAt',
      value: '06:00',
      source: 'x',
      sourceType: 'OTHER',
      observedOn: inDays(2),
    }).expect(400);
    await addCheck(customer, {
      subjectKey: MORNING,
      field: 'opensAt',
      value: '06:00',
      source: 'x',
      sourceType: 'CUSTOMER_REPORT',
      observedOn: today,
    }).expect(403);
  });

  it('"Update" needs a decider and a source strong enough; then the value changes and is verified', async () => {
    const [check] = (await queue('conflicts')).items[0].openChecks;
    await http()
      .post(`/v1/admin/temple-data/checks/${check.id}/accept`)
      .set(coordinator.header)
      .expect(403);
    await http()
      .post(`/v1/admin/temple-data/checks/${check.id}/accept`)
      .set(manager.header)
      .expect(204);
    const sur = await item(SUR);
    expect(sur.confidence).toBe('OPERATIONAL_CONFIRMED');
    expect(sur.fields).toContainEqual(
      expect.objectContaining({ field: 'visitMinutesNormal', value: '45' }),
    );
    expect(sur.source).toBe('Our driver Murugan timed it');
    expect((await plan()).body.status).toBe('OK');
    await http()
      .post(`/v1/admin/temple-data/checks/${check.id}/accept`)
      .set(manager.header)
      .expect(409);

    // A customer's report can flag a fact, never settle it.
    await addCheck(coordinator, {
      subjectKey: SUR,
      field: 'wheelchairAccess',
      value: 'no',
      source: 'Customer said the ramp is closed',
      sourceType: 'CUSTOMER_REPORT',
      observedOn: today,
    }).expect(201);
    const [weak] = (await item(SUR)).openChecks;
    expect(weak.canSettle).toBe(false);
    await http()
      .post(`/v1/admin/temple-data/checks/${weak.id}/accept`)
      .set(manager.header)
      .expect(422);
  });

  it('"Verify" keeps the current value and closes the disagreeing checks', async () => {
    expect((await item(SUR)).confidence).toBe('CONFLICTING');
    await http()
      .post('/v1/admin/temple-data/facts/verify')
      .set(content.header)
      .send({
        subjectKey: SUR,
        source: 'Called the temple office: ramp open',
        sourceType: 'TEMPLE_OFFICE_PHONE',
        checkedOn: today,
      })
      .expect(204);
    const sur = await item(SUR);
    expect(sur).toMatchObject({ confidence: 'VERIFIED', openChecks: [] });
    const decided = (await queue()).recentDecisions.find(
      (d: { field: string }) => d.field === 'wheelchairAccess',
    );
    expect(decided).toMatchObject({
      status: 'REJECTED',
      decisionNote: expect.stringMatching(/re-verified/),
    });
    await http()
      .post('/v1/admin/temple-data/facts/verify')
      .set(content.header)
      .send({ subjectKey: SUR, source: 'Google', sourceType: 'OTHER', checkedOn: today })
      .expect(422);
  });

  it('"Reject" leaves the value; "Mark conflicting" takes the fact out of planning until re-verified', async () => {
    await addCheck(coordinator, {
      subjectKey: MORNING,
      field: 'closesAt',
      value: '12:00',
      source: 'Old guidebook',
      sourceType: 'OTHER',
      observedOn: today,
    }).expect(201);
    const open = (await item(MORNING)).openChecks.find(
      (c: { field: string }) => c.field === 'closesAt',
    );
    await http()
      .post(`/v1/admin/temple-data/checks/${open.id}/reject`)
      .set(manager.header)
      .send({ reason: 'Guidebook is from 2019' })
      .expect(204);
    expect((await item(MORNING)).confidence).toBe('VERIFIED');

    await http()
      .post('/v1/admin/temple-data/facts/mark-conflicting')
      .set(manager.header)
      .send({ subjectKey: MORNING, note: 'Priest and notice board disagree about Tuesdays' })
      .expect(204);
    expect((await item(MORNING)).confidence).toBe('STALE');
    const [row] = await ctx.db
      .select()
      .from(schema.templeSchedule)
      .innerJoin(schema.temple, eq(schema.temple.id, schema.templeSchedule.templeId))
      .where(and(eq(schema.temple.code, 'TEM-SUR'), eq(schema.templeSchedule.session, 'Morning')));
    expect(row!.temple_schedule.verificationStatus).toBe('NEEDS_RECHECK');

    const audit = await ctx.db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(like(schema.auditLog.action, 'master_data.fact%'));
    expect(new Set(audit.map((a) => a.action))).toEqual(
      new Set([
        'master_data.fact_check_recorded',
        'master_data.fact_check_accepted',
        'master_data.fact_check_rejected',
        'master_data.fact_verified',
        'master_data.fact_marked_conflicting',
      ]),
    );
  });

  it('an upload that brings back a value a person had replaced is flagged, not silently kept', async () => {
    // The workbook still says 30 minutes for Suryanar (accepted 45 above): simulate its upload.
    await ctx.db
      .update(schema.temple)
      .set({ visitMinutesNormal: 30, verifiedOn: today })
      .where(eq(schema.temple.code, 'TEM-SUR'));
    const sur = await item(SUR);
    expect(sur.confidence).toBe('CONFLICTING');
    expect(sur.openChecks).toContainEqual(
      expect.objectContaining({ status: 'ACCEPTED', value: '45', currentValue: '30' }),
    );
    expect((await plan()).body.status).toBe('DATA_INCOMPLETE');

    await http()
      .post('/v1/admin/temple-data/facts/verify')
      .set(content.header)
      .send({
        subjectKey: SUR,
        source: 'Re-timed the visit with the priest',
        sourceType: 'TEMPLE_PRIEST',
        checkedOn: today,
      })
      .expect(204);
    expect((await item(SUR)).confidence).toBe('VERIFIED');
    const [old] = await ctx.db
      .select()
      .from(schema.factCheck)
      .where(and(eq(schema.factCheck.subjectKey, SUR), eq(schema.factCheck.value, '45')));
    expect(old!.status).toBe('SUPERSEDED');
    expect((await plan()).body.status).toBe('OK');
  });

  it('404s facts that no longer exist', async () => {
    await addCheck(coordinator, {
      subjectKey: 'TEMPLE:TEM-NOPE',
      field: 'visitMinutesNormal',
      value: '30',
      source: 'x',
      sourceType: 'OTHER',
      observedOn: today,
    }).expect(404);
  });
});

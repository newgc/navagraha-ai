import { schema } from '@navagraha/db';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signInAs } from './app.js';
import { NINE, inDays, manualBooking } from './fixtures.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('planning engine API (P2, FS §8.2, §9)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let coordinator: Awaited<ReturnType<typeof signInAs>>;
  let customer: Awaited<ReturnType<typeof signInAs>>;
  const http = () => request(ctx.app.getHttpServer());
  const date = inDays(21);
  const planBody = {
    startDate: date,
    fromPlace: 'HUB-KUM',
    travellers: [{ ageBand: 'ADULT_18_59' }, { ageBand: 'ADULT_18_59' }],
  };

  beforeAll(async () => {
    ctx = await createTestApp(url!);
    coordinator = await signInAs(ctx, ['OPS_COORDINATOR']);
    customer = await signInAs(ctx, ['CUSTOMER']);
  });
  afterAll(async () => ctx?.close());

  /** Marks the seeded temples' facts verified: 30-minute visits, two sessions, 15-minute legs. */
  async function verifyFacts() {
    const { temple, place, templeSchedule, travelTime } = schema;
    const temples = await ctx.db.select().from(temple).where(inArray(temple.code, NINE));
    await ctx.db
      .update(temple)
      .set({
        visitMinutesNormal: 30,
        visitMinutesBusy: 60,
        wheelchairAccess: true,
        verificationStatus: 'VERIFIED',
      })
      .where(inArray(temple.code, NINE));
    for (const t of temples) {
      await ctx.db.insert(templeSchedule).values([
        {
          templeId: t.id,
          dayType: 'Every day',
          session: 'Morning',
          opensAt: '06:00',
          closesAt: '12:30',
          validFrom: '2026-01-01',
          verificationStatus: 'VERIFIED',
        },
        {
          templeId: t.id,
          dayType: 'Every day',
          session: 'Evening',
          opensAt: '16:00',
          closesAt: '20:30',
          validFrom: '2026-01-01',
          verificationStatus: 'VERIFIED',
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
          normalMinutes: 15 + ((a.code.length + b.code.length) % 4) * 5,
          symmetric: true,
          verificationStatus: 'VERIFIED',
        });
      }
    }
  }

  it('refuses to plan with unverified data, naming every gap, and records the decision', async () => {
    await http().post('/v1/planner/plan').set(customer.header).send(planBody).expect(403);
    const r = await http()
      .post('/v1/planner/plan')
      .set(coordinator.header)
      .send(planBody)
      .expect(200);
    expect(r.body).toMatchObject({ status: 'DATA_INCOMPLETE', candidates: [], recommended: null });
    expect(r.body.gaps.length).toBeGreaterThan(9);
    expect(r.body.gaps.map((g: { code: string }) => g.code)).toEqual(
      expect.arrayContaining([
        'VISIT_MINUTES_MISSING',
        'OPENING_HOURS_MISSING',
        'TRAVEL_TIME_MISSING',
      ]),
    );
    const [rec] = await ctx.db
      .select()
      .from(schema.decisionRecord)
      .where(eq(schema.decisionRecord.id, r.body.decisionRecordId));
    expect(rec).toMatchObject({
      kind: 'PLAN',
      status: 'DATA_INCOMPLETE',
      factsVersion: 'verified-none',
    });

    const places = await http().get('/v1/planner/places').set(coordinator.header).expect(200);
    expect(places.body.map((p: { code: string }) => p.code)).toContain('ORG-MAA');
  });

  it('plans from verified facts and explains the recommendation', async () => {
    await verifyFacts();
    const r = await http()
      .post('/v1/planner/plan')
      .set(coordinator.header)
      .send(planBody)
      .expect(200);
    expect(r.body.status).toBe('OK');
    expect(r.body.candidates).toHaveLength(5);
    expect(r.body.recommended).toMatch(/^(1D|2D1N)-/);
    expect(r.body.reasons[0]).toMatch(/scores highest/);
    expect(r.body.factsVersion).toMatch(/^verified-20/);
    const best = r.body.candidates.find((c: { id: string }) => c.id === r.body.recommended);
    expect(best.days.flatMap((d: { temples: string[] }) => d.temples).sort()).toEqual(
      [...NINE].sort(),
    );
    expect(r.body.templeNames['TEM-SUR']).toBeTruthy();
  });

  it('marks a proposal ENGINE-checked when its exact itinerary fits, and the booking keeps it', async () => {
    const plan = await http()
      .post('/v1/planner/plan')
      .set(coordinator.header)
      .send(planBody)
      .expect(200);
    const fast = plan.body.candidates.find((c: { id: string }) => c.id === '1D-FAST');
    const order: string[] = fast.days[0].temples;

    const ref = (
      await http()
        .post('/v1/trip-requests')
        .set(customer.header)
        .send({
          startDate: date,
          days: '1',
          pickup: { location: 'Kumbakonam' },
          travellers: [
            { fullName: 'A', ageBand: 'ADULT_18_59', relationshipToBooker: 'SELF' },
            { fullName: 'B', ageBand: 'ADULT_18_59', relationshipToBooker: 'SPOUSE' },
          ],
          purpose: 'ALL_NINE',
          contact: { name: 'A' },
        })
        .expect(201)
    ).body.reference;
    const m = manualBooking();
    const proposal = (stops: string[]) => ({
      trip: { startDate: date, template: '1D', mode: 'FAST', pickupTime: '06:00' },
      travellers: [
        { fullName: 'A', ageBand: 'ADULT_18_59', relationshipToBooker: 'SELF' },
        { fullName: 'B', ageBand: 'ADULT_18_59', relationshipToBooker: 'SPOUSE' },
      ],
      itinerary: {
        stops: stops.map((templeCode) => ({ templeCode, day: 1 })),
        timingsCheckedByCoordinator: true,
      },
      quote: { lines: m.quote.lines, validUntil: m.quote.validUntil },
      engine: { fromPlace: 'HUB-KUM', startTime: '06:00' },
    });

    // An order the engine rejects stays at the D-20 level, with the engine's reason.
    const late = await http()
      .post(`/v1/trip-requests/${ref}/proposals`)
      .set(coordinator.header)
      .send({ ...proposal(order), engine: { fromPlace: 'HUB-KUM', startTime: '19:30' } })
      .expect(201);
    const v1 = late.body.proposals[0].validation;
    expect(v1.level).toBe('STRUCTURAL_WITH_OPS_SIGN_OFF');
    expect(v1.warnings.map((w: { code: string }) => w.code)).toContain('ENGINE_NOT_FEASIBLE');

    const ok = await http()
      .post(`/v1/trip-requests/${ref}/proposals`)
      .set(coordinator.header)
      .send(proposal(order))
      .expect(201);
    expect(ok.body.proposals[1].validation).toMatchObject({
      level: 'ENGINE',
      engineChecked: true,
      decisionRecordId: expect.any(String),
    });

    const view = await http().get(`/v1/my/trip-requests/${ref}`).set(customer.header).expect(200);
    expect(view.body.proposal.checked).toMatch(/verified temple timings/);
    const booked = await http()
      .post(`/v1/my/trip-requests/${ref}/accept`)
      .set(customer.header)
      .send({ version: 2 })
      .expect(200);
    const b = await http()
      .get(`/v1/bookings/${booked.body.bookingReference}`)
      .set(coordinator.header)
      .expect(200);
    expect(b.body.itinerary.validation).toMatchObject({ level: 'ENGINE', engineChecked: true });
    const validated = b.body.history.find(
      (h: { machine: string; to: string }) => h.machine === 'Itinerary' && h.to === 'VALIDATED',
    );
    expect(validated.reason).toMatch(/Engine check passed/);
  });
});

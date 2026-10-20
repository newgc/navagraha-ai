import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { schema } from '@navagraha/db';
import { eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signInAs } from './app.js';

const url = process.env.TEST_DATABASE_URL;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const TEMPLATE = fileURLToPath(
  new URL('../../../data/Navagraha_Temple_Data_Template.xlsx', import.meta.url),
);
const verified = {
  'Source (who / which page)': 'Temple office',
  'Source type': 'Temple office (phone)',
  'Verified by': 'Ravi',
  'Verified on': new Date().toISOString().slice(0, 10).split('-').reverse().join('-'),
  Status: 'Verified',
};

async function workbook(
  fill: (set: (sheet: string, row: number, v: Record<string, unknown>) => void) => void,
) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await readFile(TEMPLATE)) as unknown as ArrayBuffer);
  fill((sheet, row, values) => {
    const ws = wb.getWorksheet(sheet)!;
    const col = new Map<string, number>();
    ws.getRow(1).eachCell((c, i) => col.set(String(c.value), i));
    for (const [h, v] of Object.entries(values))
      ws.getRow(row).getCell(col.get(h)!).value = v as ExcelJS.CellValue;
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe.skipIf(!url)('temple data admin (NAV-TEM-001..003, MR-47..51)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let content: Awaited<ReturnType<typeof signInAs>>;
  let coordinator: Awaited<ReturnType<typeof signInAs>>;
  let finance: Awaited<ReturnType<typeof signInAs>>;
  const http = () => request(ctx.app.getHttpServer());
  const upload = (who: { header: Record<string, string> }, body: Buffer, apply = false) =>
    http()
      .post(`/v1/admin/temple-data/import?fileName=temples.xlsx${apply ? '&apply=true' : ''}`)
      .set(who.header)
      .set('content-type', XLSX)
      .send(body);

  beforeAll(async () => {
    ctx = await createTestApp(url!);
    content = await signInAs(ctx, ['CONTENT_ADMIN']);
    coordinator = await signInAs(ctx, ['OPS_COORDINATOR']);
    finance = await signInAs(ctx, ['FINANCE']);
  });
  afterAll(async () => ctx?.close());

  it('starts with nothing verified and every readiness check open', async () => {
    const r = await http().get('/v1/admin/temple-data').set(coordinator.header).expect(200);
    expect(r.body.circuit).toMatchObject({ code: 'NAVAGRAHA', status: 'DRAFT' });
    expect(r.body.temples).toHaveLength(9);
    expect(r.body.temples[0]).toMatchObject({
      code: 'TEM-SUR',
      verificationStatus: 'TO_COLLECT',
      schedules: { total: 0 },
    });
    expect(r.body.readiness).toEqual([
      { check: 'Temple records verified', done: 0, of: 9, ok: false },
      { check: 'Temples with verified opening hours in force today', done: 0, of: 9, ok: false },
      { check: 'Travel times verified between every pair of temples', done: 0, of: 36, ok: false },
      { check: 'Verified facts due for a re-check', done: 0, of: 0, lowerIsBetter: true, ok: true },
    ]);
  });

  it('is for content and operations staff only', async () => {
    await http().get('/v1/admin/temple-data').expect(401);
    await http().get('/v1/admin/temple-data').set(finance.header).expect(403);
    await http().get('/v1/admin/temple-data').set(content.header).expect(200);
  });

  it('checks an upload without writing, then imports it on apply', async () => {
    const file = await workbook((set) => {
      set('Temples', 8, { 'Official temple name': 'Sri Dharbaranyeswarar Temple', ...verified });
      set('Schedules', 3, {
        'Temple ID': 'TEM-SHA',
        'Day type': 'Every day',
        Session: 'Morning',
        'Opens (HH:MM)': '05:30',
        'Closes (HH:MM)': '12:30',
        'Valid from': '01-01-2026',
        ...verified,
      });
      set('Travel times', 2, { 'Normal drive (min)': 20, ...verified });
    });

    const check = await upload(content, file).expect(200);
    expect(check.body).toMatchObject({ applied: false, errors: 0, counts: { verified: 3 } });
    expect(check.body.summary).toMatch(/Dry run only/);
    const before = await http()
      .get('/v1/admin/temple-data/temples/TEM-SHA')
      .set(content.header)
      .expect(200);
    expect(before.body.schedules).toHaveLength(0);

    const done = await upload(content, file, true).expect(200);
    expect(done.body).toMatchObject({ applied: true, errors: 0 });

    const detail = await http()
      .get('/v1/admin/temple-data/temples/TEM-SHA')
      .set(coordinator.header)
      .expect(200);
    expect(detail.body.temple).toMatchObject({
      officialName: 'Sri Dharbaranyeswarar Temple',
      verificationStatus: 'VERIFIED',
      stale: false,
    });
    expect(detail.body.schedules).toEqual([
      expect.objectContaining({
        opensAt: '05:30:00',
        closesAt: '12:30:00',
        verificationStatus: 'VERIFIED',
      }),
    ]);

    const o = await http().get('/v1/admin/temple-data').set(content.header).expect(200);
    expect(o.body.readiness.slice(0, 3).map((c: { done: number }) => c.done)).toEqual([1, 1, 1]);
    const sha = o.body.temples.find((t: { code: string }) => t.code === 'TEM-SHA');
    expect(sha).toMatchObject({ verificationStatus: 'VERIFIED', currentVerifiedSchedules: 1 });

    const h = await http().get('/v1/admin/temple-data/imports').set(content.header).expect(200);
    expect(h.body.imports[0]).toMatchObject({ fileName: 'temples.xlsx', sha256: done.body.sha256 });
    const [audit] = await ctx.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, done.body.sha256));
    expect(audit?.actorUserId).toBe(content.userId);
  });

  it('only content admins can import; coordinators can look but not change', async () => {
    const file = await workbook(() => {});
    await upload(coordinator, file).expect(403);
  });

  it('reports workbook problems and writes nothing', async () => {
    const file = await workbook((set) => set('Temples', 2, { Latitude: 99, Status: 'Verified' }));
    const r = await upload(content, file, true).expect(200);
    expect(r.body.applied).toBe(false);
    expect(r.body.errors).toBeGreaterThan(0);
    expect(r.body.summary).toMatch(/Nothing was imported/);
  });

  it('rejects files that are not workbooks', async () => {
    await upload(content, Buffer.from('name,phone\nx,y')).expect(400);
    await http()
      .post('/v1/admin/temple-data/import')
      .set(content.header)
      .send({ any: 'json' })
      .expect(400);
  });

  it('EC-49: flags verified facts that are overdue for a re-check', async () => {
    await ctx.db
      .update(schema.temple)
      .set({ verifiedOn: '2025-01-01' })
      .where(eq(schema.temple.code, 'TEM-SHA'));
    const o = await http().get('/v1/admin/temple-data').set(content.header).expect(200);
    expect(o.body.temples.find((t: { code: string }) => t.code === 'TEM-SHA').stale).toBe(true);
    expect(o.body.readiness[3]).toMatchObject({ done: 1, ok: false });
  });

  it('404s unknown temples and 400s malformed codes', async () => {
    await http().get('/v1/admin/temple-data/temples/TEM-XXX').set(content.header).expect(404);
    await http().get('/v1/admin/temple-data/temples/x').set(content.header).expect(400);
  });
});

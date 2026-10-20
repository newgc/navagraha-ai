import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importTempleWorkbook, schema, type Database } from '../src/index.js';
import { freshDatabase } from './reset.js';

const url = process.env.TEST_DATABASE_URL;
const TEMPLATE = fileURLToPath(
  new URL('../../../data/Navagraha_Temple_Data_Template.xlsx', import.meta.url),
);
const TODAY = '2026-10-20';

/** Loads the real template so these tests break if the template and importer drift apart. */
async function template() {
  const wb = new ExcelJS.Workbook();
  // ExcelJS accepts a Node Buffer at runtime; its typings only name ArrayBuffer.
  await wb.xlsx.load((await readFile(TEMPLATE)) as unknown as ArrayBuffer);
  const fill = (sheet: string, row: number, values: Record<string, unknown>) => {
    const ws = wb.getWorksheet(sheet)!;
    const col = new Map<string, number>();
    ws.getRow(1).eachCell((c, i) => col.set(String(c.value), i));
    for (const [header, value] of Object.entries(values)) {
      const i = col.get(header);
      if (!i) throw new Error(`No column "${header}" in ${sheet}`);
      ws.getRow(row).getCell(i).value = value as ExcelJS.CellValue;
    }
  };
  const bytes = async () => new Uint8Array(await wb.xlsx.writeBuffer());
  return { fill, bytes };
}

const verified = {
  'Source (who / which page)': 'Temple office, Mr. Raman',
  'Source type': 'Temple office (phone)',
  'Verified by': 'Ravi',
  'Verified on': '18-10-2026',
  Status: 'Verified',
};

describe.skipIf(!url)('temple workbook import', () => {
  let db: Database;
  let end: () => Promise<void>;
  const run = (data: Uint8Array, apply = true) =>
    importTempleWorkbook(db, data, { apply, actor: 'Test', fileName: 't.xlsx', today: TODAY });

  beforeAll(async () => ({ db, end } = await freshDatabase(url!, { seed: true })));
  afterAll(async () => end?.());
  beforeEach(async () => {
    // Each test starts from the blank template's state.
    const blank = await template();
    await run(await blank.bytes());
  });

  it('accepts the blank template as-is', async () => {
    const r = await run(await (await template()).bytes(), false);
    expect(r.errors).toBe(0);
    expect(r.counts).toMatchObject({ temples: 9, schedules: 0, travelTimes: 50, entryRules: 3 });
  });

  it('imports a filled workbook with typed values and an audit entry', async () => {
    const t = await template();
    t.fill('Temples', 8, {
      'Official temple name': 'Sri Dharbaranyeswarar Temple',
      Latitude: 10.9255,
      Longitude: 79.7951,
      'Wheelchair access possible?': 'No',
      'Typical visit time — normal day (min)': 45,
      ...verified,
    });
    t.fill('Schedules', 3, {
      'Temple ID': 'TEM-SHA',
      'Day type': 'Every day',
      Session: 'Morning',
      'Opens (HH:MM)': '6:00',
      'Closes (HH:MM)': '12:30',
      'Valid from': '01-11-2026',
      ...verified,
    });
    t.fill('Services', 3, {
      'Service ID': 'svc-sha-001',
      'Temple ID': 'TEM-SHA',
      'Service name (as the temple calls it)': 'Archana',
      Type: 'Archana',
      'Temple fee (₹)': 50,
      ...verified,
    });
    t.fill('Services', 4, {
      'Service ID': 'SVC-SHA-002',
      'Temple ID': 'TEM-SHA',
      'Service name (as the temple calls it)': 'Abhishekam',
      Type: 'Abhishekam',
      Status: 'Collected',
    });
    t.fill('Travel times', 2, { 'Normal drive (min)': 25, 'Distance (km)': 14.5, ...verified });

    const r = await run(await t.bytes());
    expect(r.issues).toEqual([]);
    expect(r.applied).toBe(true);
    expect(r.counts.verified).toBe(4);

    const [sha] = await db.select().from(schema.temple).where(eq(schema.temple.code, 'TEM-SHA'));
    expect(sha).toMatchObject({
      officialName: 'Sri Dharbaranyeswarar Temple',
      latitude: 10.9255,
      wheelchairAccess: false,
      visitMinutesNormal: 45,
      verificationStatus: 'VERIFIED',
      sourceType: 'TEMPLE_OFFICE_PHONE',
      verifiedOn: '2026-10-18',
    });
    const [sched] = await db.select().from(schema.templeSchedule);
    expect(sched).toMatchObject({
      opensAt: '06:00:00',
      closesAt: '12:30:00',
      validFrom: '2026-11-01',
    });

    const services = await db.select().from(schema.templeService);
    expect(services.find((s) => s.code === 'SVC-SHA-001')).toMatchObject({
      templeFeePaise: 5000,
      active: true,
    });
    expect(services.find((s) => s.code === 'SVC-SHA-002')?.active).toBe(false);

    const audits = await db.select().from(schema.auditLog);
    expect(audits.at(-1)).toMatchObject({
      action: 'master_data.temple_workbook_import',
      entityId: r.sha256,
      actorRole: 'CONTENT_ADMIN',
    });
  });

  it('re-importing replaces schedules and deactivates removed services', async () => {
    const t = await template();
    t.fill('Schedules', 3, {
      'Temple ID': 'TEM-SUR',
      'Day type': 'Every day',
      Session: 'Morning',
      'Opens (HH:MM)': '06:00',
      'Closes (HH:MM)': '12:00',
      'Valid from': '01-11-2026',
      ...verified,
    });
    t.fill('Services', 3, {
      'Service ID': 'SVC-SUR-001',
      'Temple ID': 'TEM-SUR',
      'Service name (as the temple calls it)': 'Archana',
      Type: 'Archana',
      ...verified,
    });
    await run(await t.bytes());
    await run(await t.bytes());
    expect(await db.select().from(schema.templeSchedule)).toHaveLength(1);

    // beforeEach of the next import: a blank workbook no longer lists the service.
    await run(await (await template()).bytes());
    expect(await db.select().from(schema.templeSchedule)).toHaveLength(0);
    const [svc] = await db
      .select()
      .from(schema.templeService)
      .where(eq(schema.templeService.code, 'SVC-SUR-001'));
    expect(svc?.active).toBe(false);
  });

  it('reports every problem with sheet, row and column, and writes nothing', async () => {
    const t = await template();
    t.fill('Temples', 2, { Latitude: 51.5, Longitude: 79.8, Status: 'Verified' });
    t.fill('Schedules', 3, {
      'Temple ID': 'TEM-XXX',
      'Day type': 'Every day',
      Session: 'Morning',
      'Opens (HH:MM)': '6am',
      'Closes (HH:MM)': '05:00',
      'Valid from': '01-11-2026',
      Status: 'Collected',
    });
    t.fill('Schedules', 4, {
      'Temple ID': 'TEM-SUR',
      'Day type': 'Every day',
      Session: 'Evening',
      'Opens (HH:MM)': '16:00',
      'Closes (HH:MM)': '15:00',
      'Valid from': '01-11-2026',
      'Verified on': '01-01-2027',
      Status: 'Collected',
    });
    t.fill('Services', 3, {
      'Service ID': 'SVC-1',
      'Temple ID': 'TEM-SUR',
      'Service name (as the temple calls it)': 'A',
      Type: 'Archana',
      Status: 'Collected',
    });
    t.fill('Services', 4, {
      'Service ID': 'SVC-1',
      'Temple ID': 'TEM-SUR',
      'Service name (as the temple calls it)': 'B',
      Type: 'Archana',
      Status: 'Collected',
    });

    const r = await run(await t.bytes());
    expect(r.applied).toBe(false);
    const errs = r.issues
      .filter((i) => i.severity === 'error')
      .map((i) => `${i.sheet}:${i.row}:${i.column}`);
    expect(errs).toEqual(
      expect.arrayContaining([
        'Temples:2:Latitude',
        'Temples:2:Source (who / which page)',
        'Temples:2:Source type',
        'Temples:2:Verified by',
        'Temples:2:Verified on',
        'Schedules:3:Temple ID',
        'Schedules:3:Opens (HH:MM)',
        'Schedules:4:Closes (HH:MM)',
        'Schedules:4:Verified on',
        'Services:4:Service ID',
      ]),
    );
    expect(await db.select().from(schema.templeSchedule)).toHaveLength(0);
    const [sur] = await db.select().from(schema.temple).where(eq(schema.temple.code, 'TEM-SUR'));
    expect(sur?.latitude).toBeNull();
  });

  it('rejects a workbook with a missing sheet or column', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Temples').addRow(['Temple ID']);
    const r = await run(new Uint8Array(await wb.xlsx.writeBuffer()), false);
    expect(r.issues.map((i) => i.message)).toEqual(
      expect.arrayContaining([expect.stringMatching(/Missing column/), 'Sheet is missing']),
    );
  });
});

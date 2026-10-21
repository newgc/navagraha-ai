// Prepares the browser-test database before the API starts (Playwright starts its web servers
// before globalSetup, so preparing there would wipe what the API did at startup).
// Plain Node, not Playwright's loader, which cannot load ExcelJS.
//   node e2e/prepare.mjs <otp-outbox> <filled-workbook.xlsx>
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createDb, resetDatabase, schema, seedDatabase } from '@navagraha/db';

const [outbox, workbook] = process.argv.slice(2);
const url = process.env.E2E_DATABASE_URL;
if (!url) throw new Error('Set E2E_DATABASE_URL to a throwaway database (it is wiped)');
const here = import.meta.dirname;

const { db, pool } = createDb(url);
try {
  await resetDatabase(db);
  await seedDatabase(db);
  const staff = JSON.parse(readFileSync(path.join(here, 'staff.json'), 'utf8'));
  for (const s of Object.values(staff)) {
    const [u] = await db
      .insert(schema.appUser)
      .values({ phone: s.phone, displayName: s.name })
      .returning();
    await db.insert(schema.appUserRole).values({ userId: u.id, role: s.role });
  }
} finally {
  await pool.end();
}
mkdirSync(path.dirname(outbox), { recursive: true });
writeFileSync(outbox, '');
execFileSync(process.execPath, [
  path.join(here, 'make-workbook.mjs'),
  path.resolve(here, '../../../data/Navagraha_Temple_Data_Template.xlsx'),
  workbook,
]);

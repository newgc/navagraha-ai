import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDb, resetDatabase, schema, seedDatabase } from '@navagraha/db';
import { OTP_OUTBOX } from '../playwright.config';
import { FILLED_WORKBOOK, STAFF } from './staff';

/** Fresh database with the seed data and two staff members. */
export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error('Set E2E_DATABASE_URL to a throwaway database (it is wiped)');
  const { db, pool } = createDb(url);
  try {
    await resetDatabase(db);
    await seedDatabase(db);
    for (const s of Object.values(STAFF)) {
      const [u] = await db
        .insert(schema.appUser)
        .values({ phone: s.phone, displayName: s.name })
        .returning();
      await db.insert(schema.appUserRole).values({ userId: u!.id, role: s.role });
    }
  } finally {
    await pool.end();
  }
  await mkdir(path.dirname(OTP_OUTBOX), { recursive: true });
  await writeFile(OTP_OUTBOX, '');
  const here = import.meta.dirname;
  execFileSync(process.execPath, [
    path.join(here, 'make-workbook.mjs'),
    path.resolve(here, '../../../data/Navagraha_Temple_Data_Template.xlsx'),
    FILLED_WORKBOOK,
  ]);
}

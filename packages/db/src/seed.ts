import { eq } from 'drizzle-orm';
import type { Database } from './client.js';
import { circuit, circuitTemple, place, temple } from './schema/index.js';

/**
 * Starting master data. Only names, grahas, towns and states are pre-filled — the same
 * grey cells as the temple data workbook. Everything is TO_COLLECT until the content team
 * verifies it; the circuit stays DRAFT until then.
 */
export const NAVAGRAHA_TEMPLES = [
  {
    code: 'TEM-SUR',
    graha: 'Surya (Sun)',
    commonName: 'Suriyanar Kovil',
    town: 'Suriyanar Kovil',
    state: 'Tamil Nadu',
  },
  {
    code: 'TEM-CHA',
    graha: 'Chandra (Moon)',
    commonName: 'Thingalur',
    town: 'Thingalur',
    state: 'Tamil Nadu',
  },
  {
    code: 'TEM-ANG',
    graha: 'Angaraka / Sevvai (Mars)',
    commonName: 'Vaitheeswaran Koil',
    town: 'Vaitheeswaran Koil',
    state: 'Tamil Nadu',
  },
  {
    code: 'TEM-BUD',
    graha: 'Budha (Mercury)',
    commonName: 'Thiruvenkadu',
    town: 'Thiruvenkadu',
    state: 'Tamil Nadu',
  },
  {
    code: 'TEM-GUR',
    graha: 'Guru (Jupiter)',
    commonName: 'Alangudi',
    town: 'Alangudi',
    state: 'Tamil Nadu',
  },
  {
    code: 'TEM-SHU',
    graha: 'Shukra (Venus)',
    commonName: 'Kanjanur',
    town: 'Kanjanur',
    state: 'Tamil Nadu',
  },
  {
    code: 'TEM-SHA',
    graha: 'Shani (Saturn)',
    commonName: 'Thirunallar',
    town: 'Thirunallar',
    state: 'Puducherry (Karaikal)',
  },
  {
    code: 'TEM-RAH',
    graha: 'Rahu',
    commonName: 'Thirunageswaram',
    town: 'Thirunageswaram',
    state: 'Tamil Nadu',
  },
  {
    code: 'TEM-KET',
    graha: 'Ketu',
    commonName: 'Keezhperumpallam',
    town: 'Keezhperumpallam',
    state: 'Tamil Nadu',
  },
] as const;

export const NON_TEMPLE_PLACES = [
  { code: 'HUB-KUM', name: 'Kumbakonam (town centre)', kind: 'HUB' },
  { code: 'ORG-MAA', name: 'Chennai (city)', kind: 'ORIGIN' },
  { code: 'ORG-TRZ', name: 'Tiruchirappalli airport', kind: 'ORIGIN' },
  { code: 'ORG-TJ', name: 'Thanjavur junction (railway)', kind: 'ORIGIN' },
  { code: 'ORG-KMU', name: 'Kumbakonam railway station', kind: 'ORIGIN' },
  { code: 'ORG-MV', name: 'Mayiladuthurai junction (railway)', kind: 'ORIGIN' },
] as const;

/** Idempotent: safe to run on every deploy. Never overwrites edited rows. */
export async function seedDatabase(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(circuit)
      .values({
        code: 'NAVAGRAHA',
        name: 'Navagraha',
        region: 'Kumbakonam, Tamil Nadu',
        status: 'DRAFT',
      })
      .onConflictDoNothing({ target: circuit.code });
    const [nav] = await tx.select().from(circuit).where(eq(circuit.code, 'NAVAGRAHA'));
    if (!nav) throw new Error('Navagraha circuit missing after seed');

    for (const [i, t] of NAVAGRAHA_TEMPLES.entries()) {
      await tx
        .insert(temple)
        .values({ ...t, notes: 'Pre-filled name only — verify all details.' })
        .onConflictDoNothing({ target: temple.code });
      const [row] = await tx.select().from(temple).where(eq(temple.code, t.code));
      if (!row) throw new Error(`Temple ${t.code} missing after seed`);
      await tx
        .insert(circuitTemple)
        .values({ circuitId: nav.id, templeId: row.id, displayOrder: i + 1 })
        .onConflictDoNothing();
      await tx
        .insert(place)
        .values({ code: t.code, name: t.commonName, kind: 'TEMPLE', templeId: row.id })
        .onConflictDoNothing({ target: place.code });
    }
    await tx
      .insert(place)
      .values([...NON_TEMPLE_PLACES])
      .onConflictDoNothing({ target: place.code });
  });
}

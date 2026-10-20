import { schema, type Database } from '@navagraha/db';
import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DB } from '../db/db.module.js';

type TempleRow = typeof schema.temple.$inferSelect;

/**
 * Public view of a temple. Every record carries its verification status: clients must
 * label anything not VERIFIED as unconfirmed and never present it as fact (NAV-AI-007/008,
 * NAV-TEM-003). Internal fields such as who verified it are not exposed.
 */
export function toTempleView(t: TempleRow) {
  return {
    code: t.code,
    graha: t.graha,
    commonName: t.commonName,
    officialName: t.officialName,
    mainDeity: t.mainDeity,
    town: t.town,
    district: t.district,
    state: t.state,
    address: t.address,
    location:
      t.latitude != null && t.longitude != null ? { lat: t.latitude, lng: t.longitude } : null,
    mapsUrl: t.mapsUrl,
    access: {
      walkFromParkingMetres: t.walkFromParkingMetres,
      stepsToClimb: t.stepsToClimb,
      wheelchairAccess: t.wheelchairAccess,
      seatingAvailable: t.seatingAvailable,
      toiletsNearby: t.toiletsNearby,
    },
    visitMinutes: { normal: t.visitMinutesNormal, busy: t.visitMinutesBusy },
    verification: {
      status: t.verificationStatus,
      isVerified: t.verificationStatus === 'VERIFIED',
      source: t.source,
      sourceType: t.sourceType,
      lastVerifiedOn: t.verifiedOn,
    },
  };
}

export type TempleView = ReturnType<typeof toTempleView>;

@Injectable()
export class TemplesService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async listByCircuit(circuitCode: string): Promise<TempleView[] | null> {
    const [c] = await this.db
      .select({ id: schema.circuit.id })
      .from(schema.circuit)
      .where(eq(schema.circuit.code, circuitCode));
    if (!c) return null;
    const rows = await this.db
      .select({ temple: schema.temple })
      .from(schema.circuitTemple)
      .innerJoin(schema.temple, eq(schema.temple.id, schema.circuitTemple.templeId))
      .where(eq(schema.circuitTemple.circuitId, c.id))
      .orderBy(asc(schema.circuitTemple.displayOrder));
    return rows.map((r) => toTempleView(r.temple));
  }

  async getByCode(code: string): Promise<TempleView | null> {
    const [t] = await this.db.select().from(schema.temple).where(eq(schema.temple.code, code));
    return t ? toTempleView(t) : null;
  }
}

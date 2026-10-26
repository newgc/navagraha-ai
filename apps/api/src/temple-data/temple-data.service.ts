import { schema, type Database } from '@navagraha/db';
import { formatReport, importTempleWorkbook } from '@navagraha/db/import';
import { maskPhone } from '@navagraha/domain';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, or } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth.types.js';
import { DB } from '../db/db.module.js';
import { FactChecksService, RECHECK_AFTER_DAYS } from './fact-checks.service.js';

type Status = (typeof schema.verificationStatus.enumValues)[number];
interface Provenanced {
  verificationStatus: Status;
  verifiedOn: string | null;
}

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);

/** Verified, but last checked longer ago than RECHECK_AFTER_DAYS. */
const isStale = (r: Provenanced) =>
  r.verificationStatus === 'VERIFIED' &&
  !!r.verifiedOn &&
  r.verifiedOn < daysAgo(RECHECK_AFTER_DAYS);

function tally(rows: Provenanced[]) {
  return {
    total: rows.length,
    verified: rows.filter((r) => r.verificationStatus === 'VERIFIED').length,
    needsRecheck: rows.filter((r) => r.verificationStatus === 'NEEDS_RECHECK' || isStale(r)).length,
  };
}

/** Read-only views of temple master data plus workbook upload (NAV-TEM-001..003, MR-47..51). */
@Injectable()
export class TempleDataService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(FactChecksService) private readonly checks: FactChecksService,
  ) {}

  private async circuitTemples(circuitCode = 'NAVAGRAHA') {
    const [c] = await this.db
      .select()
      .from(schema.circuit)
      .where(eq(schema.circuit.code, circuitCode));
    if (!c) throw new NotFoundException('Circuit not found');
    const temples = await this.db
      .select({ temple: schema.temple })
      .from(schema.circuitTemple)
      .innerJoin(schema.temple, eq(schema.temple.id, schema.circuitTemple.templeId))
      .where(eq(schema.circuitTemple.circuitId, c.id))
      .orderBy(asc(schema.circuitTemple.displayOrder));
    return { circuit: c, temples: temples.map((t) => t.temple) };
  }

  async overview() {
    const { circuit, temples } = await this.circuitTemples();
    const [schedules, specialDays, services, entryRules, travel, places] = await Promise.all([
      this.db.select().from(schema.templeSchedule),
      this.db.select().from(schema.templeSpecialDay),
      this.db.select().from(schema.templeService),
      this.db.select().from(schema.entryRule),
      this.db.select().from(schema.travelTime),
      this.db.select().from(schema.place),
    ]);
    const now = today();

    const rows = temples.map((t) => {
      const mine = <T extends { templeId: string | null }>(xs: T[]) =>
        xs.filter((x) => x.templeId === t.id);
      const sch = mine(schedules);
      return {
        code: t.code,
        commonName: t.commonName,
        graha: t.graha,
        verificationStatus: t.verificationStatus,
        lastVerifiedOn: t.verifiedOn,
        stale: isStale(t),
        schedules: tally(sch),
        currentVerifiedSchedules: sch.filter(
          (s) =>
            s.verificationStatus === 'VERIFIED' &&
            s.validFrom <= now &&
            (!s.validTo || s.validTo >= now),
        ).length,
        upcomingSpecialDays: mine(specialDays).filter((d) => d.toDate >= now).length,
        services: {
          ...tally(mine(services)),
          active: mine(services).filter((s) => s.active).length,
        },
        entryRules: tally(mine(entryRules)),
      };
    });

    // Travel between every pair of circuit temples, in either direction (36 pairs for nine).
    const placeOfTemple = new Map(places.filter((p) => p.templeId).map((p) => [p.templeId!, p.id]));
    const templePlaceIds = temples
      .map((t) => placeOfTemple.get(t.id))
      .filter((x): x is string => !!x);
    const verifiedPairs = new Set(
      travel
        .filter((tt) => tt.verificationStatus === 'VERIFIED')
        .map((tt) => [tt.fromPlaceId, tt.toPlaceId].sort().join('|')),
    );
    let pairsTotal = 0;
    let pairsVerified = 0;
    for (let i = 0; i < templePlaceIds.length; i++) {
      for (let j = i + 1; j < templePlaceIds.length; j++) {
        pairsTotal++;
        if (verifiedPairs.has([templePlaceIds[i]!, templePlaceIds[j]!].sort().join('|')))
          pairsVerified++;
      }
    }

    const verifiedTemples = rows.filter((r) => r.verificationStatus === 'VERIFIED').length;
    const templesWithHours = rows.filter((r) => r.currentVerifiedSchedules > 0).length;
    const stale =
      rows.filter((r) => r.stale).length + rows.reduce((n, r) => n + r.schedules.needsRecheck, 0);
    const n = temples.length;
    const conflicting = await this.checks.conflictCount();

    return {
      circuit: { code: circuit.code, name: circuit.name, status: circuit.status },
      recheckAfterDays: RECHECK_AFTER_DAYS,
      temples: rows,
      travel: { ...tally(travel), templePairs: { total: pairsTotal, verified: pairsVerified } },
      tripWideEntryRules: tally(entryRules.filter((r) => !r.templeId)),
      // FS §22 pilot readiness: "All nine temple master records have source and verification metadata".
      readiness: [
        { check: 'Temple records verified', done: verifiedTemples, of: n },
        {
          check: 'Temples with verified opening hours in force today',
          done: templesWithHours,
          of: n,
        },
        {
          check: 'Travel times verified between every pair of temples',
          done: pairsVerified,
          of: pairsTotal,
        },
        { check: 'Verified facts due for a re-check', done: stale, of: 0, lowerIsBetter: true },
        {
          check: 'Facts with disagreeing sources (V2 §26)',
          done: conflicting,
          of: 0,
          lowerIsBetter: true,
        },
      ].map((c) => ({ ...c, ok: c.lowerIsBetter ? c.done === 0 : c.of > 0 && c.done === c.of })),
    };
  }

  async temple(code: string) {
    const [t] = await this.db.select().from(schema.temple).where(eq(schema.temple.code, code));
    if (!t) throw new NotFoundException('Temple not found');
    const [p] = await this.db.select().from(schema.place).where(eq(schema.place.templeId, t.id));
    const [schedules, specialDays, services, entryRules, travel, places] = await Promise.all([
      this.db
        .select()
        .from(schema.templeSchedule)
        .where(eq(schema.templeSchedule.templeId, t.id))
        .orderBy(asc(schema.templeSchedule.validFrom), asc(schema.templeSchedule.opensAt)),
      this.db
        .select()
        .from(schema.templeSpecialDay)
        .where(eq(schema.templeSpecialDay.templeId, t.id))
        .orderBy(asc(schema.templeSpecialDay.fromDate)),
      this.db
        .select()
        .from(schema.templeService)
        .where(eq(schema.templeService.templeId, t.id))
        .orderBy(asc(schema.templeService.code)),
      this.db.select().from(schema.entryRule).where(eq(schema.entryRule.templeId, t.id)),
      p
        ? this.db
            .select()
            .from(schema.travelTime)
            .where(
              or(eq(schema.travelTime.fromPlaceId, p.id), eq(schema.travelTime.toPlaceId, p.id)),
            )
        : Promise.resolve([]),
      this.db.select().from(schema.place),
    ]);
    const placeName = new Map(places.map((x) => [x.id, { code: x.code, name: x.name }]));
    const strip = <T extends { templeId: unknown; createdAt: unknown; updatedAt: unknown }>({
      templeId: _a,
      createdAt: _b,
      updatedAt: _c,
      ...rest
    }: T) => ({ ...rest, stale: isStale(rest as unknown as Provenanced) });

    return {
      temple: (({ createdAt: _a, updatedAt: _b, ...rest }) => ({ ...rest, stale: isStale(t) }))(t),
      schedules: schedules.map(strip),
      specialDays: specialDays.map(strip),
      services: services.map(strip),
      entryRules: entryRules.map(strip),
      travel: travel.map((tt) => {
        const otherId = tt.fromPlaceId === p?.id ? tt.toPlaceId : tt.fromPlaceId;
        return {
          other: placeName.get(otherId),
          direction: tt.fromPlaceId === p?.id ? 'from' : 'to',
          distanceKm: tt.distanceKm,
          normalMinutes: tt.normalMinutes,
          peakMinutes: tt.peakMinutes,
          symmetric: tt.symmetric,
          roadNotes: tt.roadNotes,
          verificationStatus: tt.verificationStatus,
          verifiedOn: tt.verifiedOn,
          source: tt.source,
          stale: isStale(tt),
        };
      }),
    };
  }

  async importWorkbook(
    data: Buffer,
    opts: { apply: boolean; fileName: string; auth: AuthContext; correlationId: string },
  ) {
    const [user] = await this.db
      .select()
      .from(schema.appUser)
      .where(eq(schema.appUser.id, opts.auth.userId));
    const actor = user?.displayName ?? (user?.phone ? maskPhone(user.phone) : opts.auth.userId);
    const report = await importTempleWorkbook(this.db, data, {
      apply: opts.apply,
      actor,
      actorUserId: opts.auth.userId,
      fileName: opts.fileName,
      correlationId: opts.correlationId,
    });
    return { ...report, summary: formatReport(report) };
  }

  async imports() {
    const rows = await this.db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.action, 'master_data.temple_workbook_import')))
      .orderBy(desc(schema.auditLog.id))
      .limit(20);
    return {
      imports: rows.map((r) => ({
        at: r.occurredAt,
        sha256: r.entityId,
        ...(r.metadata as {
          actor?: string;
          fileName?: string;
          counts?: Record<string, number>;
          warnings?: number;
        }),
      })),
    };
  }
}

import { createHash, randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import type { Database } from '../client.js';
import {
  auditLog,
  entryRule,
  place,
  temple,
  templeSchedule,
  templeService,
  templeSpecialDay,
  travelTime,
} from '../schema/index.js';
import { parseWorkbook } from './parse.js';
import { readWorkbook, type WorkbookIssue } from './workbook.js';

export type { WorkbookIssue } from './workbook.js';

export interface ImportOptions {
  /** Write to the database. Without it the import only validates (dry run). */
  apply: boolean;
  /** Who ran the import, recorded in the audit log. */
  actor: string;
  /** The signed-in user, when the import comes through the API. */
  actorUserId?: string;
  fileName: string;
  correlationId?: string;
  /** Override "today" (YYYY-MM-DD) for tests. */
  today?: string;
}

export interface ImportReport {
  applied: boolean;
  sha256: string;
  issues: WorkbookIssue[];
  errors: number;
  warnings: number;
  counts: {
    temples: number;
    schedules: number;
    specialDays: number;
    services: number;
    travelTimes: number;
    entryRules: number;
    verified: number;
  };
}

/**
 * Imports the temple data workbook (`data/Navagraha_Temple_Data_Template.xlsx`).
 *
 * The workbook is the master copy of temple operational data. On apply, in one transaction:
 * temples are updated by Temple ID; schedules, special days, travel times and entry rules are
 * replaced; services are upserted by Service ID, and services no longer in the sheet are
 * deactivated rather than deleted. A service is offered (active) only when VERIFIED (NAV-POO-002).
 * Nothing is written if there is any error.
 */
export async function importTempleWorkbook(
  db: Database,
  data: ArrayBuffer | Uint8Array,
  opts: ImportOptions,
): Promise<ImportReport> {
  const sha256 = createHash('sha256')
    .update(new Uint8Array(data as ArrayBuffer))
    .digest('hex');
  const today = opts.today ?? new Date().toISOString().slice(0, 10);

  const [temples, places] = await Promise.all([
    db.select({ id: temple.id, code: temple.code }).from(temple),
    db.select({ id: place.id, code: place.code }).from(place),
  ]);
  const templeId = new Map(temples.map((t) => [t.code, t.id]));
  const placeId = new Map(places.map((p) => [p.code, p.id]));

  const { raw, issues: structural } = await readWorkbook(data);
  const parsed = parseWorkbook(raw, {
    templeCodes: new Set(templeId.keys()),
    placeCodes: new Set(placeId.keys()),
    today,
  });
  const issues = [...structural, ...parsed.issues];
  const errors = issues.filter((i) => i.severity === 'error').length;
  const all = [
    ...parsed.temples,
    ...parsed.schedules,
    ...parsed.specialDays,
    ...parsed.services,
    ...parsed.travelTimes,
    ...parsed.entryRules,
  ];
  const report: ImportReport = {
    applied: false,
    sha256,
    issues,
    errors,
    warnings: issues.length - errors,
    counts: {
      temples: parsed.temples.length,
      schedules: parsed.schedules.length,
      specialDays: parsed.specialDays.length,
      services: parsed.services.length,
      travelTimes: parsed.travelTimes.length,
      entryRules: parsed.entryRules.length,
      verified: all.filter((r) => r.verificationStatus === 'VERIFIED').length,
    },
  };
  if (!opts.apply || errors > 0) return report;

  // After validation every required reference below is present and known.
  const tid = (code: string | null) => templeId.get(code!)!;
  const pid = (code: string | null) => placeId.get(code!)!;

  await db.transaction(async (tx) => {
    for (const { code, commonName, ...fields } of parsed.temples) {
      await tx
        .update(temple)
        .set({ commonName: commonName!, ...fields })
        .where(eq(temple.code, code!));
    }

    await tx.delete(templeSchedule);
    if (parsed.schedules.length) {
      await tx.insert(templeSchedule).values(
        parsed.schedules.map(
          ({ templeCode, dayType, session, opensAt, closesAt, validFrom, ...rest }) => ({
            ...rest,
            templeId: tid(templeCode),
            dayType: dayType!,
            session: session!,
            opensAt: opensAt!,
            closesAt: closesAt!,
            validFrom: validFrom!,
          }),
        ),
      );
    }

    await tx.delete(templeSpecialDay);
    if (parsed.specialDays.length) {
      await tx.insert(templeSpecialDay).values(
        parsed.specialDays.map(({ templeCode, name, kind, fromDate, toDate, effect, ...rest }) => ({
          ...rest,
          templeId: tid(templeCode),
          name: name!,
          kind: kind!,
          fromDate: fromDate!,
          toDate: toDate!,
          effect: effect!,
        })),
      );
    }

    const serviceCodes = parsed.services.map((s) => s.code!);
    for (const { code, templeCode, name, kind, ...rest } of parsed.services) {
      const values = {
        ...rest,
        templeId: tid(templeCode),
        name: name!,
        kind: kind!,
        active: rest.verificationStatus === 'VERIFIED',
      };
      await tx
        .insert(templeService)
        .values({ code: code!, ...values })
        .onConflictDoUpdate({ target: templeService.code, set: values });
    }
    const stale = (await tx.select({ code: templeService.code }).from(templeService))
      .map((s) => s.code)
      .filter((c) => !serviceCodes.includes(c));
    if (stale.length) {
      await tx
        .update(templeService)
        .set({ active: false })
        .where(inArray(templeService.code, stale));
    }

    await tx.delete(travelTime);
    if (parsed.travelTimes.length) {
      await tx.insert(travelTime).values(
        parsed.travelTimes.map(({ fromCode, toCode, ...rest }) => ({
          ...rest,
          fromPlaceId: pid(fromCode),
          toPlaceId: pid(toCode),
        })),
      );
    }

    await tx.delete(entryRule);
    if (parsed.entryRules.length) {
      await tx.insert(entryRule).values(
        parsed.entryRules.map(({ templeCode, category, rule, ...rest }) => ({
          ...rest,
          templeId: templeCode ? tid(templeCode) : null,
          category: category!,
          rule: rule!,
        })),
      );
    }

    await tx.insert(auditLog).values({
      action: 'master_data.temple_workbook_import',
      actorUserId: opts.actorUserId ?? null,
      actorRole: 'CONTENT_ADMIN',
      entityType: 'temple_workbook',
      entityId: sha256,
      correlationId: opts.correlationId ?? randomUUID(),
      metadata: {
        actor: opts.actor,
        fileName: opts.fileName,
        counts: report.counts,
        warnings: report.warnings,
      },
    });
  });

  return { ...report, applied: true };
}

/** Human-readable report for the CLI. */
export function formatReport(r: ImportReport): string {
  const lines = [
    `File SHA-256: ${r.sha256}`,
    `Rows: ${Object.entries(r.counts)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}`,
    `${r.errors} error(s), ${r.warnings} warning(s)`,
  ];
  for (const i of r.issues) {
    const where = [i.sheet, i.row && `row ${i.row}`, i.column].filter(Boolean).join(', ');
    lines.push(`  ${i.severity === 'error' ? 'ERROR  ' : 'warning'} ${where}: ${i.message}`);
  }
  lines.push(
    r.applied
      ? 'Imported.'
      : r.errors > 0
        ? 'Nothing was imported. Fix the errors and run again.'
        : 'Dry run only — nothing was written. Run again with --apply to import.',
  );
  return lines.join('\n');
}

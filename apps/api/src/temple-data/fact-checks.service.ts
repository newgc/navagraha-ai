import { schema, type Database } from '@navagraha/db';
import {
  FACT_FIELDS,
  SOURCE_LABELS,
  SOURCE_PRIORITY,
  canVerify,
  canonicalStored,
  confidenceOf,
  displayFactValue,
  fieldOf,
  normalizeFactValue,
  storedValue,
  maskPhone,
  type Confidence,
  type FactSubject,
  type SourceType,
  type WorkflowStatus,
} from '@navagraha/domain';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { desc, eq, inArray } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { DB } from '../db/db.module.js';

/**
 * Facts not re-verified within this many days are flagged for a re-check (EC-49).
 * A default for the pilot, not an approved policy — change it here if operations want another.
 */
export const RECHECK_AFTER_DAYS = 180;

const { factCheck, temple, templeSchedule, templeSpecialDay, templeService, travelTime, place } =
  schema;

type Check = typeof factCheck.$inferSelect;
type Table =
  | typeof temple
  | typeof templeSchedule
  | typeof templeSpecialDay
  | typeof templeService
  | typeof travelTime;

/** One row of temple data, seen as a set of checkable facts. */
export interface FactRow {
  subject: FactSubject;
  subjectKey: string;
  rowId: string;
  templeCode: string | null;
  title: string;
  /** Canonical current values by field. */
  values: Record<string, string | null>;
  source: string | null;
  sourceType: SourceType | null;
  verifiedBy: string | null;
  verifiedOn: string | null;
  verificationStatus: WorkflowStatus;
}

const today = () => new Date().toISOString().slice(0, 10);

const TABLES: Record<FactSubject, Table> = {
  TEMPLE: temple,
  SCHEDULE: templeSchedule,
  SPECIAL_DAY: templeSpecialDay,
  SERVICE: templeService,
  TRAVEL_TIME: travelTime,
};

/** The natural keys that survive a workbook import (which replaces rows). */
export const subjectKeys = {
  temple: (code: string) => `TEMPLE:${code}`,
  schedule: (code: string, dayType: string, session: string, validFrom: string) =>
    `SCHEDULE:${code}|${dayType}|${session}|${validFrom}`,
  specialDay: (code: string, name: string, fromDate: string) =>
    `SPECIAL_DAY:${code}|${name}|${fromDate}`,
  service: (code: string) => `SERVICE:${code}`,
  travel: (from: string, to: string) => `TRAVEL_TIME:${from}|${to}`,
};

/**
 * Data source governance (V2 §8, §26): second-source checks of single facts, conflicts,
 * the verification queue and its four actions. The workbook stays the master copy; a value
 * changed here that the workbook still disagrees with shows up as a conflict after the next
 * import, so nothing is silently lost either way.
 */
@Injectable()
export class FactChecksService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Every checkable row of temple data, with its current values. */
  async rows(): Promise<FactRow[]> {
    const [temples, schedules, specials, services, travel, places] = await Promise.all([
      this.db.select().from(temple),
      this.db.select().from(templeSchedule),
      this.db.select().from(templeSpecialDay),
      this.db.select().from(templeService),
      this.db.select().from(travelTime),
      this.db.select().from(place),
    ]);
    const code = new Map(temples.map((t) => [t.id, t.code]));
    const name = new Map(temples.map((t) => [t.id, t.commonName]));
    const placeById = new Map(places.map((p) => [p.id, p]));
    const values = (subject: FactSubject, row: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(FACT_FIELDS[subject]).map(([field, f]) => [
          field,
          canonicalStored(f.type, row[field]),
        ]),
      );
    const provenance = (r: {
      source: string | null;
      sourceType: string | null;
      verifiedBy: string | null;
      verifiedOn: string | null;
      verificationStatus: string;
    }) => ({
      source: r.source,
      sourceType: r.sourceType as SourceType | null,
      verifiedBy: r.verifiedBy,
      verifiedOn: r.verifiedOn,
      verificationStatus: r.verificationStatus as WorkflowStatus,
    });

    return [
      ...temples.map((t) => ({
        subject: 'TEMPLE' as const,
        subjectKey: subjectKeys.temple(t.code),
        rowId: t.id,
        templeCode: t.code,
        title: `${t.commonName} — temple details`,
        values: values('TEMPLE', t),
        ...provenance(t),
      })),
      ...schedules.map((s) => ({
        subject: 'SCHEDULE' as const,
        subjectKey: subjectKeys.schedule(code.get(s.templeId)!, s.dayType, s.session, s.validFrom),
        rowId: s.id,
        templeCode: code.get(s.templeId) ?? null,
        title: `${name.get(s.templeId)} — ${s.session} hours (${s.dayType}, from ${s.validFrom})`,
        values: values('SCHEDULE', s),
        ...provenance(s),
      })),
      ...specials.map((s) => ({
        subject: 'SPECIAL_DAY' as const,
        subjectKey: subjectKeys.specialDay(code.get(s.templeId)!, s.name, s.fromDate),
        rowId: s.id,
        templeCode: code.get(s.templeId) ?? null,
        title: `${name.get(s.templeId)} — ${s.name} (${s.fromDate})`,
        values: values('SPECIAL_DAY', s),
        ...provenance(s),
      })),
      ...services.map((s) => ({
        subject: 'SERVICE' as const,
        subjectKey: subjectKeys.service(s.code),
        rowId: s.id,
        templeCode: code.get(s.templeId) ?? null,
        title: `${name.get(s.templeId)} — ${s.name}`,
        values: values('SERVICE', s),
        ...provenance(s),
      })),
      ...travel.map((tt) => {
        const from = placeById.get(tt.fromPlaceId);
        const to = placeById.get(tt.toPlaceId);
        return {
          subject: 'TRAVEL_TIME' as const,
          subjectKey: subjectKeys.travel(from?.code ?? '?', to?.code ?? '?'),
          rowId: tt.id,
          templeCode: null,
          title: `Drive ${from?.name ?? '?'} → ${to?.name ?? '?'}`,
          values: values('TRAVEL_TIME', tt),
          ...provenance(tt),
        };
      }),
    ];
  }

  /**
   * The checks that bear on today's values: every open one, and the latest accepted one per
   * fact — so a workbook upload that brings back a value a person had replaced shows up.
   */
  private async liveChecks() {
    const rows = await this.db
      .select()
      .from(factCheck)
      .where(inArray(factCheck.status, ['OPEN', 'ACCEPTED']))
      .orderBy(desc(factCheck.decidedAt));
    const latestAccepted = new Set<string>();
    return rows.filter((c) => {
      if (c.status === 'OPEN') return true;
      const k = `${c.subjectKey}#${c.field}`;
      if (latestAccepted.has(k)) return false;
      latestAccepted.add(k);
      return true;
    });
  }

  /** Live checks whose value differs from the current one, by `subjectKey`. */
  private disagreements(rows: FactRow[], checks: Check[]) {
    const byKey = new Map(rows.map((r) => [r.subjectKey, r]));
    const out = new Map<string, Check[]>();
    for (const c of checks) {
      const row = byKey.get(c.subjectKey);
      // A check for a row the workbook no longer has disagrees with nothing.
      if (!row || row.values[c.field] === c.value) continue;
      out.set(c.subjectKey, [...(out.get(c.subjectKey) ?? []), c]);
    }
    return out;
  }

  /**
   * For the planning engine: the facts it must not use because sources disagree. A temple's
   * single fields are dropped one by one; other rows are dropped whole.
   */
  async conflicts(): Promise<{ rowIds: Set<string>; templeFields: Map<string, Set<string>> }> {
    const checks = await this.liveChecks();
    const rowIds = new Set<string>();
    const templeFields = new Map<string, Set<string>>();
    if (!checks.length) return { rowIds, templeFields };
    const rows = await this.rows();
    for (const [key, list] of this.disagreements(rows, checks)) {
      const row = rows.find((r) => r.subjectKey === key)!;
      if (row.subject === 'TEMPLE') {
        templeFields.set(row.templeCode!, new Set(list.map((c) => c.field)));
      } else {
        rowIds.add(row.rowId);
      }
    }
    return { rowIds, templeFields };
  }

  /** How many facts have disagreeing sources (for the readiness checks). */
  async conflictCount() {
    const checks = await this.liveChecks();
    if (!checks.length) return 0;
    return this.disagreements(await this.rows(), checks).size;
  }

  /**
   * The Data Verification Queue (V2 §26): conflicts first, then facts due for a re-check,
   * then facts not yet verified. Each item says what is known, from where, and what disagrees.
   */
  async queue(view: 'conflicts' | 'recheck' | 'unverified' | 'all' = 'all', templeCode?: string) {
    const [rows, checks, recent] = await Promise.all([
      this.rows(),
      this.liveChecks(),
      this.db.select().from(factCheck).orderBy(desc(factCheck.updatedAt)).limit(200),
    ]);
    const disagree = this.disagreements(rows, checks);
    const now = today();
    const users = await this.userNames([
      ...new Set([...checks, ...recent].flatMap((c) => [c.recordedByUserId, c.decidedByUserId])),
    ]);
    const describe = (c: Check, row: FactRow | undefined) => {
      const f = fieldOf(c.subject, c.field);
      return {
        id: c.id,
        field: c.field,
        fieldLabel: f?.label ?? c.field,
        value: displayFactValue(f?.type ?? 'text', c.value),
        currentValue: displayFactValue(f?.type ?? 'text', row?.values[c.field] ?? null),
        agrees: row ? row.values[c.field] === c.value : null,
        source: c.source,
        sourceType: c.sourceType,
        sourceLabel: SOURCE_LABELS[c.sourceType as SourceType],
        priority: SOURCE_PRIORITY[c.sourceType as SourceType],
        canSettle: canVerify(c.sourceType as SourceType),
        sourceUrl: c.sourceUrl,
        observedOn: c.observedOn,
        note: c.note,
        status: c.status,
        recordedBy: users.get(c.recordedByUserId) ?? null,
        decidedBy: c.decidedByUserId ? (users.get(c.decidedByUserId) ?? null) : null,
        decidedAt: c.decidedAt,
        decisionNote: c.decisionNote,
      };
    };

    const items = rows
      .filter((r) => !templeCode || r.templeCode === templeCode)
      .map((r) => {
        const confidence: Confidence = confidenceOf(r, {
          conflicting: disagree.has(r.subjectKey),
          today: now,
          recheckAfterDays: RECHECK_AFTER_DAYS,
        });
        return {
          subject: r.subject,
          subjectKey: r.subjectKey,
          templeCode: r.templeCode,
          title: r.title,
          confidence,
          fields: Object.entries(FACT_FIELDS[r.subject]).map(([field, f]) => ({
            field,
            label: f.label,
            type: f.type,
            value: displayFactValue(f.type, r.values[field] ?? null),
          })),
          source: r.source,
          sourceType: r.sourceType,
          sourceLabel: r.sourceType ? SOURCE_LABELS[r.sourceType] : null,
          priority: r.sourceType ? SOURCE_PRIORITY[r.sourceType] : null,
          verifiedBy: r.verifiedBy,
          verifiedOn: r.verifiedOn,
          verificationStatus: r.verificationStatus,
          // Open checks, and accepted values the current data no longer matches.
          openChecks: checks
            .filter(
              (c) =>
                c.subjectKey === r.subjectKey &&
                (c.status === 'OPEN' || r.values[c.field] !== c.value),
            )
            .map((c) => describe(c, r)),
        };
      });
    const rank: Record<Confidence, number> = {
      CONFLICTING: 0,
      STALE: 1,
      UNCONFIRMED: 2,
      ESTIMATED: 3,
      OPERATIONAL_CONFIRMED: 4,
      VERIFIED: 5,
    };
    const wanted = (c: Confidence) =>
      view === 'all'
        ? true
        : view === 'conflicts'
          ? c === 'CONFLICTING'
          : view === 'recheck'
            ? c === 'STALE'
            : c === 'UNCONFIRMED' || c === 'ESTIMATED';
    const counts = Object.fromEntries(
      (Object.keys(rank) as Confidence[]).map((c) => [
        c,
        items.filter((i) => i.confidence === c).length,
      ]),
    ) as Record<Confidence, number>;
    const byKey = new Map(rows.map((r) => [r.subjectKey, r]));
    return {
      view,
      recheckAfterDays: RECHECK_AFTER_DAYS,
      counts,
      items: items
        .filter((i) => wanted(i.confidence))
        .sort((a, b) => rank[a.confidence] - rank[b.confidence] || a.title.localeCompare(b.title)),
      recentDecisions: recent
        .filter((c) => c.status !== 'OPEN')
        .slice(0, 20)
        .map((c) => ({ ...describe(c, byKey.get(c.subjectKey)), subjectKey: c.subjectKey })),
    };
  }

  // ---------------------------------------------------------------- actions

  /** Records a second source for one fact. Anyone in operations may; it decides nothing. */
  async addCheck(
    input: {
      subjectKey: string;
      field: string;
      value: string;
      source: string;
      sourceType: SourceType;
      sourceUrl?: string;
      observedOn: string;
      note?: string;
    },
    auth: AuthContext,
    correlationId: string,
  ) {
    const row = await this.row(input.subjectKey);
    const f = fieldOf(row.subject, input.field);
    if (!f) throw new BadRequestException(`${input.field} is not a fact that can be checked here`);
    const v = normalizeFactValue(f.type, input.value);
    if ('error' in v) throw new UnprocessableEntityException(`${f.label} ${v.error}`);
    if (input.observedOn > today())
      throw new BadRequestException('The check date is in the future');
    const [c] = await this.db
      .insert(factCheck)
      .values({
        subject: row.subject,
        subjectKey: row.subjectKey,
        templeCode: row.templeCode,
        field: input.field,
        value: v.value,
        source: input.source,
        sourceType: input.sourceType,
        sourceUrl: input.sourceUrl ?? null,
        observedOn: input.observedOn,
        note: input.note ?? null,
        recordedByUserId: auth.userId,
      })
      .returning();
    await this.audit.record({
      action: 'master_data.fact_check_recorded',
      correlationId,
      actorUserId: auth.userId,
      entityType: 'fact_check',
      entityId: c!.id,
      metadata: {
        subjectKey: row.subjectKey,
        field: input.field,
        value: v.value,
        current: row.values[input.field] ?? null,
        sourceType: input.sourceType,
      },
    });
    return { id: c!.id, agrees: row.values[input.field] === v.value };
  }

  /**
   * "Update": the check's value is right. It becomes the current value, verified from the
   * check's source — which must be strong enough to verify (priority 1–4).
   */
  async accept(checkId: string, auth: AuthContext, correlationId: string) {
    const c = await this.openCheck(checkId);
    if (!canVerify(c.sourceType as SourceType)) {
      throw new UnprocessableEntityException(
        `A ${SOURCE_LABELS[c.sourceType as SourceType].toLowerCase()} cannot verify a fact; check it with a stronger source first`,
      );
    }
    const row = await this.row(c.subjectKey);
    const f = fieldOf(row.subject, c.field)!;
    const who = await this.actorName(auth.userId);
    await this.db.transaction(async (tx) => {
      const table = TABLES[row.subject];
      await tx
        .update(table)
        .set({
          [c.field]: storedValue(f.type, c.value),
          source: c.source,
          sourceType: c.sourceType,
          verifiedBy: who,
          verifiedOn: c.observedOn,
          verificationStatus: 'VERIFIED',
        } as never)
        .where(eq(table.id, row.rowId));
      await tx
        .update(factCheck)
        .set({ status: 'ACCEPTED', decidedByUserId: auth.userId, decidedAt: new Date() })
        .where(eq(factCheck.id, c.id));
      await this.audit.record(
        {
          action: 'master_data.fact_check_accepted',
          correlationId,
          actorUserId: auth.userId,
          entityType: 'fact_check',
          entityId: c.id,
          before: { [c.field]: row.values[c.field] ?? null, verifiedOn: row.verifiedOn },
          after: { [c.field]: c.value, verifiedOn: c.observedOn },
          metadata: { subjectKey: row.subjectKey },
        },
        tx,
      );
    });
  }

  /** "Reject": the check is wrong or unreliable; the current value stays. */
  async reject(checkId: string, reason: string, auth: AuthContext, correlationId: string) {
    const c = await this.openCheck(checkId);
    await this.db.transaction(async (tx) => {
      await tx
        .update(factCheck)
        .set({
          status: 'REJECTED',
          decidedByUserId: auth.userId,
          decidedAt: new Date(),
          decisionNote: reason,
        })
        .where(eq(factCheck.id, c.id));
      await this.audit.record(
        {
          action: 'master_data.fact_check_rejected',
          correlationId,
          actorUserId: auth.userId,
          entityType: 'fact_check',
          entityId: c.id,
          metadata: { subjectKey: c.subjectKey, field: c.field, reason },
        },
        tx,
      );
    });
  }

  /**
   * "Verify": a person re-checked the current values with a source today (or on `checkedOn`).
   * Open checks that disagree are closed as rejected, because the person chose the current value.
   */
  async verify(
    input: {
      subjectKey: string;
      source: string;
      sourceType: SourceType;
      checkedOn: string;
      note?: string;
    },
    auth: AuthContext,
    correlationId: string,
  ) {
    if (!canVerify(input.sourceType)) {
      throw new UnprocessableEntityException(
        `A ${SOURCE_LABELS[input.sourceType].toLowerCase()} cannot verify a fact`,
      );
    }
    if (input.checkedOn > today()) throw new BadRequestException('The check date is in the future');
    const row = await this.row(input.subjectKey);
    const who = await this.actorName(auth.userId);
    const live = (await this.liveChecks()).filter((c) => c.subjectKey === row.subjectKey);
    const open = live.filter((c) => c.status === 'OPEN');
    const overruled = open.filter((c) => row.values[c.field] !== c.value);
    // Values accepted earlier that the person now replaces with the current ones.
    const superseded = live.filter(
      (c) => c.status === 'ACCEPTED' && row.values[c.field] !== c.value,
    );
    await this.db.transaction(async (tx) => {
      const table = TABLES[row.subject];
      await tx
        .update(table)
        .set({
          source: input.source,
          sourceType: input.sourceType,
          verifiedBy: who,
          verifiedOn: input.checkedOn,
          verificationStatus: 'VERIFIED',
        } as never)
        .where(eq(table.id, row.rowId));
      if (overruled.length) {
        await tx
          .update(factCheck)
          .set({
            status: 'REJECTED',
            decidedByUserId: auth.userId,
            decidedAt: new Date(),
            decisionNote: `Current value re-verified (${SOURCE_LABELS[input.sourceType]}: ${input.source})`,
          })
          .where(
            inArray(
              factCheck.id,
              overruled.map((c) => c.id),
            ),
          );
      }
      if (superseded.length) {
        await tx
          .update(factCheck)
          .set({
            status: 'SUPERSEDED',
            decisionNote: `Replaced by the current value, re-verified ${input.checkedOn}`,
          })
          .where(
            inArray(
              factCheck.id,
              superseded.map((c) => c.id),
            ),
          );
      }
      {
        const agreeing = open.filter((c) => !overruled.includes(c)).map((c) => c.id);
        if (agreeing.length) {
          await tx
            .update(factCheck)
            .set({ status: 'ACCEPTED', decidedByUserId: auth.userId, decidedAt: new Date() })
            .where(inArray(factCheck.id, agreeing));
        }
      }
      await this.audit.record(
        {
          action: 'master_data.fact_verified',
          correlationId,
          actorUserId: auth.userId,
          entityType: row.subject.toLowerCase(),
          entityId: row.rowId,
          before: { verificationStatus: row.verificationStatus, verifiedOn: row.verifiedOn },
          after: { verificationStatus: 'VERIFIED', verifiedOn: input.checkedOn },
          metadata: {
            subjectKey: row.subjectKey,
            sourceType: input.sourceType,
            overruledChecks: overruled.map((c) => c.id),
            supersededChecks: superseded.map((c) => c.id),
            note: input.note ?? null,
          },
        },
        tx,
      );
    });
  }

  /**
   * "Mark conflicting": sources disagree and nobody can settle it yet. The row needs a
   * re-check, so the engine stops using it until someone verifies it again.
   */
  async markConflicting(
    input: { subjectKey: string; note: string },
    auth: AuthContext,
    correlationId: string,
  ) {
    const row = await this.row(input.subjectKey);
    if (row.verificationStatus === 'NEEDS_RECHECK') {
      throw new ConflictException('Already marked for a re-check');
    }
    await this.db.transaction(async (tx) => {
      const table = TABLES[row.subject];
      await tx
        .update(table)
        .set({ verificationStatus: 'NEEDS_RECHECK' } as never)
        .where(eq(table.id, row.rowId));
      await this.audit.record(
        {
          action: 'master_data.fact_marked_conflicting',
          correlationId,
          actorUserId: auth.userId,
          entityType: row.subject.toLowerCase(),
          entityId: row.rowId,
          before: { verificationStatus: row.verificationStatus },
          after: { verificationStatus: 'NEEDS_RECHECK' },
          metadata: { subjectKey: row.subjectKey, note: input.note },
        },
        tx,
      );
    });
  }

  // ---------------------------------------------------------------- helpers

  private async row(subjectKey: string) {
    const row = (await this.rows()).find((r) => r.subjectKey === subjectKey);
    if (!row) {
      throw new NotFoundException(
        'That fact is not in the temple data any more (the workbook was re-imported?)',
      );
    }
    return row;
  }

  private async openCheck(id: string) {
    const [c] = await this.db.select().from(factCheck).where(eq(factCheck.id, id));
    if (!c) throw new NotFoundException('Check not found');
    if (c.status !== 'OPEN') throw new ConflictException(`This check is already ${c.status}`);
    return c;
  }

  private async actorName(userId: string) {
    return (await this.userNames([userId])).get(userId) ?? userId;
  }

  private async userNames(ids: (string | null)[]) {
    const wanted = ids.filter((x): x is string => !!x);
    if (!wanted.length) return new Map<string, string>();
    const users = await this.db
      .select()
      .from(schema.appUser)
      .where(inArray(schema.appUser.id, wanted));
    return new Map(
      users.map((u) => [u.id, u.displayName ?? (u.phone ? maskPhone(u.phone) : u.id)]),
    );
  }
}

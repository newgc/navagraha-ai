import { schema, type Database } from '@navagraha/db';
import {
  DEFAULT_ENGINE_CONFIG,
  evaluateItinerary,
  planTrip,
  travelKey,
  type EvaluateRequest,
  type EvaluateResult,
  type PlanRequest,
  type PlanResult,
  type PlanningFacts,
} from '@navagraha/domain';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { DB } from '../db/db.module.js';
import { FactChecksService } from '../temple-data/fact-checks.service.js';

const { circuit, circuitTemple, temple, place, templeSchedule, templeSpecialDay, travelTime } =
  schema;

const VERIFIED = 'VERIFIED' as const;

/**
 * The planning engine (FS §9, P2) over the verified temple data. Only VERIFIED rows are
 * used; everything else is a data gap the result names (NAV-AI-007). Every run is stored
 * as a DecisionRecord (FS §8.2).
 */
@Injectable()
export class PlannerService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(FactChecksService) private readonly checks: FactChecksService,
  ) {}

  /** Places a trip can start or end at (hub town, common origins). */
  async places() {
    return this.db
      .select({ code: place.code, name: place.name, kind: place.kind })
      .from(place)
      .where(inArray(place.kind, ['HUB', 'ORIGIN']))
      .orderBy(asc(place.kind), asc(place.name));
  }

  async loadFacts(
    circuitCode = 'NAVAGRAHA',
  ): Promise<{ facts: PlanningFacts; circuitTemples: string[] }> {
    const [circ] = await this.db.select().from(circuit).where(eq(circuit.code, circuitCode));
    if (!circ) throw new BadRequestException(`Unknown circuit ${circuitCode}`);
    const temples = await this.db
      .select({ t: temple })
      .from(circuitTemple)
      .innerJoin(temple, eq(temple.id, circuitTemple.templeId))
      .where(eq(circuitTemple.circuitId, circ.id))
      .orderBy(asc(circuitTemple.displayOrder));
    const ids = temples.map(({ t }) => t.id);
    const [places, allSchedules, allSpecials, allTravel] = await Promise.all([
      this.db.select().from(place),
      ids.length
        ? this.db
            .select()
            .from(templeSchedule)
            .where(
              and(
                inArray(templeSchedule.templeId, ids),
                eq(templeSchedule.verificationStatus, VERIFIED),
              ),
            )
        : [],
      ids.length
        ? this.db
            .select()
            .from(templeSpecialDay)
            .where(
              and(
                inArray(templeSpecialDay.templeId, ids),
                eq(templeSpecialDay.verificationStatus, VERIFIED),
              ),
            )
        : [],
      this.db
        .select()
        .from(travelTime)
        .where(
          and(eq(travelTime.verificationStatus, VERIFIED), isNotNull(travelTime.normalMinutes)),
        ),
    ]);
    // V2 §26: facts whose sources disagree are not facts until a person settles them.
    const conflicts = await this.checks.conflicts();
    const usable = <T extends { id: string }>(rows: T[]) =>
      rows.filter((r) => !conflicts.rowIds.has(r.id));
    const schedules = usable(allSchedules);
    const specials = usable(allSpecials);
    const travel = usable(allTravel);
    const placeById = new Map(places.map((p) => [p.id, p]));
    const placeOfTemple = new Map(
      places.filter((p) => p.templeId).map((p) => [p.templeId!, p.code]),
    );

    const travelMinutes: Record<string, number> = {};
    for (const r of travel) {
      const from = placeById.get(r.fromPlaceId)?.code;
      const to = placeById.get(r.toPlaceId)?.code;
      if (!from || !to) continue;
      travelMinutes[travelKey(from, to)] = r.normalMinutes!;
      if (r.symmetric && travelMinutes[travelKey(to, from)] == null) {
        travelMinutes[travelKey(to, from)] = r.normalMinutes!;
      }
    }
    const time = (v: string | null) => (v ? v.slice(0, 5) : null);
    // The facts' version: when the newest verified fact changed.
    const stamps = [
      ...temples.filter(({ t }) => t.verificationStatus === VERIFIED).map(({ t }) => t.updatedAt),
      ...schedules.map((s) => s.updatedAt),
      ...specials.map((s) => s.updatedAt),
      ...travel.map((s) => s.updatedAt),
    ].map((d) => d.getTime());
    const version = stamps.length
      ? `verified-${new Date(Math.max(...stamps)).toISOString()}`
      : 'verified-none';
    const hub = places.find((p) => p.kind === 'HUB');

    const facts: PlanningFacts = {
      temples: temples.map(({ t }) => {
        const verified = t.verificationStatus === VERIFIED;
        const disputed = conflicts.templeFields.get(t.code);
        const fact = <V>(field: string, v: V) => (verified && !disputed?.has(field) ? v : null);
        return {
          code: t.code,
          name: t.commonName,
          placeCode: placeOfTemple.get(t.id) ?? null,
          visitMinutesNormal: fact('visitMinutesNormal', t.visitMinutesNormal),
          visitMinutesBusy: fact('visitMinutesBusy', t.visitMinutesBusy),
          wheelchairAccess: fact('wheelchairAccess', t.wheelchairAccess),
          sessions: schedules
            .filter((s) => s.templeId === t.id)
            .map((s) => ({
              dayType: s.dayType,
              opensAt: time(s.opensAt)!,
              closesAt: time(s.closesAt)!,
              lastEntryAt: time(s.lastEntryAt),
              validFrom: s.validFrom,
              validTo: s.validTo,
            })),
          specialDays: specials
            .filter((s) => s.templeId === t.id)
            .map((s) => ({
              name: s.name,
              fromDate: s.fromDate,
              toDate: s.toDate,
              effect: s.effect,
              changedOpensAt: time(s.changedOpensAt),
              changedClosesAt: time(s.changedClosesAt),
              expectedExtraWaitMinutes: s.expectedExtraWaitMinutes,
              recursYearly: s.recursYearly,
            })),
        };
      }),
      travelMinutes,
      places: Object.fromEntries(places.map((p) => [p.code, p.name])),
      overnightPlace: hub?.code ?? 'HUB-KUM',
      version,
    };
    return { facts, circuitTemples: temples.map(({ t }) => t.code) };
  }

  async plan(
    input: Omit<PlanRequest, 'temples'> & { temples?: string[] },
    meta: { userId: string; correlationId: string; leadId?: string | null },
  ): Promise<PlanResult & { decisionRecordId: string; templeNames: Record<string, string> }> {
    const { facts, circuitTemples } = await this.loadFacts();
    const req: PlanRequest = {
      ...input,
      temples: input.temples?.length ? input.temples : circuitTemples,
    };
    const result = planTrip(req, facts, DEFAULT_ENGINE_CONFIG);
    const id = await this.record('PLAN', req, result, result.status, result.recommended, meta);
    return { ...result, decisionRecordId: id, templeNames: names(facts) };
  }

  async evaluate(
    input: EvaluateRequest,
    meta: { userId: string; correlationId: string; leadId?: string | null },
  ): Promise<EvaluateResult & { decisionRecordId: string }> {
    const { facts } = await this.loadFacts();
    const result = evaluateItinerary(input, facts, DEFAULT_ENGINE_CONFIG);
    const id = await this.record('EVALUATE', input, result, result.status, null, meta);
    return { ...result, decisionRecordId: id };
  }

  private async record(
    kind: 'PLAN' | 'EVALUATE',
    input: unknown,
    result: { configVersion: string; factsVersion: string },
    status: string,
    recommended: string | null,
    meta: { userId: string; correlationId: string; leadId?: string | null },
  ) {
    const [row] = await this.db
      .insert(schema.decisionRecord)
      .values({
        kind,
        leadId: meta.leadId ?? null,
        input,
        status,
        result,
        recommended,
        configVersion: result.configVersion,
        factsVersion: result.factsVersion,
        correlationId: meta.correlationId,
        createdByUserId: meta.userId,
      })
      .returning({ id: schema.decisionRecord.id });
    return row!.id;
  }
}

function names(facts: PlanningFacts) {
  return Object.fromEntries(facts.temples.map((t) => [t.code, t.name]));
}

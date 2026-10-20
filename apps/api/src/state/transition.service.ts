import { schema, type Database } from '@navagraha/db';
import { canCreate, decideForRoles, type MachineDefinition, type Role } from '@navagraha/domain';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';

export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Who is acting. A person acts with their own roles; system steps act as SYSTEM but keep
 * the user whose action triggered them, so the history shows who set things in motion.
 */
export interface Actor {
  userId: string | null;
  roles: readonly Role[];
}

export const systemActor = (triggeredBy: string | null): Actor => ({
  userId: triggeredBy,
  roles: ['SYSTEM'],
});

/** Machine name → table holding that object's `state` column. */
const TABLES: Record<string, string> = {
  Booking: 'booking',
  Itinerary: 'itinerary',
  Quote: 'quote',
  Payment: 'payment',
  FulfilmentComponent: 'fulfilment_component',
  Trip: 'trip',
  ChangeRequest: 'change_request',
  Cancellation: 'cancellation',
  Refund: 'refund',
};

interface Options {
  correlationId: string;
  reason?: string | null;
  idempotencyKey?: string;
  occurredAt?: Date;
  sourceChannel?: string;
}

/**
 * The single door for state changes (D-04 §1): checks the machine, updates the row only if it
 * is still in the expected state, and appends to state_transition — all in the caller's transaction.
 */
@Injectable()
export class TransitionService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /** Records that an object was created in `state`. The caller inserts the row. */
  async created<S extends string>(
    tx: Tx,
    def: MachineDefinition<S>,
    entityId: string,
    state: NoInfer<S>,
    actor: Actor,
    opts: Options,
  ): Promise<void> {
    const role = actor.roles.find((r) => canCreate(def, state, r));
    if (!role) {
      await this.denied(def.name, entityId, actor, opts, `create in ${state}`);
      throw new ForbiddenException(`You cannot create a ${def.name} in ${state}`);
    }
    await this.write(tx, def.name, entityId, null, state, role, actor, opts);
  }

  /** Moves an object from `from` to `to`, or throws without changing anything. */
  async move<S extends string>(
    tx: Tx,
    def: MachineDefinition<S>,
    entityId: string,
    from: NoInfer<S>,
    to: NoInfer<S>,
    actor: Actor,
    opts: Options,
  ): Promise<Role> {
    const d = decideForRoles(def, { from, to, reason: opts.reason ?? null }, actor.roles);
    if (!d.ok) {
      if (d.error === 'ROLE_NOT_ALLOWED') {
        await this.denied(def.name, entityId, actor, opts, `${from} → ${to}`);
        throw new ForbiddenException(d.message);
      }
      if (d.error === 'REASON_REQUIRED') throw new BadRequestException(d.message);
      throw new ConflictException(d.message);
    }
    const table = TABLES[def.name];
    if (!table) throw new Error(`No table mapped for ${def.name}`);
    const res = await tx.execute(
      sql`update ${sql.identifier(table)} set state = ${to}, updated_at = now()
          where id = ${entityId} and state = ${from}`,
    );
    if (res.rowCount !== 1) {
      throw new ConflictException(
        `${def.name} changed while you were working on it. Reload and retry.`,
      );
    }
    await this.write(tx, def.name, entityId, from, to, d.role!, actor, opts);
    return d.role!;
  }

  private async write(
    tx: Tx,
    machine: string,
    entityId: string,
    from: string | null,
    to: string,
    role: Role,
    actor: Actor,
    opts: Options,
  ) {
    await tx.insert(schema.stateTransition).values({
      machine,
      entityId,
      fromState: from,
      toState: to,
      actorUserId: actor.userId,
      actorRole: role,
      reason: opts.reason ?? null,
      sourceChannel: opts.sourceChannel ?? null,
      occurredAt: opts.occurredAt ?? new Date(),
      correlationId: opts.correlationId,
      idempotencyKey: opts.idempotencyKey ?? null,
    });
  }

  /** EC-53 — denied state changes are security events. Written outside the failing transaction. */
  private async denied(
    machine: string,
    entityId: string,
    actor: Actor,
    opts: Options,
    attempted: string,
  ) {
    await this.audit.record({
      action: 'security.transition_denied',
      correlationId: opts.correlationId,
      actorUserId: actor.userId,
      entityType: machine,
      entityId,
      metadata: { attempted, roles: actor.roles },
    });
  }
}

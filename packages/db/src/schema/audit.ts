import {
  bigint,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Every state change (D-04 §1 rule 2). Append-only: a database trigger rejects
 * UPDATE and DELETE, so corrections must be new rows (rule 6).
 */
export const stateTransition = pgTable(
  'state_transition',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    machine: text('machine').notNull(),
    entityId: uuid('entity_id').notNull(),
    fromState: text('from_state'),
    toState: text('to_state').notNull(),
    actorUserId: uuid('actor_user_id'),
    actorRole: text('actor_role').notNull(),
    reason: text('reason'),
    sourceChannel: text('source_channel'),
    /** When it happened in the real world (may be earlier, e.g. a phoned-in temple completion). */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    /** Server time; never client-supplied. */
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    correlationId: text('correlation_id').notNull(),
    /** Provider event id for webhook-driven transitions (EC-24, EC-43, NFR-09). */
    idempotencyKey: text('idempotency_key'),
  },
  (t) => [
    index('state_transition_entity_idx').on(t.machine, t.entityId),
    uniqueIndex('state_transition_idem_uq').on(t.idempotencyKey),
  ],
);

/** Security and operational audit (NFR-10, MR-52). Append-only, like state_transition. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid('actor_user_id'),
    actorRole: text('actor_role'),
    /** e.g. `temple.update`, `security.role_denied`. */
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    correlationId: text('correlation_id').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    metadata: jsonb('metadata'),
  },
  (t) => [
    index('audit_log_entity_idx').on(t.entityType, t.entityId),
    index('audit_log_time_idx').on(t.occurredAt),
  ],
);

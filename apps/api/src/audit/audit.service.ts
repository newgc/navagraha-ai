import { schema, type Database } from '@navagraha/db';
import { Inject, Injectable } from '@nestjs/common';
import { desc } from 'drizzle-orm';
import { DB } from '../db/db.module.js';

export interface AuditEntry {
  action: string;
  correlationId: string;
  actorUserId?: string | null;
  actorRole?: string | null;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

/** Writes to the append-only audit_log (NFR-10). Never store OTP codes or tokens here. */
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async record(entry: AuditEntry, db: Pick<Database, 'insert'> = this.db): Promise<void> {
    await db.insert(schema.auditLog).values(entry);
  }

  latest(limit: number) {
    return this.db.select().from(schema.auditLog).orderBy(desc(schema.auditLog.id)).limit(limit);
  }
}

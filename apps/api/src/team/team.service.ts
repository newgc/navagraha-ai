import { randomUUID } from 'node:crypto';
import { schema, type Database } from '@navagraha/db';
import { maskPhone, normalizePhone } from '@navagraha/domain';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { DB } from '../db/db.module.js';

export const STAFF_ROLES = [
  'OPS_COORDINATOR',
  'OPS_MANAGER',
  'FINANCE',
  'CONTENT_ADMIN',
  'SYSTEM_ADMIN',
  'DRIVER',
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

const { appUser, appUserRole } = schema;

/** Staff roles (MR-36), managed on screen by System Admins; every change is audited. */
@Injectable()
export class TeamService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Team');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** BOOTSTRAP_ADMIN_PHONES → System Admin + Operations Manager, once. */
  async onApplicationBootstrap() {
    const phones = (this.config.BOOTSTRAP_ADMIN_PHONES ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    for (const raw of phones) {
      const phone = normalizePhone(raw);
      if (!phone) {
        this.logger.error(`BOOTSTRAP_ADMIN_PHONES: "${raw}" is not a valid phone number; skipped`);
        continue;
      }
      for (const role of ['SYSTEM_ADMIN', 'OPS_MANAGER'] as const) {
        const granted = await this.grant(phone, role, null, null, 'bootstrap');
        if (granted)
          this.logger.warn(`Granted ${role} to ${maskPhone(phone)} from BOOTSTRAP_ADMIN_PHONES`);
      }
    }
  }

  async list() {
    const rows = await this.db
      .select({
        id: appUser.id,
        phone: appUser.phone,
        email: appUser.email,
        displayName: appUser.displayName,
        role: appUserRole.role,
      })
      .from(appUser)
      .innerJoin(appUserRole, eq(appUserRole.userId, appUser.id))
      .where(inArray(appUserRole.role, [...STAFF_ROLES]));
    const byUser = new Map<
      string,
      {
        id: string;
        phone: string | null;
        email: string | null;
        displayName: string | null;
        roles: string[];
      }
    >();
    for (const r of rows) {
      const u = byUser.get(r.id) ?? {
        id: r.id,
        phone: r.phone,
        email: r.email,
        displayName: r.displayName,
        roles: [],
      };
      u.roles.push(r.role);
      byUser.set(r.id, u);
    }
    return {
      roles: STAFF_ROLES,
      members: [...byUser.values()]
        .map((u) => ({ ...u, roles: u.roles.sort() }))
        .sort((a, b) =>
          (a.displayName ?? a.phone ?? '').localeCompare(b.displayName ?? b.phone ?? ''),
        ),
    };
  }

  async change(
    input: {
      phone: string;
      role: StaffRole;
      action: 'grant' | 'revoke';
      name?: string | undefined;
    },
    auth: AuthContext,
    correlationId: string,
  ) {
    const phone = normalizePhone(input.phone);
    if (!phone) throw new BadRequestException('Enter a valid mobile number');
    if (input.action === 'grant') {
      await this.grant(phone, input.role, auth.userId, correlationId, 'team_screen', input.name);
      return this.list();
    }

    await this.db.transaction(async (tx) => {
      const [user] = await tx.select().from(appUser).where(eq(appUser.phone, phone));
      if (!user) throw new BadRequestException('No team member with that number');
      if (input.role === 'SYSTEM_ADMIN') {
        if (user.id === auth.userId) {
          throw new ConflictException(
            'You cannot remove your own System Admin role; ask another admin',
          );
        }
        // Lock every admin row (the target's too): a concurrent revoke then waits for this one
        // and, re-reading after it commits, sees whether an admin would still remain.
        const admins = await tx
          .select({ userId: appUserRole.userId })
          .from(appUserRole)
          .where(eq(appUserRole.role, 'SYSTEM_ADMIN'))
          .for('update');
        const others = admins.filter((a) => a.userId !== user.id);
        if (others.length === 0)
          throw new ConflictException('There must always be at least one System Admin');
      }
      const removed = await tx
        .delete(appUserRole)
        .where(and(eq(appUserRole.userId, user.id), eq(appUserRole.role, input.role)))
        .returning();
      if (removed.length) {
        await this.audit.record(
          {
            action: 'security.role_revoked',
            correlationId,
            actorUserId: auth.userId,
            entityType: 'app_user',
            entityId: user.id,
            metadata: { role: input.role, phone: maskPhone(phone), via: 'team_screen' },
          },
          tx,
        );
      }
    });
    return this.list();
  }

  /** Returns true when the role was newly granted. */
  private async grant(
    phone: string,
    role: StaffRole,
    actorUserId: string | null,
    correlationId: string | null,
    via: 'bootstrap' | 'team_screen',
    name?: string,
  ) {
    return this.db.transaction(async (tx) => {
      await tx
        .insert(appUser)
        .values({ phone, displayName: name?.trim() || null })
        .onConflictDoNothing({ target: appUser.phone });
      const [user] = await tx.select().from(appUser).where(eq(appUser.phone, phone));
      if (!user) throw new Error('user missing after upsert');
      if (name?.trim() && !user.displayName) {
        await tx.update(appUser).set({ displayName: name.trim() }).where(eq(appUser.id, user.id));
      }
      const added = await tx
        .insert(appUserRole)
        .values({ userId: user.id, role, grantedBy: actorUserId })
        .onConflictDoNothing()
        .returning();
      if (added.length) {
        await this.audit.record(
          {
            action: 'security.role_granted',
            correlationId: correlationId ?? randomUUID(),
            actorUserId,
            actorRole: via === 'bootstrap' ? 'SYSTEM' : 'SYSTEM_ADMIN',
            entityType: 'app_user',
            entityId: user.id,
            metadata: { role, phone: maskPhone(phone), via },
          },
          tx,
        );
      }
      return added.length > 0;
    });
  }
}

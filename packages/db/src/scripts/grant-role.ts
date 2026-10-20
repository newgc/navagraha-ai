import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { maskPhone, normalizePhone } from '@navagraha/domain';
import { and, eq } from 'drizzle-orm';
import { createDb } from '../client.js';
import { appUser, appUserRole, auditLog, userRole } from '../schema/index.js';
import { databaseUrl } from './env.js';

type UserRole = (typeof userRole.enumValues)[number];

const USAGE =
  'Usage: pnpm db:grant-role --phone <mobile> --role <ROLE> --actor "Your name" [--revoke]\n' +
  `Roles: ${userRole.enumValues.join(', ')}`;

/** Grants or revokes a staff role. The person signs in with OTP on that phone number as usual. */
async function main() {
  const { values } = parseArgs({
    options: {
      phone: { type: 'string' },
      role: { type: 'string' },
      actor: { type: 'string' },
      revoke: { type: 'boolean', default: false },
    },
  });
  const phone = values.phone ? normalizePhone(values.phone) : null;
  const role = values.role?.toUpperCase() as UserRole | undefined;
  if (!phone || !role || !userRole.enumValues.includes(role) || !values.actor?.trim()) {
    console.error(USAGE);
    process.exit(2);
  }

  const { db, pool } = createDb(databaseUrl());
  try {
    await db.transaction(async (tx) => {
      await tx.insert(appUser).values({ phone }).onConflictDoNothing({ target: appUser.phone });
      const [user] = await tx.select().from(appUser).where(eq(appUser.phone, phone));
      if (!user) throw new Error('user missing after upsert');
      if (values.revoke) {
        await tx
          .delete(appUserRole)
          .where(and(eq(appUserRole.userId, user.id), eq(appUserRole.role, role)));
      } else {
        await tx.insert(appUserRole).values({ userId: user.id, role }).onConflictDoNothing();
      }
      await tx.insert(auditLog).values({
        action: values.revoke ? 'security.role_revoked' : 'security.role_granted',
        actorRole: 'SYSTEM_ADMIN',
        entityType: 'app_user',
        entityId: user.id,
        correlationId: randomUUID(),
        metadata: { role, actor: values.actor, via: 'cli' },
      });
    });
    console.log(`${values.revoke ? 'Revoked' : 'Granted'} ${role} for ${maskPhone(phone)}.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

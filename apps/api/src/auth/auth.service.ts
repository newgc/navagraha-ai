import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { schema, type Database } from '@navagraha/db';
import { maskPhone, normalizePhone, type Role } from '@navagraha/domain';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, count, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { DB } from '../db/db.module.js';
import type { AuthContext } from './auth.types.js';
import { OTP_SENDER, type OtpSender } from './otp-sender.js';

export const OTP_POLICY = {
  ttlSeconds: 5 * 60,
  maxAttempts: 5,
  resendCooldownSeconds: 30,
  perPhonePerHour: 5,
  perIpPerHour: 20,
} as const;
export const SESSION_TTL_DAYS = 30;

const INVALID_CODE = 'That code is wrong or has expired. Request a new one.';

interface RequestMeta {
  correlationId: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** MR-01 / NAV-ID-001 — phone OTP sign-in with server-side sessions. */
@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OTP_SENDER) private readonly sender: OtpSender,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private codeHash(challengeId: string, code: string) {
    return createHmac('sha256', this.config.AUTH_SECRET)
      .update(`${challengeId}:${code}`)
      .digest('hex');
  }

  /** Always answers the same way whether or not the number has an account. */
  async requestOtp(rawPhone: string, meta: RequestMeta) {
    const phone = normalizePhone(rawPhone);
    if (!phone) throw new BadRequestException('Enter a valid mobile number');

    const { otpChallenge: c } = schema;
    const since = (seconds: number) => sql`now() - make_interval(secs => ${seconds})`;
    const [recent] = await this.db
      .select({ n: count() })
      .from(c)
      .where(and(eq(c.phone, phone), gt(c.createdAt, since(OTP_POLICY.resendCooldownSeconds))));
    const [perPhone] = await this.db
      .select({ n: count() })
      .from(c)
      .where(and(eq(c.phone, phone), gt(c.createdAt, since(3600))));
    const [perIp] = meta.ip
      ? await this.db
          .select({ n: count() })
          .from(c)
          .where(and(eq(c.requestIp, meta.ip), gt(c.createdAt, since(3600))))
      : [{ n: 0 }];
    if (recent!.n > 0) {
      throw new HttpException(
        `Please wait ${OTP_POLICY.resendCooldownSeconds} seconds before asking for another code`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (perPhone!.n >= OTP_POLICY.perPhonePerHour || perIp!.n >= OTP_POLICY.perIpPerHour) {
      throw new HttpException(
        'Too many codes requested. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const challengeId = randomUUID();
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const [row] = await this.db
      .insert(c)
      .values({
        id: challengeId,
        phone,
        codeHash: this.codeHash(challengeId, code),
        expiresAt: sql`now() + make_interval(secs => ${OTP_POLICY.ttlSeconds})`,
        requestIp: meta.ip ?? null,
      })
      .returning({ expiresAt: c.expiresAt });

    try {
      await this.sender.send(phone, code);
    } catch (err) {
      this.logger.error(`OTP delivery failed for ${maskPhone(phone)} [${meta.correlationId}]`, err);
      throw new ServiceUnavailableException('We could not send the code. Please try again.');
    }
    return { challengeId, expiresAt: row!.expiresAt.toISOString() };
  }

  async verifyOtp(challengeId: string, code: string, meta: RequestMeta) {
    const { otpChallenge: c } = schema;
    // Count the attempt atomically before checking, so parallel guesses cannot exceed the limit.
    const [ch] = await this.db
      .update(c)
      .set({ attempts: sql`${c.attempts} + 1` })
      .where(
        and(
          eq(c.id, challengeId),
          isNull(c.consumedAt),
          gt(c.expiresAt, sql`now()`),
          lt(c.attempts, OTP_POLICY.maxAttempts),
        ),
      )
      .returning({ phone: c.phone, codeHash: c.codeHash, attempts: c.attempts });
    if (!ch) throw new BadRequestException(INVALID_CODE);

    const expected = Buffer.from(ch.codeHash, 'hex');
    const actual = Buffer.from(this.codeHash(challengeId, code), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      if (ch.attempts >= OTP_POLICY.maxAttempts) {
        await this.audit.record({
          action: 'auth.otp_locked',
          correlationId: meta.correlationId,
          entityType: 'otp_challenge',
          entityId: challengeId,
          metadata: { phone: maskPhone(ch.phone), ip: meta.ip },
        });
      }
      throw new BadRequestException(INVALID_CODE);
    }

    return this.db.transaction(async (tx) => {
      const [consumed] = await tx
        .update(c)
        .set({ consumedAt: sql`now()` })
        .where(and(eq(c.id, challengeId), isNull(c.consumedAt)))
        .returning({ id: c.id });
      if (!consumed) throw new BadRequestException(INVALID_CODE);

      // The phone number is the identity, so a customer that operations created for a
      // manual booking signs in to the same record — no duplicate customers (MR-01).
      await tx
        .insert(schema.appUser)
        .values({ phone: ch.phone, phoneVerifiedAt: sql`now()` })
        .onConflictDoUpdate({
          target: schema.appUser.phone,
          set: { phoneVerifiedAt: sql`coalesce(${schema.appUser.phoneVerifiedAt}, now())` },
        });
      const [user] = await tx
        .select()
        .from(schema.appUser)
        .where(eq(schema.appUser.phone, ch.phone));
      if (!user) throw new Error('user missing after upsert');
      if (user.disabledAt) {
        throw new ForbiddenException('This account is disabled. Please contact support.');
      }
      await tx
        .insert(schema.appUserRole)
        .values({ userId: user.id, role: 'CUSTOMER' })
        .onConflictDoNothing();
      const roles = await this.rolesOf(user.id, tx);

      const token = randomBytes(32).toString('base64url');
      const [session] = await tx
        .insert(schema.authSession)
        .values({
          userId: user.id,
          tokenHash: sha256(token),
          expiresAt: sql`now() + make_interval(days => ${SESSION_TTL_DAYS})`,
          userAgent: meta.userAgent?.slice(0, 512) ?? null,
          ip: meta.ip ?? null,
        })
        .returning();
      await this.audit.record(
        {
          action: 'auth.login',
          correlationId: meta.correlationId,
          actorUserId: user.id,
          entityType: 'auth_session',
          entityId: session!.id,
          metadata: { method: 'phone_otp', ip: meta.ip },
        },
        tx,
      );
      return {
        token,
        expiresAt: session!.expiresAt.toISOString(),
        user: { id: user.id, phone: user.phone, displayName: user.displayName, roles },
      };
    });
  }

  /** Resolves a bearer token to a live session, or null. */
  async authenticate(token: string): Promise<AuthContext | null> {
    const { authSession: s, appUser: u } = schema;
    const [row] = await this.db
      .select({ sessionId: s.id, userId: s.userId })
      .from(s)
      .innerJoin(u, eq(u.id, s.userId))
      .where(
        and(
          eq(s.tokenHash, sha256(token)),
          isNull(s.revokedAt),
          gt(s.expiresAt, sql`now()`),
          isNull(u.disabledAt),
        ),
      );
    if (!row) return null;
    return { ...row, roles: await this.rolesOf(row.userId) };
  }

  async logout(auth: AuthContext, correlationId: string) {
    await this.db
      .update(schema.authSession)
      .set({ revokedAt: sql`now()` })
      .where(eq(schema.authSession.id, auth.sessionId));
    await this.audit.record({
      action: 'auth.logout',
      correlationId,
      actorUserId: auth.userId,
      entityType: 'auth_session',
      entityId: auth.sessionId,
    });
  }

  async me(auth: AuthContext) {
    const [user] = await this.db
      .select()
      .from(schema.appUser)
      .where(eq(schema.appUser.id, auth.userId));
    return {
      id: user!.id,
      phone: user!.phone,
      email: user!.email,
      displayName: user!.displayName,
      roles: auth.roles,
    };
  }

  private async rolesOf(userId: string, db: Pick<Database, 'select'> = this.db): Promise<Role[]> {
    const rows = await db
      .select({ role: schema.appUserRole.role })
      .from(schema.appUserRole)
      .where(eq(schema.appUserRole.userId, userId));
    return rows.map((r) => r.role).sort();
  }
}

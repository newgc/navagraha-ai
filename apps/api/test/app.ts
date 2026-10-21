import 'reflect-metadata';
import { createDb, resetDatabase, seedDatabase } from '@navagraha/db';
import type { Role } from '@navagraha/domain';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { OTP_SENDER, type OtpSender } from '../src/auth/otp-sender.js';
import { WHATSAPP, type WhatsAppMessenger } from '../src/messaging/whatsapp.js';
import { PAYMENT_GATEWAY, type PaymentGateway } from '../src/payments/gateway.js';
import { APP_CONFIG, type AppConfig } from '../src/config.js';

/** Captures sign-in codes instead of sending them. */
export class CapturingOtpSender implements OtpSender {
  readonly channel = 'log' as const;
  readonly sent: { phone: string; code: string }[] = [];
  fail = false;

  async send(phone: string, code: string) {
    if (this.fail) throw new Error('provider down');
    this.sent.push({ phone, code });
  }

  last() {
    return this.sent.at(-1)!;
  }
}

/** A fully wired app on a freshly migrated and seeded database. */
export async function createTestApp(
  url: string,
  overrides: Partial<AppConfig> = {},
  fakes: { gateway?: PaymentGateway; whatsapp?: WhatsAppMessenger } = {},
) {
  const { db, pool } = createDb(url);
  await resetDatabase(db);
  await seedDatabase(db);

  const config: AppConfig = {
    NODE_ENV: 'test',
    DEPLOY_ENV: 'local',
    API_HOST: '127.0.0.1',
    API_PORT: 0,
    DATABASE_URL: url,
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0000',
    OTP_SENDER: 'console',
    HASHWA_API_URL: 'https://eco.hashwa.in/api',
    PAYMENT_GATEWAY: 'none',
    CASHFREE_ENV: 'sandbox',
    CASHFREE_API_VERSION: '2026-01-01',
    PAYMENT_LINK_EXPIRY_HOURS: 48,
    ...overrides,
  };
  const otp = new CapturingOtpSender();
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(OTP_SENDER)
    .useValue(otp);
  if (fakes.gateway) builder = builder.overrideProvider(PAYMENT_GATEWAY).useValue(fakes.gateway);
  if (fakes.whatsapp) builder = builder.overrideProvider(WHATSAPP).useValue(fakes.whatsapp);
  const moduleRef = await builder.compile();
  const app = configureApp(
    moduleRef.createNestApplication<NestExpressApplication>({
      logger: process.env.TEST_LOGS ? undefined : false,
    }),
  );
  await app.init();

  return {
    app,
    db,
    otp,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

let phoneCounter = 0;

/** Creates a user holding `roles` and signs them in through the real OTP flow. */
export async function signInAs(
  ctx: Awaited<ReturnType<typeof createTestApp>>,
  roles: Exclude<Role, 'SYSTEM' | 'PAYMENT_GATEWAY'>[],
) {
  const { schema } = await import('@navagraha/db');
  const request = (await import('supertest')).default;
  phoneCounter++;
  const phone = `+9170000${String(phoneCounter).padStart(5, '0')}`;
  const [user] = await ctx.db.insert(schema.appUser).values({ phone }).returning();
  if (roles.length) {
    await ctx.db
      .insert(schema.appUserRole)
      .values(roles.map((role) => ({ userId: user!.id, role })));
  }
  const r = await request(ctx.app.getHttpServer()).post('/v1/auth/otp/request').send({ phone });
  const v = await request(ctx.app.getHttpServer())
    .post('/v1/auth/otp/verify')
    .send({ challengeId: r.body.challengeId, code: ctx.otp.last().code });
  return { userId: user!.id, header: { authorization: `Bearer ${v.body.token}` } };
}

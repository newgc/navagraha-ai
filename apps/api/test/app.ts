import 'reflect-metadata';
import { createDb, migrateDatabase, seedDatabase } from '@navagraha/db';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { sql } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { OTP_SENDER, type OtpSender } from '../src/auth/otp-sender.js';
import { APP_CONFIG, type AppConfig } from '../src/config.js';

/** Captures sign-in codes instead of sending them. */
export class CapturingOtpSender implements OtpSender {
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
export async function createTestApp(url: string) {
  const { db, pool } = createDb(url);
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await migrateDatabase(db);
  await seedDatabase(db);

  const config: AppConfig = {
    NODE_ENV: 'test',
    API_PORT: 0,
    DATABASE_URL: url,
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0000',
    OTP_SENDER: 'console',
  };
  const otp = new CapturingOtpSender();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(OTP_SENDER)
    .useValue(otp)
    .compile();
  const app = configureApp(
    moduleRef.createNestApplication<NestExpressApplication>({ logger: false }),
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

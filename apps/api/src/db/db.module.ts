import { createDb, type DbHandle } from '@navagraha/db';
import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config.js';

/** Injection token for the Drizzle database. */
export const DB = Symbol('DB');
const DB_HANDLE = Symbol('DB_HANDLE');

@Global()
@Module({
  providers: [
    {
      provide: DB_HANDLE,
      useFactory: (config: AppConfig): DbHandle => createDb(config.DATABASE_URL),
      inject: [APP_CONFIG],
    },
    { provide: DB, useFactory: (h: DbHandle) => h.db, inject: [DB_HANDLE] },
  ],
  exports: [DB],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  async onApplicationShutdown() {
    await this.handle.pool.end();
  }
}

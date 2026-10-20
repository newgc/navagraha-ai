import type { Database } from '@navagraha/db';
import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB } from '../db/db.module.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Get()
  async check() {
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      throw new ServiceUnavailableException({ message: 'Database unavailable' });
    }
    return { status: 'ok', db: 'ok' };
  }
}

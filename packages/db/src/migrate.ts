import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './client.js';

/** Applies every migration in `drizzle/`. Works from `src` (tsx) and `dist`. */
export async function migrateDatabase(db: Database): Promise<void> {
  await migrate(db, {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'drizzle'),
  });
}

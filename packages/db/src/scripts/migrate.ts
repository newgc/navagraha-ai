import { createDb } from '../client.js';
import { migrateDatabase } from '../migrate.js';
import { databaseUrl } from './env.js';

async function main() {
  const { db, pool } = createDb(databaseUrl());
  try {
    await migrateDatabase(db);
    console.log('Migrations applied.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

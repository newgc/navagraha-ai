import { createDb } from '../client.js';
import { seedDatabase } from '../seed.js';
import { databaseUrl } from './env.js';

async function main() {
  const { db, pool } = createDb(databaseUrl());
  try {
    await seedDatabase(db);
    console.log('Seed data applied.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createDb } from '../client.js';
import { formatReport, importTempleWorkbook } from '../import/index.js';
import { databaseUrl } from './env.js';

const USAGE =
  'Usage: pnpm db:import-temples <workbook.xlsx> --actor "Your name" [--apply]\n' +
  'Without --apply the workbook is only checked; nothing is written.';

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { apply: { type: 'boolean', default: false }, actor: { type: 'string' } },
  });
  const file = positionals[0];
  if (!file || !values.actor?.trim()) {
    console.error(USAGE);
    process.exit(2);
  }
  // pnpm runs package scripts from the package directory; resolve against where the user ran it.
  const filePath = path.resolve(process.env.INIT_CWD ?? process.cwd(), file);
  const data = await readFile(filePath);
  const { db, pool } = createDb(databaseUrl());
  try {
    const report = await importTempleWorkbook(db, data, {
      apply: values.apply,
      actor: values.actor,
      fileName: path.basename(filePath),
    });
    console.log(formatReport(report));
    process.exitCode = report.errors > 0 ? 1 : 0;
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

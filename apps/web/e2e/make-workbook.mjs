// Fills the real temple data template with a few verified rows, for the browser test.
// Run with plain Node (Playwright's loader cannot load ExcelJS): node make-workbook.mjs <template> <out>
import { readFile, writeFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';

const [template, out] = process.argv.slice(2);
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(await readFile(template));
const today = new Date().toISOString().slice(0, 10).split('-').reverse().join('-');
const verified = {
  'Source (who / which page)': 'Temple office, by phone',
  'Source type': 'Temple office (phone)',
  'Verified by': 'Lakshmi',
  'Verified on': today,
  Status: 'Verified',
};
function set(sheet, row, values) {
  const ws = wb.getWorksheet(sheet);
  const col = new Map();
  ws.getRow(1).eachCell((c, i) => col.set(String(c.value), i));
  for (const [h, v] of Object.entries(values)) ws.getRow(row).getCell(col.get(h)).value = v;
}
set('Temples', 8, {
  'Official temple name': 'Sri Dharbaranyeswarar Temple',
  'Typical visit time — normal day (min)': 45,
  ...verified,
});
set('Schedules', 3, {
  'Temple ID': 'TEM-SHA',
  'Day type': 'Every day',
  Session: 'Morning',
  'Opens (HH:MM)': '05:30',
  'Closes (HH:MM)': '12:30',
  'Valid from': '01-01-2026',
  ...verified,
});
await writeFile(out, Buffer.from(await wb.xlsx.writeBuffer()));

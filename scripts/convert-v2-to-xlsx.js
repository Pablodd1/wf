#!/usr/bin/env node
/**
 * convert-v2-to-xlsx.js
 * Converts *_corrected_v2.tsv files to Excel in Downloads.
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const DESKTOP = '/mnt/c/Users/jasme/Desktop';
const OUT = '/mnt/c/Users/jasme/Downloads';

const files = fs.readdirSync(DESKTOP)
  .filter(f => f.endsWith('_corrected_v2.tsv'));

console.log(`Converting ${files.length} V2 files to Excel...`);

for (const file of files) {
  const filePath = path.join(DESKTOP, file);
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const header = lines[0].split('\t');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const obj = {};
    const cols = lines[i].split('\t');
    header.forEach((h, idx) => { obj[h] = cols[idx] || ''; });
    rows.push(obj);
  }
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'WTS Corrected V2');
  const outFile = file.replace('.tsv', '.xlsx').replace('_corrected_v2', '_corrected');
  XLSX.writeFile(wb, path.join(OUT, outFile));
  console.log(`  ${file} → ${outFile}`);
}

console.log('Done — V2 Excel files in Downloads.');

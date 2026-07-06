#!/usr/bin/env node
/**
 * convert-tsv-to-xlsx.js
 * Converts all WF_WTS TSV files on Desktop to Excel (.xlsx) in Downloads.
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const DESKTOP = '/mnt/c/Users/jasme/Desktop';
const DOWNLOADS = '/mnt/c/Users/jasme/Downloads';
const files = fs.readdirSync(DESKTOP).filter(f => f.startsWith('WF_WTS_') && f.endsWith('.tsv'));

for (const file of files) {
  const tsvPath = path.join(DESKTOP, file);
  const xlsxName = file.replace('.tsv', '.xlsx');
  const xlsxPath = path.join(DOWNLOADS, xlsxName);
  
  const content = fs.readFileSync(tsvPath, 'utf8');
  const rows = content.split('\n').map(line => line.split('\t'));
  
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'WTS');
  XLSX.writeFile(wb, xlsxPath);
  console.log(`  ${xlsxName} (${rows.length - 1} records)`);
}

// Also convert WTB
const wtbPath = path.join(DESKTOP, 'WF_WTB_corrected.tsv');
if (fs.existsSync(wtbPath)) {
  const content = fs.readFileSync(wtbPath, 'utf8');
  const rows = content.split('\n').map(line => line.split('\t'));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'WTB');
  XLSX.writeFile(wb, path.join(DOWNLOADS, 'WF_WTB_corrected.xlsx'));
  console.log(`  WF_WTB_corrected.xlsx (${rows.length - 1} records)`);
}

// Summary JSON too
const summaryPath = path.join(DESKTOP, 'WF_correction_summary.json');
if (fs.existsSync(summaryPath)) {
  fs.copyFileSync(summaryPath, path.join(DOWNLOADS, 'WF_correction_summary.json'));
  console.log('  WF_correction_summary.json');
}

console.log(`\nDone — ${files.length + 2} files in ${DOWNLOADS}`);

#!/usr/bin/env node
/**
 * generate-separated-reports.js v4.3
 * Generates two separate reports:
 *   1. Non-watch / accessories (ACCESSORY_NOT_WATCH + NON_WATCH_OR_WRONG_CATEGORY)
 *   2. Anomalies / errors (NEEDS_MANUAL_REVIEW, WRONG_BRAND_SUSPECT, HUMAN with bad refs)
 * These are rows the parser explicitly flagged as problematic — not standard WTS listings.
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const DESKTOP = '/mnt/c/Users/jasme/Desktop';
const DOWNLOADS = '/mnt/c/Users/jasme/Downloads';

const files = fs.readdirSync(DESKTOP).filter(f => f.startsWith('WF_WTS_') && f.endsWith('.tsv'));

const nonWatchRows = [];
const anomalyRows = [];
let cols = [];

for (const file of files) {
  const content = fs.readFileSync(path.join(DESKTOP, file), 'utf8');
  const lines = content.split('\n');
  if (lines.length < 2) continue;
  const headers = lines[0].split('\t');
  if (cols.length === 0) cols = headers;

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split('\t');
    if (row.length < 10) continue;
    
    const verdict = row[9];
    const reason = row[10] || '';
    const ref = row[2] || '';
    
    if (verdict === 'ACCESSORY_NOT_WATCH' || verdict === 'NON_WATCH_OR_WRONG_CATEGORY') {
      nonWatchRows.push(row);
    } else if (verdict === 'NEEDS_MANUAL_REVIEW' || verdict === 'WRONG_BRAND_SUSPECT') {
      anomalyRows.push(row);
    } else if (verdict === 'HUMAN' && ref === '') {
      anomalyRows.push(row);
    } else if (verdict === 'RECYCLE' && ref.length > 0) {
      anomalyRows.push(row);
    }
  }
}

// Write non-watch report
if (nonWatchRows.length > 0) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([cols, ...nonWatchRows]);
  XLSX.utils.book_append_sheet(wb, ws, 'NonWatch');
  XLSX.writeFile(wb, path.join(DOWNLOADS, 'WF_NON_WATCH_report.xlsx'));
}

// Write anomaly report
if (anomalyRows.length > 0) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([cols, ...anomalyRows]);
  XLSX.utils.book_append_sheet(wb, ws, 'Anomalies');
  XLSX.writeFile(wb, path.join(DOWNLOADS, 'WF_ANOMALIES_report.xlsx'));
}

// Also scan all HUMAN rows across ALL files for suspicious refs
let totalHuman = 0, suspiciousHuman = 0;
for (const file of files) {
  const content = fs.readFileSync(path.join(DESKTOP, file), 'utf8');
  const lines = content.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split('\t');
    if (row.length < 10) continue;
    if (row[9] !== 'HUMAN') continue;
    totalHuman++;
    const ref = row[2] || '';
    if (/^\d{4,7}$/.test(ref) || /USD|HKD|USDT/i.test(ref) || /^[KM]\d/.test(ref) || /^\d{1,3}$/.test(ref) || ref === '') {
      suspiciousHuman++;
    }
  }
}

console.log('═══════════════════════════════════════════════════════');
console.log(' Separated Reports');
console.log('═══════════════════════════════════════════════════════');
console.log(`  Non-watch / accessory rows: ${nonWatchRows.length}`);
console.log(`  Anomaly / error rows:       ${anomalyRows.length}`);
console.log(`  HUMAN rows (all brands):    ${totalHuman}`);
console.log(`  HUMAN with bad refs:        ${suspiciousHuman} (${totalHuman>0?(suspiciousHuman*100/totalHuman).toFixed(1):0}%)`);
console.log('');
console.log(`  Saved: ${DOWNLOADS}/WF_NON_WATCH_report.xlsx`);
console.log(`  Saved: ${DOWNLOADS}/WF_ANOMALIES_report.xlsx`);

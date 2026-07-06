#!/usr/bin/env node
/**
 * generate-wtb-report.js v4.3
 * Separate WTB (Want To Buy) report with different patterns.
 * WTBs have no price extraction, different language, different field priorities.
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { parseFull, splitMultiWatch, classifyListingType } = require('../api/_lib/parser');

const LABELED_PATH = '/home/jasme/wf-training-data/labeled_listings.csv';
const DOWNLOADS = '/mnt/c/Users/jasme/Downloads';
const MAX_RECORDS = 20000;

const raw = fs.readFileSync(LABELED_PATH, 'utf8');
const lines = raw.split('\n').slice(1);

const wtbRecords = [];
let totalWTB = 0;

for (let i = 0; i < Math.min(MAX_RECORDS, lines.length); i++) {
  const line = lines[i];
  if (!line.trim()) continue;
  const cols = line.split('\t');
  if (cols.length < 9) continue;
  const title = cols[0].replace(/^"|"$/g, '');

  const listingType = classifyListingType(title);
  if (listingType !== 'WTB') continue;
  totalWTB++;

  const parts = splitMultiWatch(title);
  for (const part of parts) {
    const parsed = parseFull(part);
    wtbRecords.push({
      rawMessage: part.substring(0, 300).replace(/[\t\n\r]/g, ' '),
      brand: parsed.brand || '',
      reference: parsed.ref || '',
      dialColor: parsed.dial || '',
      currency: parsed.currency || '',
      condition: parsed.condition || '',
      year: parsed.year || '',
      confidence: parsed.confidence || 0,
      verdict: parsed.verdict || '',
      reviewReason: parsed.reviewReason || '',
      catalogMatched: parsed.catalogMatched ? 'YES' : 'NO',
      listingType: 'WTB',
    });
  }
}

// Write XLSX
const headers = Object.keys(wtbRecords[0] || {});
const rows = wtbRecords.map(r => headers.map(h => r[h] || ''));
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
XLSX.utils.book_append_sheet(wb, ws, 'WTB');
XLSX.writeFile(wb, path.join(DOWNLOADS, 'WF_WTB_report.xlsx'));

// Stats
const byBrand = {};
const byVerdict = {};
for (const r of wtbRecords) {
  const b = r.brand || 'Unknown';
  byBrand[b] = (byBrand[b] || 0) + 1;
  byVerdict[r.verdict] = (byVerdict[r.verdict] || 0) + 1;
}

console.log('═══════════════════════════════════════════════════════');
console.log(' WTB Report');
console.log('═══════════════════════════════════════════════════════');
console.log(`  Total WTB rows found: ${totalWTB}`);
console.log(`  Total WTB records:    ${wtbRecords.length}`);
console.log('\n  By brand:');
Object.entries(byBrand).sort((a,b) => b[1]-a[1]).forEach(([b,c]) => console.log(`    ${b}: ${c}`));
console.log('\n  By verdict:');
Object.entries(byVerdict).sort((a,b) => b[1]-a[1]).forEach(([v,c]) => console.log(`    ${v}: ${c}`));
console.log(`\n  Saved: ${DOWNLOADS}/WF_WTB_report.xlsx`);

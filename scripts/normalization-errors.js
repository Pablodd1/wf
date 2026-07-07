#!/usr/bin/env node
/**
 * normalization-errors.js v1
 * Scans all WTS TSV files for normalization errors.
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const DESKTOP = '/mnt/c/Users/jasme/Desktop';
const OUT = '/mnt/c/Users/jasme/Downloads';

const files = fs.readdirSync(DESKTOP)
  .filter(f => f.startsWith('WF_WTS_') && f.endsWith('_corrected.tsv'));

console.log(`Scanning ${files.length} files for errors...`);

const errorRows = [];
let totalRows = 0;
const errorCounts = {};

for (const file of files) {
  const brand = file.replace('WF_WTS_', '').replace('_corrected.tsv', '').replace(/_/g, ' ');
  const lines = fs.readFileSync(path.join(DESKTOP, file), 'utf8').split('\n');
  const header = lines[0].split('\t');

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    totalRows++;
    const cols = lines[i].split('\t');
    const row = {};
    header.forEach((h, idx) => { row[h] = cols[idx] || ''; });

    const ref = row.reference || '';
    const dial = row.dial_color || '';
    const price = row.price_usd || '';
    const raw = row.raw_message || '';

    // Error checks
    const errors = [];

    // 1. Ref has price pattern
    if (/\d{4,6}(00|000|500)/.test(ref) && !/(PAM|RM|L\d)/.test(ref)) {
      errors.push({ type: 'ref_has_price', detail: ref });
    }

    // 2. Ref has year (18xx, 19xx, 20xx)
    if (/(18|19|20)\d{2}/.test(ref)) {
      errors.push({ type: 'ref_has_year', detail: ref });
    }

    // 3. Dial color not a color
    if (dial && /(USD|HKD|N\d|f\.s|s\.s)/.test(dial)) {
      errors.push({ type: 'dial_not_color', detail: dial });
    }

    // 4. Price not numeric
    if (price && isNaN(parseFloat(price))) {
      errors.push({ type: 'price_not_numeric', detail: price });
    }

    // 5. Ref looks like another brand's pattern
    if (brand === 'Rolex' && /^(RM|PAM|W\d{4})/i.test(ref)) {
      errors.push({ type: 'ref_wrong_brand', detail: ref });
    }

    if (errors.length > 0) {
      errors.forEach(err => {
        errorRows.push({
          brand,
          row_index: i,
          raw_snippet: raw.substring(0, 120),
          reference: ref,
          dial_color: dial,
          price,
          verdict: row.verdict,
          error_type: err.type,
          error_detail: err.detail,
        });
        errorCounts[err.type] = (errorCounts[err.type] || 0) + 1;
      });
    }
  }
}

// Save error report
const ws = XLSX.utils.json_to_sheet(errorRows);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Normalization Errors');
XLSX.writeFile(wb, path.join(OUT, 'WF_NORMALIZATION_ERRORS.xlsx'));

// Summary
console.log(`\n=== SUMMARY ===`);
console.log(`Total rows scanned: ${totalRows}`);
console.log(`Total errors found: ${errorRows.length}`);
console.log(`\nTop error types:`);
Object.entries(errorCounts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5)
  .forEach(([type, count]) => {
    console.log(`  ${type}: ${count}`);
  });

console.log(`\nReport saved: WF_NORMALIZATION_ERRORS.xlsx`);

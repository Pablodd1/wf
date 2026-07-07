#!/usr/bin/env node
/**
 * fix-reports-inplace.js v1
 * Edits the Desktop TSV files to fix the most common errors:
 * 1. Rows where reference column has a price (ends in 00/000/500)
 * 2. Rows where dial_color has non-color text
 * 
 * Reads Desktop TSV files, fixes errors, overwrites the same files.
 */

const fs = require('fs');
const path = require('path');

const DESKTOP = '/mnt/c/Users/jasme/Desktop';
const files = fs.readdirSync(DESKTOP)
  .filter(f => f.startsWith('WF_WTS_') && f.endsWith('_corrected.tsv'));

console.log(`Fixing ${files.length} brand files...`);

let totalFixed = 0;

for (const file of files) {
  const filePath = path.join(DESKTOP, file);
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const header = lines[0].split('\t');
  const refIdx = header.indexOf('reference');
  const dialIdx = header.indexOf('dial_color');
  const rawIdx = header.indexOf('raw_message');
  const verdictIdx = header.indexOf('verdict');

  let fileFixed = 0;

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = lines[i].split('\t');

    // Fix 1: Reference has price pattern
    if (refIdx >= 0 && cols[refIdx]) {
      const ref = cols[refIdx];
      // If ref is a pure number ending in 00/000/500 AND raw message has no brand keywords
      if (/^\d{4,6}(00|000|500)$/.test(ref)) {
        const raw = rawIdx >= 0 ? cols[rawIdx].toLowerCase() : '';
        const hasBrandKeyword = /(rolex|submariner|datejust|daytona|gmt|oyster|patek|audemars|omega|cartier)/i.test(raw);
        if (!hasBrandKeyword) {
          // This is a price, not a ref — clear it
          cols[refIdx] = '';
          // Change verdict to HUMAN for manual review
          if (verdictIdx >= 0) cols[verdictIdx] = 'HUMAN';
          fileFixed++;
        }
      }
    }

    // Fix 2: Dial color has non-color text
    if (dialIdx >= 0 && cols[dialIdx]) {
      const dial = cols[dialIdx];
      // Common non-color patterns in dial field
      if (/(USD|HKD|N\d|f\.s|s\.s|k\.c|watch|box|papers)/i.test(dial)) {
        cols[dialIdx] = '';  // Clear invalid dial color
        fileFixed++;
      }
    }

    lines[i] = cols.join('\t');
  }

  fs.writeFileSync(filePath, lines.join('\n'));
  totalFixed += fileFixed;
  if (fileFixed > 0) {
    console.log(`  ${file}: ${fileFixed} fixes`);
  }
}

console.log(`\nTotal fixes: ${totalFixed}`);
console.log(`Done — files overwritten in-place.`);

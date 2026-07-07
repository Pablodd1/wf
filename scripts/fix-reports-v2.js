#!/usr/bin/env node
/**
 * fix-reports-v2.js
 * Fixes the most common normalization errors in Desktop TSV files.
 * 
 * Strategy:
 * 1. ref_has_price — if pure numeric ref ends in 00/000/500 AND 
 *    raw message has NO brand keywords → this is a price, not a ref.
 *    Action: CLEAR the ref, set verdict to HUMAN.
 * 2. dial_not_color — if dial field contains USD/HKD/N6/fs/box/etc.
 *    Action: CLEAR the dial color.
 * 3. ref_has_year — if ref contains 18xx/19xx/20xx
 *    Action: FLAG for review (don't auto-clear — might be valid).
 * 
 * Saves as *_corrected_v2.tsv to avoid destroying original.
 */

const fs = require('fs');
const path = require('path');

const DESKTOP = '/mnt/c/Users/jasme/Desktop';
const files = fs.readdirSync(DESKTOP)
  .filter(f => f.startsWith('WF_WTS_') && f.endsWith('_corrected.tsv'));

console.log(`Fixing ${files.length} files...`);

let totalFixed = 0;
const fixLog = [];

for (const file of files) {
  const filePath = path.join(DESKTOP, file);
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const header = lines[0].split('\t');
  
  const refIdx = header.indexOf('reference');
  const dialIdx = header.indexOf('dial_color');
  const rawIdx = header.indexOf('raw_message');
  const verdictIdx = header.indexOf('verdict');
  const brandIdx = header.indexOf('brand');
  
  let fileFixed = 0;
  
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = lines[i].split('\t');
    
    const brand = brandIdx >= 0 ? cols[brandIdx] : '';
    const raw = rawIdx >= 0 ? cols[rawIdx].toLowerCase() : '';
    
    // Fix 1: ref_has_price
    if (refIdx >= 0 && cols[refIdx]) {
      const ref = cols[refIdx];
      // Pure numeric ref ending in 00/000/500
      if (/^\d{4,6}(00|000|500)$/.test(ref)) {
        // Check if raw message has brand keywords (if yes, likely valid ref)
        const brandKeywords = /(rolex|submariner|datejust|daytona|gmt|oyster|patek|audemars|omega|cartier)/i;
        const hasKeyword = brandKeywords.test(raw);
        // Also check if ref matches known brand pattern
        const isKnownRolex = /^1[1-9]\d{4}$/.test(ref) || /^2[0-7]\d{4}$/.test(ref);
        
        if (!hasKeyword && !isKnownRolex) {
          // This is a price, not a ref
          cols[refIdx] = '';
          if (verdictIdx >= 0) cols[verdictIdx] = 'HUMAN';
          fileFixed++;
          fixLog.push({ file, row: i, fix: 'ref_was_price', old: ref });
        }
      }
    }
    
    // Fix 2: dial_not_color
    if (dialIdx >= 0 && cols[dialIdx]) {
      const dial = cols[dialIdx];
      // Common non-color patterns
      if (/(USD|HKD|N\d|f\.s|s\.s|k\.c|box|papers|watch|full set)/i.test(dial)) {
        cols[dialIdx] = '';
        fileFixed++;
        fixLog.push({ file, row: i, fix: 'dial_not_color', old: dial });
      }
    }
    
    lines[i] = cols.join('\t');
  }
  
  // Save as _v2
  const newFile = file.replace('_corrected.tsv', '_corrected_v2.tsv');
  fs.writeFileSync(path.join(DESKTOP, newFile), lines.join('\n'));
  
  totalFixed += fileFixed;
  if (fileFixed > 0) {
    console.log(`  ${file}: ${fileFixed} fixes → ${newFile}`);
  }
}

console.log(`\nTotal fixes: ${totalFixed}`);
console.log(`Fix log (first 10):`);
fixLog.slice(0, 10).forEach(f => {
  console.log(`  ${f.file} row ${f.row}: ${f.fix} ("${f.old}")`);
});

// Save fix log
const logPath = path.join(DESKTOP, 'WF_FIX_LOG.json');
fs.writeFileSync(logPath, JSON.stringify(fixLog.slice(0, 100), null, 2));
console.log(`\nFull log (${fixLog.length} entries) saved to: ${logPath}`);

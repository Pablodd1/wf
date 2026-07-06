#!/usr/bin/env node
/**
 * test-fixes.js — Test improved parser against labeled listings data
 * Generates corrected WTS/WTB report showing what the v4.1 parser catches
 */

const fs = require('fs');
const path = require('path');
const { parseFull, splitMultiWatch } = require('../api/_lib/parser');

const LABELED_PATH = '/home/jasme/wf-training-data/labeled_listings.csv';
const SAMPLE_SIZE = 5000;

const raw = fs.readFileSync(LABELED_PATH, 'utf8');
const lines = raw.split('\n').slice(1); // skip header

const results = [];
let multiWatchCount = 0;
let correctionsFound = 0;
let totalProcessed = 0;
let stats = {
  refCleaned: 0,      // garbage refs fixed
  brandFixed: 0,      // brand corrections
  dialFixed: 0,       // dial color corrections
  multiWatchSplit: 0, // multi-watch detected
  priceAdded: 0,      // price newly detected
};

for (let i = 0; i < Math.min(SAMPLE_SIZE, lines.length); i++) {
  const line = lines[i];
  if (!line.trim()) continue;

  // Parse tab-separated CSV
  const cols = line.split('\t');
  if (cols.length < 9) continue;

  const title = cols[0].replace(/^"|"$/g, '');
  const oldBrand = cols[1] || '';
  const oldModel = cols[2] || '';
  const oldRef = cols[3] || '';
  const oldNormRef = cols[4] || '';
  const oldDial = cols[5] || '';

  totalProcessed++;

  // Check for multi-watch
  const multiParts = splitMultiWatch(title);
  if (multiParts.length > 1) {
    multiWatchCount++;
    stats.multiWatchSplit++;
  }

  // Parse with improved parser
  const parsed = parseFull(title);

  const newRef = parsed.ref || '';
  const newBrand = parsed.brand || '';
  const newDial = parsed.dial || '';
  const newPrice = parsed.price || null;

  // Detect garbage in old ref (HKD, USDT, $, descriptions)
  const oldRefHasGarbage = oldRef && (
    /HKD|USDT|USD|EUR|GBP/i.test(oldRef) ||
    oldRef.includes('$') ||
    /\d{4,7}\s*(?:HKD|USD|USDT)/i.test(oldRef) ||
    oldRef.length > 20 // full description in ref field
  );

  const refChanged = oldRef && newRef && oldRef.toUpperCase() !== newRef.toUpperCase();
  const brandChanged = oldBrand && newBrand && oldBrand !== newBrand;
  const dialChanged = oldDial && newDial && oldDial.toLowerCase() !== newDial.toLowerCase();

  if (oldRefHasGarbage && newRef && !oldRefHasGarbage) stats.refCleaned++;
  if (brandChanged) stats.brandFixed++;
  if (dialChanged) stats.dialFixed++;
  if (newPrice && !oldRef) stats.priceAdded++;

  if (refChanged || brandChanged || dialChanged || oldRefHasGarbage) {
    correctionsFound++;
    if (results.length < 50) {
      results.push({
        title: title.substring(0, 100),
        old: { brand: oldBrand, ref: oldRef, normRef: oldNormRef, dial: oldDial },
        new: { brand: newBrand, ref: newRef, dial: newDial, price: newPrice },
        multiWatch: multiParts.length > 1 ? multiParts.length + ' watches' : null,
        issues: {
          refGarbage: oldRefHasGarbage,
          refChanged,
          brandChanged,
          dialChanged,
        }
      });
    }
  }
}

console.log('═══════════════════════════════════════════════════════');
console.log(' PARSER v4.1 CORRECTION REPORT');
console.log('═══════════════════════════════════════════════════════');
console.log('  Total processed:    ', totalProcessed.toLocaleString());
console.log('  Multi-watch split:  ', stats.multiWatchSplit);
console.log('  Corrections found:  ', correctionsFound);
console.log('');
console.log('  Correction breakdown:');
console.log('    Brand fixed:      ', stats.brandFixed);
console.log('    Dial corrected:   ', stats.dialFixed);
console.log('    Price newly found:', stats.priceAdded);
console.log('');
console.log('═══════════════════════════════════════════════════════');
console.log(' SAMPLE CORRECTIONS (first 20)');
console.log('═══════════════════════════════════════════════════════');

results.slice(0, 20).forEach((r, i) => {
  console.log('\n' + (i+1) + '. ' + r.title);
  console.log('   OLD:', JSON.stringify(r.old));
  console.log('   NEW:', JSON.stringify(r.new));
  if (r.multiWatch) console.log('   MULTI:', r.multiWatch);
  const issues = Object.entries(r.issues).filter(([k,v]) => v).map(([k]) => k);
  if (issues.length) console.log('   ISSUES:', issues.join(', '));
});

// Save full results as JSON
const reportPath = '/home/jasme/wf/scripts/v41-correction-report.json';
fs.writeFileSync(reportPath, JSON.stringify({
  stats: { totalProcessed, correctionsFound, ...stats },
  samples: results,
}, null, 2));
console.log('\nFull report saved to:', reportPath);

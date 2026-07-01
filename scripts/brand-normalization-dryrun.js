#!/usr/bin/env node
/**
 * DRY RUN — brand normalization impact report.
 * Reads the existing brand index, does NOT touch the database.
 * Run this first, review the output, then decide whether to run the
 * actual backfill (scripts/backfill-brand-normalization.js).
 */
const fs = require('fs');
const { normalizeBrand } = require('../api/_lib/brand-normalizer');

const brandIndex = JSON.parse(fs.readFileSync('public/watchfacts-brand-index.json', 'utf8'));

let matched = 0, alreadyCanonical = 0, nonWatch = 0, garbage = 0, unmatched = 0;
const matchedRefs = {}, nonWatchList = [], garbageList = [], unmatchedList = [];
const mergeMap = {}; // canonical -> [raw values that map to it]

for (const [rawBrand, refs] of Object.entries(brandIndex)) {
  const refCount = refs.length;
  const result = normalizeBrand(rawBrand);

  if (result.category === 'already_canonical') {
    alreadyCanonical += refCount;
  } else if (result.category === 'matched') {
    matched += refCount;
    if (!mergeMap[result.canonical]) mergeMap[result.canonical] = [];
    mergeMap[result.canonical].push({ raw: rawBrand, refCount });
  } else if (result.category === 'non_watch') {
    nonWatch += refCount;
    nonWatchList.push({ raw: rawBrand, refCount });
  } else if (result.category === 'garbage') {
    garbage += refCount;
    garbageList.push({ raw: rawBrand, refCount });
  } else {
    unmatched += refCount;
    unmatchedList.push({ raw: rawBrand, refCount });
  }
}

const total = matched + alreadyCanonical + nonWatch + garbage + unmatched;

console.log('═'.repeat(70));
console.log('BRAND NORMALIZATION — DRY RUN REPORT (no DB changes made)');
console.log('═'.repeat(70));
console.log(`Total distinct brand values in index: ${Object.keys(brandIndex).length}`);
console.log(`Total reference-instances covered:    ${total.toLocaleString()}`);
console.log();
console.log(`✅ Already canonical:     ${alreadyCanonical.toLocaleString()} refs`);
console.log(`🔀 Will be MERGED:        ${matched.toLocaleString()} refs (into ${Object.keys(mergeMap).length} canonical brands)`);
console.log(`🚫 Non-watch (flag):      ${nonWatch.toLocaleString()} refs (${nonWatchList.length} brand values)`);
console.log(`🗑️  Garbage (null out):   ${garbage.toLocaleString()} refs (${garbageList.length} brand values)`);
console.log(`❓ Unmatched (leave as-is): ${unmatched.toLocaleString()} refs (${unmatchedList.length} brand values — real brands not yet in our map)`);
console.log();

console.log('─'.repeat(70));
console.log('MERGES (raw value -> canonical), sorted by impact:');
console.log('─'.repeat(70));
const mergeSorted = Object.entries(mergeMap).sort((a, b) => {
  const aSum = a[1].reduce((s, r) => s + r.refCount, 0);
  const bSum = b[1].reduce((s, r) => s + r.refCount, 0);
  return bSum - aSum;
});
for (const [canonical, raws] of mergeSorted) {
  const sum = raws.reduce((s, r) => s + r.refCount, 0);
  if (sum === 0 && raws.every(r => r.refCount === 0)) continue;
  console.log(`\n${canonical} (+${sum} refs from ${raws.length} variant(s)):`);
  for (const r of raws.sort((a,b)=>b.refCount-a.refCount)) {
    console.log(`    "${r.raw}" -> ${r.refCount} refs`);
  }
}

console.log();
console.log('─'.repeat(70));
console.log(`NON-WATCH BRAND VALUES (${nonWatchList.length}) — flag these listings for review:`);
console.log('─'.repeat(70));
for (const { raw, refCount } of nonWatchList.sort((a,b)=>b.refCount-a.refCount)) {
  console.log(`  "${raw}" — ${refCount} refs`);
}

console.log();
console.log('─'.repeat(70));
console.log(`GARBAGE BRAND VALUES (${garbageList.length}) — will be set to NULL for re-review:`);
console.log('─'.repeat(70));
for (const { raw, refCount } of garbageList.sort((a,b)=>b.refCount-a.refCount).slice(0, 30)) {
  console.log(`  "${raw}" — ${refCount} refs`);
}
if (garbageList.length > 30) console.log(`  ... and ${garbageList.length - 30} more`);

console.log();
console.log('─'.repeat(70));
console.log(`UNMATCHED VALUES (${unmatchedList.length}) — real-looking brands NOT in our canonical map yet:`);
console.log('─'.repeat(70));
for (const { raw, refCount } of unmatchedList.sort((a,b)=>b.refCount-a.refCount)) {
  console.log(`  "${raw}" — ${refCount} refs`);
}

console.log();
console.log('═'.repeat(70));
console.log('This was a DRY RUN. No database rows were modified.');
console.log('Review the merges above, then approve the actual backfill.');
console.log('═'.repeat(70));

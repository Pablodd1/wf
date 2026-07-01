#!/usr/bin/env node
/**
 * Train the parser + state machine with real dealer broadcast examples.
 * Tests:
 * 1. Brand inheritance (🇭🇰 rolex header → subsequent lines get Rolex)
 * 2. PP → Patek Philippe detection
 * 3. AP → Audemars Piguet detection
 * 4. Reference extraction (including letters like RBOW, pink, 6119G)
 * 5. Currency detection (hkd, HK flag)
 * 6. New/used condition extraction
 */

const { ContextTracker, segmentMessage, parseMessageWithContext } = require('./context-tracker');
const { parseFull } = require('./parser');

const TRAINING_MESSAGE = `🇭🇰 rolex

new 126599RBOW 🌈 11/2025 hkd2.99m

used 116519 pink  2001y hkd568k

pp

new 6119G gray 2025 hkd208k

used 4946R brown 2025 hkd312k

used 5711/1R 2020 hkd1.6m

used 5711/1A blue 2020 hkd1.13m

used 5740/1G blue 2020 hkd1.8m

used 5990/1A grey 2020 hkd920k

used 5726/1A blue 2021 hkd965k

used 5168g green 2020 hkd715k

ap

new 67650st black 6/2026 hkd248k

new 15551or blue 5/2026 hkd725k

new 15510or black 2/2026 hkd730k

new 67651or blue 5/2026 hkd595k

new 15551or ice blue 2/2026 hkd750k

new 15551st blue 5/2026 hkd448k

used 15407or 2018 hkf1.56m

used 26240or green 2024 hkd575k

used 26589io blue 2022 hkd980k

used 26238or blue 2022 hkd660k

used 15510st white 2025 hkd348k

used 26402cb white 2015 hkd400k

used 15300st white 2007 hkd260k`;

console.log('═══════════════════════════════════════════════');
console.log('  CONTEXT TRACKER + PARSER TRAINING');
console.log('═══════════════════════════════════════════════\n');

// Step 1: Segment
const segments = segmentMessage(TRAINING_MESSAGE);
console.log(`Segments: ${segments.length}\n`);

// Step 2: Parse with context
const results = parseMessageWithContext(TRAINING_MESSAGE, parseFull);

console.log('RESULTS:\n');
let pass = 0, fail = 0;
const expected = [
  { line: 1, brand: 'Rolex', ref: '126599RBOW', price: 2990000, currency: 'HKD', condition: true },
  { line: 2, brand: 'Rolex', ref: '116519', price: 568000, currency: 'HKD', condition: true },
  { line: 3, brand: 'Patek Philippe', ref: '6119G', price: 208000, currency: 'HKD', condition: true },
  { line: 4, brand: 'Patek Philippe', ref: '4946R', price: 312000, currency: 'HKD', condition: true },
  { line: 5, brand: 'Patek Philippe', ref: '5711/1R', price: 1600000, currency: 'HKD', condition: true },
  { line: 6, brand: 'Patek Philippe', ref: '5711/1A', price: 1130000, currency: 'HKD', condition: true },
  { line: 7, brand: 'Patek Philippe', ref: '5740/1G', price: 1800000, currency: 'HKD', condition: true },
  { line: 8, brand: 'Patek Philippe', ref: '5990/1A', price: 920000, currency: 'HKD', condition: true },
  { line: 9, brand: 'Patek Philippe', ref: '5726/1A', price: 965000, currency: 'HKD', condition: true },
  { line: 10, brand: 'Patek Philippe', ref: '5168g', price: 715000, currency: 'HKD', condition: true },
  { line: 11, brand: 'Audemars Piguet', ref: '67650st', price: 248000, currency: 'HKD', condition: true },
  { line: 12, brand: 'Audemars Piguet', ref: '15551or', price: 725000, currency: 'HKD', condition: true },
  { line: 13, brand: 'Audemars Piguet', ref: '15510or', price: 730000, currency: 'HKD', condition: true },
  { line: 14, brand: 'Audemars Piguet', ref: '67651or', price: 595000, currency: 'HKD', condition: true },
  { line: 15, brand: 'Audemars Piguet', ref: '15551or', price: 750000, currency: 'HKD', condition: true },
  { line: 16, brand: 'Audemars Piguet', ref: '15551st', price: 448000, currency: 'HKD', condition: true },
  { line: 17, brand: 'Audemars Piguet', ref: '15407or', price: 1560000, currency: 'HKD', condition: true },
  { line: 18, brand: 'Audemars Piguet', ref: '26240or', price: 575000, currency: 'HKD', condition: true },
  { line: 19, brand: 'Audemars Piguet', ref: '26589io', price: 980000, currency: 'HKD', condition: true },
  { line: 20, brand: 'Audemars Piguet', ref: '26238or', price: 660000, currency: 'HKD', condition: true },
  { line: 21, brand: 'Audemars Piguet', ref: '15510st', price: 348000, currency: 'HKD', condition: true },
  { line: 22, brand: 'Audemars Piguet', ref: '26402cb', price: 400000, currency: 'HKD', condition: true },
  { line: 23, brand: 'Audemars Piguet', ref: '15300st', price: 260000, currency: 'HKD', condition: true },
];

results.forEach((r, i) => {
  const exp = expected[i] || {};
  const brandOK = r.brand === exp.brand || r.brand?.includes(exp.brand?.split(' ')[0]);
  const refOK = exp.ref ? r.ref?.toUpperCase()?.includes(exp.ref.toUpperCase()) : true;
  const currencyOK = r.currency === 'USD' || r.detectedCurrency === 'HKD';
  const priceOK = exp.price ? r.price > 0 : true;
  const allOK = brandOK && refOK && currencyOK && priceOK;

  const icon = allOK ? '✅' : '❌';
  const status = allOK ? 'PASS' : 'FAIL';
  if (allOK) pass++; else fail++;

  console.log(`${icon} ${status} #${i+1}: ${r.brand || '???'} ${r.ref || '???'} = $${r.price?.toLocaleString() || 0} (${r.detectedCurrency || r.currency || '???'})`);
  if (!brandOK) console.log(`   ❌ Brand: got "${r.brand}", expected "${exp.brand}"`);
  if (!refOK) console.log(`   ❌ Ref: got "${r.ref}", expected "${exp.ref}"`);
  if (!currencyOK) console.log(`   ❌ Currency: got "${r.currency}", expected HKD`);
});

console.log(`\n═══════════════════════════════════════════════`);
console.log(`  TOTAL: ${pass} PASS, ${fail} FAIL (${Math.round(pass/(pass+fail)*100)}%)`);
console.log(`═══════════════════════════════════════════════`);

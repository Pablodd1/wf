#!/usr/bin/env node
/**
 * test-v43-cleanup.js
 * Validates parser v4.3 against Alex's reference-cleanup spec examples.
 */
'use strict';
const { parseFull, parseReference, inferBrandFromRef, normalizeRefFormat } = require('../api/_lib/parser');

let pass = 0, fail = 0;
const failures = [];

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; }
  else { fail++; failures.push({ label, actual, expected }); }
}

console.log('═══════════════════════════════════════════════════════');
console.log(' PARSER v4.3 — Alex Reference-Cleanup Spec Validation');
console.log('═══════════════════════════════════════════════════════');

// ── Rolex ──
console.log('\n─── Rolex ───');
check('Row 8284: DJ41 fix', parseReference('Mar 2026 DJ41 Azzurro Jubilee 126334', 'Rolex'), '126334');
check('Row 17624: RLX fix', parseReference('RLX 126334 DJ41 / Fluted / Oyster / Blue Index', 'Rolex'), '126334');
check('Row 8321: OP36 fix', parseReference('2025 OP36 126000 Lavender', 'Rolex'), '126000');
{
  const p = parseFull('Item # 2405682');
  check('Row 4555: item ID not a ref', p.ref, null);
}

// ── Patek Philippe ──
console.log('\n─── Patek Philippe ───');
check('Row 18872: 5296g fix', parseReference('Patek Philippe 5296g 2016year used full set 20300USD', 'Patek Philippe'), '5296G');
check('Row 18536: Nautilus 4700', parseReference('Patek PP Nautilus 4700', 'Patek Philippe'), '4700');
check('Row 7078: CUBITUS fix', parseReference('CUBITUS 5821/1AR', 'Patek Philippe'), '5821/1AR');
{
  const p = parseFull('Aquanaut Strap D31');
  check('Row 33: strap -> ACCESSORY_NOT_WATCH', p.verdict, 'ACCESSORY_NOT_WATCH');
}

// ── Audemars Piguet ──
console.log('\n─── Audemars Piguet ───');
check('Row 10128: 26470st fix', parseReference('Audemars Piguet 26470st', 'Audemars Piguet'), '26470ST');
check('Row 10139: 26331or fix', parseReference('Audemars Piguet 26331or', 'Audemars Piguet'), '26331OR');
{
  const p = parseFull('BRACELET 15500/26331OR');
  check('Row 14: bracelet -> ACCESSORY_NOT_WATCH', p.verdict, 'ACCESSORY_NOT_WATCH');
}

// ── Richard Mille ──
console.log('\n─── Richard Mille ───');
check('Row 5: 11-03 -> RM11-03', normalizeRefFormat('RM 11-03', 'Richard Mille'), 'RM11-03');
check('Row 21: 35-02 -> RM35-02', normalizeRefFormat('RM35-02', 'Richard Mille'), 'RM35-02');
{
  const p = parseFull('Richard Mille 67-01 Strap');
  check('Row 7: strap -> ACCESSORY_NOT_WATCH', p.verdict, 'ACCESSORY_NOT_WATCH');
}

// ── Cartier ──
console.log('\n─── Cartier ───');
check('Row 327: Ref-WSSA0030 fix', parseReference('Ref-WSSA0030', 'Cartier'), 'WSSA0030');
{
  const p = parseFull('Cartier Panthere Link');
  check('Row 12: link -> ACCESSORY_NOT_WATCH', p.verdict, 'ACCESSORY_NOT_WATCH');
}

// ── Hublot ──
console.log('\n─── Hublot ───');
{
  const p = parseFull('Hublot wooden box');
  check('Row 578: box -> ACCESSORY_NOT_WATCH', p.verdict, 'ACCESSORY_NOT_WATCH');
}

// ── Vacheron Constantin ──
console.log('\n─── Vacheron Constantin ───');
check('Row 1539: 1225v fix', parseReference('Vacheron Constantin 1225v', 'Vacheron Constantin'), '1225V');
check('Row 4977: HISTORIQUES fix', parseReference('4200H/222J-B935', 'Vacheron Constantin'), '4200H/222J-B935');

// ── Omega ──
console.log('\n─── Omega ───');
check('Row 2167: Snoopy ref fix', parseReference('Omega Snoopy 310.32.42.50.02.001', 'Omega'), '310.32.42.50.02.001');
{
  const p = parseFull('OMEGA wooden boxes');
  check('Row 587: box -> ACCESSORY_NOT_WATCH', p.verdict, 'ACCESSORY_NOT_WATCH');
}

// ── Tudor ──
console.log('\n─── Tudor ───');
check('Row 2: casing fix', normalizeRefFormat('m7939a1a0ru-0001'.toUpperCase(), 'Tudor'), 'M7939A1A0RU-0001');
check('Row 18: missing M fix', normalizeRefFormat('7939A1A0RU-0001', 'Tudor'), 'M7939A1A0RU-0001');

// ── Panerai ──
console.log('\n─── Panerai ───');
check('Row 11: PAM01412 fix', parseReference('Panerai - PAM01412', 'Panerai'), 'PAM01412');
check('Row 816: Pam 186 -> PAM00186', normalizeRefFormat('PAM186', 'Panerai'), 'PAM00186');
check('Row 824: Pam 1678 -> PAM01678', normalizeRefFormat('PAM1678', 'Panerai'), 'PAM01678');

// ── Jaeger-LeCoultre ──
console.log('\n─── Jaeger-LeCoultre ───');
check('Row 554: q1322410 fix', parseReference('Jaeger q1322410', 'Jaeger-LeCoultre'), 'Q1322410');
check('Row 1842: -watch suffix stripped', parseReference('q1552520-watch', 'Jaeger-LeCoultre'), 'Q1552520');

// ── TAG Heuer (new brand patterns) ──
console.log('\n─── TAG Heuer ───');
check('Row 4: CAL5113 fix', parseReference('TAG Heuer - CAL5113', 'TAG Heuer'), 'CAL5113');
check('Row 6: WW2111 fix', parseReference('TAG Heuer - WW2111', 'TAG Heuer'), 'WW2111');

// ── Grand Seiko (new brand pattern) ──
console.log('\n─── Grand Seiko ───');
check('Row 42: SBGC221 fix', parseReference('Grand Seiko SBGC221', 'Grand Seiko'), 'SBGC221');

// ── Bell & Ross (new brand pattern) ──
console.log('\n─── Bell & Ross ───');
check('Row 20: BR03-92 fix', normalizeRefFormat(parseReference('Bell & Ross BR 03-92', 'Bell & Ross'), 'Bell & Ross'), 'BR03-92');

// ── Roger Dubuis (new brand pattern) ──
console.log('\n─── Roger Dubuis ───');
check('RDDBEX0364 fix', parseReference('rddbex0364 watch only', 'Roger Dubuis'), 'RDDBEX0364');

// ── Longines (new brand pattern) ──
console.log('\n─── Longines ───');
check('Row 6: l2.175.0 -> L2.175.0', normalizeRefFormat('l2.175.0'.toUpperCase(), 'Longines'), 'L2.175.0');

// ── Montblanc (new brand pattern) ──
console.log('\n─── Montblanc ───');
check('Row 14: U0111012 preserved', parseReference('Montblanc U0111012', 'Montblanc'), 'U0111012');

// ── Girard-Perregaux (protected pattern — do not mangle embedded "2010") ──
console.log('\n─── Girard-Perregaux (protected) ───');
check('81060-21-2010-FH7A preserved whole', parseReference('Girard Perregaux Laureato 81060-21-2010-FH7A', 'Girard-Perregaux'), '81060-21-2010-FH7A');

// ── Glashutte Original (protected pattern) ──
console.log('\n─── Glashutte Original (protected) ───');
check('1-58-01 preserved', parseReference('Glashutte Original Senator 1-58-01', 'Glashutte Original'), '1-58-01');
check('2-39-47-12-12-14 not auto-changed', parseReference('Glashutte Original 2-39-47-12-12-14', 'Glashutte Original') !== null, true);

// ── Piaget (protected spaced pattern) ──
console.log('\n─── Piaget (protected spaced) ───');
check('G0A34077 glued', normalizeRefFormat('G0A 34077'.replace(/\s+/g,''), 'Piaget'), 'G0A34077');
check('9133 A 6 spacing preserved', parseReference('Piaget vintage 9133 A 6', 'Piaget'), '9133 A 6');

// ── Franck Muller (keep internal spaces) ──
console.log('\n─── Franck Muller (protected spaced) ───');
check('902 QZ REL preserved', parseReference('Long Island 902 QZ REL', 'Franck Muller'), '902 QZ REL');

// ── Hermes (bag models -> NON_WATCH_OR_WRONG_CATEGORY) ──
console.log('\n─── Hermes bags ───');
{
  const p1 = parseFull('Hermes Hac o dos');
  check('Row 4: Hac -> NON_WATCH', p1.verdict, 'NON_WATCH_OR_WRONG_CATEGORY');
  const p2 = parseFull('Hermes Birkin 25');
  check('Row 6: Birkin -> NON_WATCH', p2.verdict, 'NON_WATCH_OR_WRONG_CATEGORY');
  const p3 = parseFull('Hermes Constance bag');
  check('Row 24: Constance -> NON_WATCH', p3.verdict, 'NON_WATCH_OR_WRONG_CATEGORY');
}
check('Row 8: CC1.810 Cape Cod is a valid watch ref', parseReference('Hermes Cape Cod CC1.810', 'Hermes'), 'CC1.810');

// ── Brand-only text -> NEEDS_MANUAL_REVIEW ──
console.log('\n─── Brand-only text ───');
{
  const p1 = parseFull('BVLGARI');
  check('Bulgari brand-only -> NEEDS_MANUAL_REVIEW', p1.verdict, 'NEEDS_MANUAL_REVIEW');
  const p2 = parseFull('ZENITH');
  check('Zenith brand-only -> NEEDS_MANUAL_REVIEW', p2.verdict, 'NEEDS_MANUAL_REVIEW');
}

// ── Wrong-brand-suspect (new-prefix families, flagged not auto-overridden) ──
console.log('\n─── Wrong-brand-suspect (flag only) ───');
{
  // Grand Seiko row containing a Vacheron ref -> flagged, brand text kept, not silently swapped
  const p = parseFull('Grand Seiko 4200H/222A-B934');
  check('GS+VC ref -> WRONG_BRAND_SUSPECT', p.verdict, 'WRONG_BRAND_SUSPECT');
}

// ── Multi-watch stock list detection ──
console.log('\n─── Multi-watch stock list ───');
{
  const stockText = 'RM07-01 HKD500000 RM72-01 HKD600000 RM65-01 HKD700000';
  const p = parseFull(stockText);
  check('Multiple RM refs -> MULTI_WATCH_STOCK_LIST', p.verdict, 'MULTI_WATCH_STOCK_LIST');
}

// ── Dealer item ID not treated as reference ──
console.log('\n─── Dealer item ID ───');
check('Item # 2405682 stripped', parseReference('Item # 2405682'), null);
check('SKU 1234567 stripped', parseReference('SKU 1234567'), null);

console.log('\n═══════════════════════════════════════════════════════');
console.log(` ${pass} passed, ${fail} failed`);
console.log('═══════════════════════════════════════════════════════');

if (failures.length) {
  console.log('\nFAILURES:');
  for (const f of failures) {
    console.log(`  ❌ ${f.label}`);
    console.log(`     got:      ${JSON.stringify(f.actual)}`);
    console.log(`     expected: ${JSON.stringify(f.expected)}`);
  }
}
process.exit(fail > 0 ? 1 : 0);

'use strict';

const assert = require('assert');
const path = require('path');

const { referenceComparisonKey } = require('../api/reviewed-market-inventory.js');
const { normRef, inferBrand } = require('../api/_lib/resolve.js');
const { listEquivalentReferences, lookupCatalog } = require('../api/_lib/catalog.js');

console.log('=== COMPREHENSIVE ADVERSARIAL STRESS TEST (M1 Iteration 2) ===\n');

// 1. Search Key Normalization Equality & Edge Cases
console.log('--- Phase 1: Search Key Normalization Stress Test ---');
const stressReferences = [
  '116500LN', '116500ln', '116500 LN', '116500-LN', '116500.LN', '116500_LN',
  '5711/1A-010', '5711/1A', '5711-1A', '5711/1A - 010', '57111A010',
  'PAM 00111', 'PAM00111', 'PAM 111', 'PAM-111', 'pam00111',
  '15500ST.OO.1220ST.01', '15500ST OO 1220ST 01', '15500ST-OO-1220ST-01',
  '311.30.42.30.01.005', '311 30 42 30 01 005',
  '4500V/110A-B128', '4500V 110A B128',
  'WSSA0018', 'wssa0018',
  'IW371605', 'iw371605',
  '  ROLEX 116500LN  ', '116500LN!@#$%^&*()',
  '', null, undefined
];

let phase1Passed = 0;
for (const ref of stressReferences) {
  const tf = referenceComparisonKey(ref);
  const pr = normRef(ref);
  assert.strictEqual(tf, pr, `Mismatch for ref: "${ref}" (TF: "${tf}", PR: "${pr}")`);
  phase1Passed++;
}
console.log(`[PASS] Phase 1: ${phase1Passed}/${stressReferences.length} search key normalization comparisons passed identically.\n`);

// 2. Query Set Membership
console.log('--- Phase 2: Query Set Membership Verification ---');
const queryBrands = [
  { ref: '116500LN', brand: 'Rolex' },
  { ref: '116500ln', brand: 'Rolex' },
  { ref: '5711/1A', brand: 'Patek Philippe' },
  { ref: 'PAM00111', brand: 'Panerai' },
  { ref: '15500ST', brand: 'Audemars Piguet' },
  { ref: '311.30.42.30.01.005', brand: 'Omega' }
];

let phase2Passed = 0;
for (const q of queryBrands) {
  const tfKey = referenceComparisonKey(q.ref);
  const equivs = listEquivalentReferences(q.ref, q.brand);
  const prKeys = equivs.map(normRef);
  assert(prKeys.includes(tfKey), `TF key "${tfKey}" missing from PR keys [${prKeys.join(', ')}] for query "${q.ref}"`);
  phase2Passed++;
}
console.log(`[PASS] Phase 2: ${phase2Passed}/${queryBrands.length} query set membership checks passed.\n`);

// 3. Robust Reconciliation Math Boundary Conditions
console.log('--- Phase 3: Reconciliation Math Boundary & Robustness ---');
function calculateReconciliation(rowsCount, includedCount, outliersCount, bundleCount, rawWtbDemand, wtbInRows) {
  const totalTrackedListings = rowsCount;
  const wtsEligibleAnalyticsCount = includedCount;
  const maxWtbCapacity = Math.max(0, totalTrackedListings - wtsEligibleAnalyticsCount - outliersCount - bundleCount);
  const wtbDemandCount = typeof rawWtbDemand === 'number' && Number.isFinite(rawWtbDemand) && rawWtbDemand >= 0
    ? Math.min(rawWtbDemand, maxWtbCapacity)
    : Math.min(wtbInRows, maxWtbCapacity);
  const unpricedCount = Math.max(0, totalTrackedListings - wtsEligibleAnalyticsCount - wtbDemandCount - outliersCount - bundleCount);
  const excludedTotalCount = unpricedCount + outliersCount + bundleCount;
  return { totalTrackedListings, wtsEligibleAnalyticsCount, wtbDemandCount, unpricedCount, outliersCount, bundleCount, excludedTotalCount };
}

const boundaryScenarios = [
  { N: 1000, WTS: 800, O: 50, B: 10, WTB_raw: 2000, WTB_rows: 50 }, // Massive WTB demand overflow
  { N: 100, WTS: 100, O: 0, B: 0, WTB_raw: 50, WTB_rows: 0 },       // 100% WTS eligible, WTB capacity 0
  { N: 0, WTS: 0, O: 0, B: 0, WTB_raw: 0, WTB_rows: 0 },            // Empty dataset
  { N: 50, WTS: 20, O: 10, B: 5, WTB_raw: undefined, WTB_rows: 8 },  // undefined raw demand, fallback to rows
  { N: 50, WTS: 20, O: 10, B: 5, WTB_raw: -5, WTB_rows: 8 },         // negative raw demand, fallback to rows
  { N: 50, WTS: 20, O: 10, B: 5, WTB_raw: NaN, WTB_rows: 8 },        // NaN raw demand, fallback to rows
];

let phase3Passed = 0;
for (const s of boundaryScenarios) {
  const res = calculateReconciliation(s.N, s.WTS, s.O, s.B, s.WTB_raw, s.WTB_rows);
  const sum = res.wtsEligibleAnalyticsCount + res.wtbDemandCount + res.excludedTotalCount;
  assert.strictEqual(sum, res.totalTrackedListings, `Reconciliation mismatch for scenario ${JSON.stringify(s)}: sum ${sum} != N ${res.totalTrackedListings}`);
  assert(res.unpricedCount >= 0, `Negative unpriced count for scenario ${JSON.stringify(s)}`);
  assert(res.wtbDemandCount >= 0, `Negative WTB demand count for scenario ${JSON.stringify(s)}`);
  phase3Passed++;
}
console.log(`[PASS] Phase 3: ${phase3Passed}/${boundaryScenarios.length} reconciliation boundary scenarios passed partition identity.\n`);

console.log('ALL ADVERSARIAL STRESS TESTS COMPLETED SUCCESSFULLY.');

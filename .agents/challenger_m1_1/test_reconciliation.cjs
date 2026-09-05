// Empirical test script for M1 reconciliation formula and search key matching

const { parseTradingSearch } = require('../../api/_lib/trading-search.cjs');
const { referenceComparisonKey } = require('../../api/reviewed-market-inventory.js');
const { normRef, inferBrand } = require('../../api/_lib/resolve.js');
const { listEquivalentReferences } = require('../../api/_lib/catalog.js');

console.log('--- TEST 1: Reconciliation Math Simulation ---');

function computeReconciliation(rowsLength, wtsEligible, wtbDemand, outliers, unsplitBundles) {
  const totalTrackedListings = rowsLength;
  const wtsEligibleAnalyticsCount = wtsEligible;
  const wtbDemandCount = wtbDemand;
  const outliersCount = outliers;
  const unsplitBundlesCount = unsplitBundles;

  const unpricedCount = Math.max(0, totalTrackedListings - wtsEligibleAnalyticsCount - wtbDemandCount - outliersCount - unsplitBundlesCount);
  const excludedTotalCount = unpricedCount + outliersCount + unsplitBundlesCount;

  const sum = wtsEligibleAnalyticsCount + wtbDemandCount + excludedTotalCount;
  const equals = (totalTrackedListings === sum);

  return {
    totalTrackedListings,
    wtsEligibleAnalyticsCount,
    wtbDemandCount,
    unpricedCount,
    outliersCount,
    unsplitBundlesCount,
    excludedTotalCount,
    sum,
    equals,
  };
}

// Case 1: Standard partition where sum of components <= totalTrackedListings
const case1 = computeReconciliation(100, 60, 10, 5, 2);
console.log('Case 1 (Standard):', case1);

// Case 2: Discrepancy where demand count from external table causes overflow
// Suppose totalTrackedListings = 50, but external demand_count = 20, wts = 35, outliers = 2, bundles = 1
const case2 = computeReconciliation(50, 35, 20, 2, 1);
console.log('Case 2 (Demand Overflow):', case2);

console.log('\n--- TEST 2: Reference Search Key Matching ---');

const testCases = [
  { ref: '116500LN', brand: 'Rolex' },
  { ref: 'Submariner', brand: 'Rolex' },
  { ref: '5711/1A-001', brand: 'Patek Philippe' },
  { ref: 'PAM00111', brand: 'Panerai' },
  { ref: '26331ST.OO.1220ST.01', brand: 'Audemars Piguet' },
];

for (const tc of testCases) {
  const tfKey = referenceComparisonKey(tc.ref);
  const prKeys = listEquivalentReferences(tc.ref, tc.brand).map(normRef);
  console.log(`Input: ref="${tc.ref}", brand="${tc.brand}"`);
  console.log(`  TF (reviewed-market-inventory): reference_search_key = "${tfKey}"`);
  console.log(`  PR (price-research): referenceKeys = ${JSON.stringify(prKeys)}`);
  const match = prKeys.includes(tfKey);
  console.log(`  Keys Match?: ${match ? 'YES' : 'NO'}`);
}

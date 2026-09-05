const assert = require('assert');

function computeReconciliationRefined(rowsLength, wtsEligible, rawWtbDemand, wtbInRows, outliers, unsplitBundles) {
  const totalTrackedListings = rowsLength;
  const wtsEligibleAnalyticsCount = wtsEligible;
  const outliersCount = outliers;
  const unsplitBundlesCount = unsplitBundles;

  const maxWtbCapacity = Math.max(0, totalTrackedListings - wtsEligibleAnalyticsCount - outliersCount - unsplitBundlesCount);
  const wtbDemandCount = typeof rawWtbDemand === 'number' && Number.isFinite(rawWtbDemand) && rawWtbDemand >= 0
    ? Math.min(rawWtbDemand, maxWtbCapacity)
    : Math.min(wtbInRows, maxWtbCapacity);

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

console.log('--- REFINED RECONCILIATION MATH TESTS ---');

// Test 1: Standard case
const res1 = computeReconciliationRefined(100, 60, 10, 10, 5, 2);
console.log('Test 1 (Standard):', res1);
assert.strictEqual(res1.equals, true, 'Test 1 failed: sum != totalTrackedListings');
assert.strictEqual(res1.unpricedCount >= 0, true, 'Test 1 failed: unpricedCount negative');

// Test 2: Demand Overflow case
const res2 = computeReconciliationRefined(50, 35, 20, 5, 2, 1);
console.log('Test 2 (Demand Overflow):', res2);
assert.strictEqual(res2.equals, true, 'Test 2 failed: sum != totalTrackedListings');
assert.strictEqual(res2.unpricedCount >= 0, true, 'Test 2 failed: unpricedCount negative');
assert.strictEqual(res2.wtbDemandCount, 12, 'Test 2 failed: wtbDemandCount not capped at max capacity');

// Test 3: Zero WTB case
const res3 = computeReconciliationRefined(50, 40, 0, 0, 4, 0);
console.log('Test 3 (Zero WTB):', res3);
assert.strictEqual(res3.equals, true, 'Test 3 failed: sum != totalTrackedListings');
assert.strictEqual(res3.unpricedCount, 6, 'Test 3 failed: unpricedCount mismatch');

// Test 4: Zero Total Listings case
const res4 = computeReconciliationRefined(0, 0, 0, 0, 0, 0);
console.log('Test 4 (Zero Total):', res4);
assert.strictEqual(res4.equals, true, 'Test 4 failed: sum != totalTrackedListings');

// Test 5: Null/Undefined WTB demand
const res5 = computeReconciliationRefined(50, 30, null, 8, 2, 1);
console.log('Test 5 (Null Demand):', res5);
assert.strictEqual(res5.equals, true, 'Test 5 failed: sum != totalTrackedListings');
assert.strictEqual(res5.wtbDemandCount, 8, 'Test 5 failed: wtbDemandCount didn\'t fallback to wtbInRows');

console.log('\nALL 5 RECONCILIATION MATH TESTS PASSED PERFECTLY!');

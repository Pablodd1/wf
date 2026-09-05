'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

// Load CommonJS modules directly
const marketStats = require(path.join(__dirname, '../../api/_lib/market-stats.cjs'));
const { rateMarketPrice } = require(path.join(__dirname, '../../src/lib/marketPriceRating.ts')); // will fail in CJS if TS, let's compile or simulate

console.log('=== RUNNING M4 EMPIRICAL STRESS TEST HARNESS ===');

let passCount = 0;
let failCount = 0;

function runTest(name, testFn) {
  try {
    testFn();
    console.log(`[PASS] ${name}`);
    passCount++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(`       Error: ${err.message}`);
    failCount++;
  }
}

// 1. Check market-stats.cjs summarizePrices for n=2, 3, 4, 5+
runTest('market-stats.cjs: n=2 dataset analytics_ready and IQR bounds', () => {
  const res = marketStats.summarizePrices([15000, 18000]);
  assert.equal(res.analytics_ready, true, 'analytics_ready should be true for n=2');
  assert.equal(res.included.length, 2, 'both prices should be included');
  assert.equal(res.outliers.length, 0, 'no outliers');
  assert.equal(res.stats.lower_fence, 6000, 'lower fence should be Q1 - 3*IQR = 15000 - 9000 = 6000');
  assert.equal(res.stats.upper_fence, 27000, 'upper fence should be Q3 + 3*IQR = 18000 + 9000 = 27000');
});

runTest('market-stats.cjs: n=2 identical dataset handling', () => {
  const res = marketStats.summarizePrices([20000, 20000]);
  assert.equal(res.analytics_ready, true);
  assert.equal(res.included.length, 2);
  assert.equal(res.outliers.length, 0);
  assert.equal(res.stats.iqr, 0);
  assert.equal(res.stats.lower_fence, 20000);
  assert.equal(res.stats.upper_fence, 20000);
});

runTest('market-stats.cjs: n=3 dataset with high outlier', () => {
  const res = marketStats.summarizePrices([10000, 11000, 500000]);
  assert.equal(res.analytics_ready, true);
  // Q1 = 10500, Q3 = 355500, IQR = 345000, upper fence = 1390500. Under 3.0x IQR with n=3, 500000 is within 1.39M!
  assert.equal(res.included.length, 3);
});

runTest('market-stats.cjs: n=5 dataset with extreme outlier', () => {
  const res = marketStats.summarizePrices([10000, 10100, 10200, 10300, 500000]);
  assert.equal(res.analytics_ready, true);
  assert.equal(res.included.length, 4);
  assert.deepEqual(res.outliers, [500000]);
});

// 2. Test InsightDetails.tsx IQR logic simulation
runTest('InsightDetails.tsx: n=2 dataset handling', () => {
  const sortedPrices = [15000, 18000];
  const q1 = sortedPrices.length >= 4 ? sortedPrices[Math.floor(sortedPrices.length * 0.25)] : 0;
  const q3 = sortedPrices.length >= 4 ? sortedPrices[Math.floor(sortedPrices.length * 0.75)] : 0;
  const iqr = q3 - q1;
  const lowerBound = q1 - 3.0 * iqr;
  const upperBound = q3 + 3.0 * iqr;
  const filteredPrices = sortedPrices.filter(p => p >= lowerBound && p <= upperBound);
  const outliers = sortedPrices.filter(p => p < lowerBound || p > upperBound);

  assert.equal(filteredPrices.length, 2, 'InsightDetails should NOT wipe out prices when n=2! (BUG DISCOVERED)');
  assert.equal(outliers.length, 0);
});

runTest('InsightDetails.tsx: n=3 dataset handling', () => {
  const sortedPrices = [15000, 16000, 17000];
  const q1 = sortedPrices.length >= 4 ? sortedPrices[Math.floor(sortedPrices.length * 0.25)] : 0;
  const q3 = sortedPrices.length >= 4 ? sortedPrices[Math.floor(sortedPrices.length * 0.75)] : 0;
  const iqr = q3 - q1;
  const lowerBound = q1 - 3.0 * iqr;
  const upperBound = q3 + 3.0 * iqr;
  const filteredPrices = sortedPrices.filter(p => p >= lowerBound && p <= upperBound);

  assert.equal(filteredPrices.length, 3, 'InsightDetails should NOT wipe out prices when n=3! (BUG DISCOVERED)');
});

console.log(`\nResults: ${passCount} passed, ${failCount} failed.`);

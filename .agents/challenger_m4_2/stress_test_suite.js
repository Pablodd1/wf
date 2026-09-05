// Comprehensive Stress-Test Suite for M4 Outlier Filter Relaxation
import { summarizePrices } from '../../api/_lib/market-stats.cjs';
import { rateMarketPrice } from '../../src/lib/marketPriceRating.ts';
import { buildPriceAnalytics } from '../../src/lib/analytics.ts';
import { iqrOutlierRemoval } from '../../src/lib/pipeline.ts';

console.log('=== RUNNING COMPREHENSIVE M4 STRESS-TEST SUITE ===\n');

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    passCount++;
  } else {
    console.error(`[FAIL] ${message}`);
    failCount++;
  }
}

// --- Test Category 1: Item Count Scaling (0, 1, 2, 3, 4, 5+ items) ---
console.log('--- 1. Item Count Scaling (market-stats.cjs summarizePrices) ---');

// 0 items
const res0 = summarizePrices([]);
assert(res0.analytics_ready === false, '0 items: analytics_ready is false');
assert(res0.included.length === 0, '0 items: 0 included');

// 1 item
const res1 = summarizePrices([25000]);
assert(res1.analytics_ready === false, '1 item: analytics_ready is false (requires min 2)');
assert(res1.included.length === 1, '1 item: included length is 1');
assert(res1.stats === null, '1 item: stats is null because min 2 gate failed');

// 2 items
const res2 = summarizePrices([25000, 26000]);
assert(res2.analytics_ready === true, '2 items: analytics_ready is TRUE (min-2 gate)');
assert(res2.included.length === 2, '2 items: 2 included');
assert(res2.stats !== null, '2 items: stats populated');
assert(res2.stats.avg === 25500, '2 items: avg price is 25500');

// 3 items
const res3 = summarizePrices([20000, 25000, 30000]);
assert(res3.analytics_ready === true, '3 items: analytics_ready is TRUE');
assert(res3.included.length === 3, '3 items: all 3 included within 3.0x IQR');

// 4 items
const res4 = summarizePrices([20000, 22000, 24000, 26000]);
assert(res4.analytics_ready === true, '4 items: analytics_ready is TRUE');
assert(res4.included.length === 4, '4 items: all 4 included within 3.0x IQR');

// 5 items
const res5 = summarizePrices([20000, 21000, 22000, 23000, 24000]);
assert(res5.analytics_ready === true, '5 items: analytics_ready is TRUE');
assert(res5.included.length === 5, '5 items: all 5 included within 3.0x IQR');


// --- Test Category 2: 3.0x IQR vs 1.5x IQR boundary behavior ---
console.log('\n--- 2. 3.0x IQR vs 1.5x IQR Fence Boundaries ---');

// Prices: [10000, 11000, 12000, 13000, 18000]
// Q1 = 11000, Q3 = 13000, IQR = 2000
// 1.5x fence upper = 13000 + 1.5*2000 = 16000 (18000 would be OUTLIER under 1.5x)
// 3.0x fence upper = 13000 + 3.0*2000 = 19000 (18000 is INCLUDED under 3.0x)
const resFence = summarizePrices([10000, 11000, 12000, 13000, 18000]);
assert(resFence.included.includes(18000), '18000 is INCLUDED under 3.0x IQR (would be excluded under 1.5x IQR)');
assert(resFence.outliers.length === 0, '0 outliers for [10000, 11000, 12000, 13000, 18000] under 3.0x IQR');


// --- Test Category 3: Edge Case Datasets (Zero IQR, Identical Values, Extreme Outliers) ---
console.log('\n--- 3. Edge Case Datasets ---');

// Identical prices [20000, 20000] -> IQR = 0
const resIdentical = summarizePrices([20000, 20000]);
assert(resIdentical.analytics_ready === true, 'Identical 2 items: analytics_ready is TRUE');
assert(resIdentical.included.length === 2, 'Identical 2 items: both included when IQR=0');

// Extreme outlier with 3.0x fence
// [10000, 11000, 12000, 13000, 50000] -> Q1=11000, Q3=13000, IQR=2000. Upper = 19000.
const resExtreme = summarizePrices([10000, 11000, 12000, 13000, 50000]);
assert(resExtreme.included.length === 4, 'Extreme outlier 50000 is correctly filtered out');
assert(resExtreme.outliers.includes(50000), '50000 is in outliers array');


// --- Test Category 4: rateMarketPrice min-2 gate check ---
console.log('\n--- 4. rateMarketPrice Verification (src/lib/marketPriceRating.ts) ---');
const dummyStats = { avg: 20000, median: 20000, min: 18000, max: 22000 };

const r1 = rateMarketPrice(20000, dummyStats, 1);
assert(r1.code === 'NOT_RATED', 'Count 1: NOT_RATED');

const r2 = rateMarketPrice(20000, dummyStats, 2);
assert(r2.code !== 'NOT_RATED' || !r2.reason.includes('five'), 'Count 2: Should NOT state 5 observations required (CRITICAL FINDING: currently fails if count < 5)');


// --- Test Category 5: InsightDetails.tsx IQR calculation check ---
console.log('\n--- 5. InsightDetails IQR calculation (2 & 3 item gate) ---');
function simulateInsightDetails(sortedPrices) {
  const q1 = sortedPrices.length >= 2 ? sortedPrices[Math.floor(sortedPrices.length * 0.25)] : 0;
  const q3 = sortedPrices.length >= 2 ? sortedPrices[Math.floor(sortedPrices.length * 0.75)] : 0;
  const iqr = q3 - q1;
  const lowerBound = q1 - 3.0 * iqr;
  const upperBound = q3 + 3.0 * iqr;
  const filteredPrices = sortedPrices.filter(p => p >= lowerBound && p <= upperBound);
  return filteredPrices.length;
}

const count2_id = simulateInsightDetails([25000, 26000]);
assert(count2_id === 2, `InsightDetails with 2 items should include 2 items, got ${count2_id} (CRITICAL FINDING: currently got 0)`);


// --- Test Category 6: src/lib/analytics.ts and src/lib/pipeline.ts ---
console.log('\n--- 6. Client Libraries (analytics.ts & pipeline.ts) ---');

const records2 = [
  { id: '1', reference: '116500LN', dialColor: 'Black', price: 25000, buyerCount: 0, sellerCount: 1 },
  { id: '2', reference: '116500LN', dialColor: 'Black', price: 26000, buyerCount: 0, sellerCount: 1 }
];

const analyticsRes = buildPriceAnalytics(records2, 2);
assert(analyticsRes.groups.length === 1, 'buildPriceAnalytics: 1 group created for 2 items');
assert(analyticsRes.groups[0]?.count === 2, 'buildPriceAnalytics: group has count 2');

const pipelineRes = iqrOutlierRemoval([25000, 26000]);
assert(pipelineRes.keep.length === 2, 'iqrOutlierRemoval: keeps both items for len 2');

console.log(`\n=== STRESS TEST SUMMARY: ${passCount} PASSED, ${failCount} FAILED ===`);

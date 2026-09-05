import { summarizePrices } from '../../api/_lib/market-stats.cjs';
import { rateMarketPrice } from '../../src/lib/marketPriceRating.ts';
import { buildPriceAnalytics } from '../../src/lib/analytics.ts';
import { iqrOutlierRemoval } from '../../src/lib/pipeline.ts';

console.log('=== EMPIRICAL STRESS TEST SUITE (challenger_m4_r2_1) ===\n');

let pass = 0;
let fail = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`[PASS] ${msg}`);
    pass++;
  } else {
    console.error(`[FAIL] ${msg}`);
    fail++;
  }
}

// 1. rateMarketPrice Verification
console.log('--- 1. rateMarketPrice Threshold Gates & Ratings ---');
const benchmark = { min: 18000, avg: 20000, median: 20000, max: 22000 };

// count 0
const r0 = rateMarketPrice(20000, benchmark, 0);
assert(r0.code === 'NOT_RATED', 'Count 0: code is NOT_RATED');
assert(r0.reason.includes('two'), 'Count 0: reason mentions two');

// count 1
const r1 = rateMarketPrice(20000, benchmark, 1);
assert(r1.code === 'NOT_RATED', 'Count 1: code is NOT_RATED');
assert(r1.reason.includes('two'), 'Count 1: reason mentions two');

// count 2 - GOOD
const r2_good = rateMarketPrice(18500, benchmark, 2);
assert(r2_good.code === 'GOOD', 'Count 2 ($18.5k): code is GOOD');

// count 2 - MARKET
const r2_market = rateMarketPrice(20000, benchmark, 2);
assert(r2_market.code === 'MARKET', 'Count 2 ($20k): code is MARKET');

// count 2 - HIGH
const r2_high = rateMarketPrice(21500, benchmark, 2);
assert(r2_high.code === 'HIGH', 'Count 2 ($21.5k): code is HIGH');

// count 2 - OUTSIDE RANGE
const r2_out = rateMarketPrice(25000, benchmark, 2);
assert(r2_out.code === 'NOT_RATED', 'Count 2 ($25k outside max): code is NOT_RATED');
assert(r2_out.label === 'Outside comparable range', 'Count 2 ($25k): label is Outside comparable range');

// count 3
const r3 = rateMarketPrice(19500, benchmark, 3);
assert(r3.code === 'MARKET', 'Count 3 ($19.5k): code is MARKET');

// count 4
const r4 = rateMarketPrice(18000, benchmark, 4);
assert(r4.code === 'GOOD', 'Count 4 ($18k): code is GOOD');

// count 5+
const r5 = rateMarketPrice(22000, benchmark, 5);
assert(r5.code === 'HIGH', 'Count 5 ($22k): code is HIGH');


// 2. InsightDetails.tsx Math Simulation (2, 3, 4, 5+ items)
console.log('\n--- 2. InsightDetails IQR Calculation Simulation ---');
function calcInsightDetails(prices) {
  const sortedPrices = [...prices].filter(p => p > 0).sort((a, b) => a - b);
  const q1 = sortedPrices.length >= 2 ? sortedPrices[Math.floor(sortedPrices.length * 0.25)] : 0;
  const q3 = sortedPrices.length >= 2 ? sortedPrices[Math.floor(sortedPrices.length * 0.75)] : 0;
  const iqr = q3 - q1;
  const lowerBound = q1 - 3.0 * iqr;
  const upperBound = q3 + 3.0 * iqr;
  const outliers = sortedPrices.filter(p => p < lowerBound || p > upperBound);
  const filteredPrices = sortedPrices.filter(p => p >= lowerBound && p <= upperBound);
  return { q1, q3, iqr, lowerBound, upperBound, filteredPrices, outliers };
}

// 2 items
const id2 = calcInsightDetails([25000, 26000]);
assert(id2.filteredPrices.length === 2, 'InsightDetails (2 items): retains all 2 prices');
assert(id2.outliers.length === 0, 'InsightDetails (2 items): 0 outliers');
assert(id2.q1 === 25000 && id2.q3 === 26000, 'InsightDetails (2 items): Q1=25000, Q3=26000');

// 2 identical items
const id2_dup = calcInsightDetails([20000, 20000]);
assert(id2_dup.filteredPrices.length === 2, 'InsightDetails (2 identical items): retains all 2 prices');
assert(id2_dup.iqr === 0, 'InsightDetails (2 identical items): IQR is 0');

// 3 items
const id3 = calcInsightDetails([20000, 25000, 30000]);
assert(id3.filteredPrices.length === 3, 'InsightDetails (3 items): retains all 3 prices');
assert(id3.outliers.length === 0, 'InsightDetails (3 items): 0 outliers');
assert(id3.q1 === 20000 && id3.q3 === 30000, 'InsightDetails (3 items): Q1=20000, Q3=30000');

// 4 items
const id4 = calcInsightDetails([20000, 22000, 24000, 26000]);
assert(id4.filteredPrices.length === 4, 'InsightDetails (4 items): retains all 4 prices');

// 5 items with outlier
const id5 = calcInsightDetails([10000, 11000, 12000, 13000, 50000]);
assert(id5.filteredPrices.length === 4, 'InsightDetails (5 items with outlier): filters out 50000');
assert(id5.outliers.includes(50000), 'InsightDetails (5 items with outlier): 50000 is marked outlier');


// 3. summarizePrices (server-side)
console.log('\n--- 3. Server-Side summarizePrices ---');
const ms2 = summarizePrices([25000, 26000]);
assert(ms2.analytics_ready === true, 'summarizePrices (2 items): analytics_ready is true');
assert(ms2.included.length === 2, 'summarizePrices (2 items): 2 included');

const ms3 = summarizePrices([20000, 25000, 30000]);
assert(ms3.analytics_ready === true, 'summarizePrices (3 items): analytics_ready is true');
assert(ms3.included.length === 3, 'summarizePrices (3 items): 3 included');


// 4. iqrOutlierRemoval (pipeline)
console.log('\n--- 4. Client Pipeline iqrOutlierRemoval ---');
const pipe2 = iqrOutlierRemoval([25000, 26000]);
assert(pipe2.keep.length === 2, 'iqrOutlierRemoval (2 items): keeps 2 items');

const pipe3 = iqrOutlierRemoval([20000, 25000, 30000]);
assert(pipe3.keep.length === 3, 'iqrOutlierRemoval (3 items): keeps 3 items');


console.log(`\n=== SUMMARY: ${pass} PASSED, ${fail} FAILED ===`);

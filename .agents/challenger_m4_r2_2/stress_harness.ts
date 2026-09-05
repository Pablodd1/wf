import { rateMarketPrice, MarketBenchmark } from '../../src/lib/marketPriceRating.js';
import summarizePricesCjs from '../../api/_lib/market-stats.cjs';
const { summarizePrices } = summarizePricesCjs;

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    passed++;
  } else {
    console.error(`[FAIL] ${message}`);
    failed++;
  }
}

function assertEqual(actual: any, expected: any, message: string) {
  if (actual === expected) {
    console.log(`[PASS] ${message}`);
    passed++;
  } else {
    console.error(`[FAIL] ${message} | Expected: ${JSON.stringify(expected)}, Got: ${JSON.stringify(actual)}`);
    failed++;
  }
}

console.log('=== EMPIRICAL STRESS HARNESS - CHALLENGER M4 R2 2 ===\n');

// ── 1. rateMarketPrice Verification ──
console.log('--- 1. Testing rateMarketPrice with N=0,1,2,3,4,5+ items ---');

const benchmark2: MarketBenchmark = { min: 10000, avg: 20000, max: 30000 };
const benchmarkWithMedian: MarketBenchmark = { min: 10000, avg: 20000, median: 19000, max: 30000 };

// N=0
assertEqual(rateMarketPrice(20000, benchmark2, 0).code, 'NOT_RATED', 'N=0 returns NOT_RATED');
assertEqual(rateMarketPrice(20000, benchmark2, 0).reason, 'At least two valid comparable offers are required.', 'N=0 reason specifies two offers required');

// N=1
assertEqual(rateMarketPrice(20000, benchmark2, 1).code, 'NOT_RATED', 'N=1 returns NOT_RATED');
assertEqual(rateMarketPrice(20000, benchmark2, 1).reason, 'At least two valid comparable offers are required.', 'N=1 reason specifies two offers required');

// N=2
assertEqual(rateMarketPrice(18000, benchmark2, 2).code, 'GOOD', 'N=2 price 18000 (90% of avg 20000) returns GOOD');
assertEqual(rateMarketPrice(20000, benchmark2, 2).code, 'MARKET', 'N=2 price 20000 (100% of avg 20000) returns MARKET');
assertEqual(rateMarketPrice(22000, benchmark2, 2).code, 'HIGH', 'N=2 price 22000 (110% of avg 20000) returns HIGH');
assertEqual(rateMarketPrice(9000, benchmark2, 2).code, 'NOT_RATED', 'N=2 price below min (9000 < 10000) returns NOT_RATED');
assertEqual(rateMarketPrice(31000, benchmark2, 2).code, 'NOT_RATED', 'N=2 price above max (31000 > 30000) returns NOT_RATED');

// N=3
assertEqual(rateMarketPrice(18000, benchmark2, 3).code, 'GOOD', 'N=3 price 18000 returns GOOD');
assertEqual(rateMarketPrice(20000, benchmark2, 3).code, 'MARKET', 'N=3 price 20000 returns MARKET');
assertEqual(rateMarketPrice(22000, benchmark2, 3).code, 'HIGH', 'N=3 price 22000 returns HIGH');

// N=4
assertEqual(rateMarketPrice(18000, benchmark2, 4).code, 'GOOD', 'N=4 price 18000 returns GOOD');
assertEqual(rateMarketPrice(20000, benchmark2, 4).code, 'MARKET', 'N=4 price 20000 returns MARKET');

// N=5
assertEqual(rateMarketPrice(20000, benchmark2, 5).code, 'MARKET', 'N=5 price 20000 returns MARKET');

// Median precedence check
assertEqual(rateMarketPrice(18500, benchmarkWithMedian, 2).code, 'MARKET', 'Uses median (19000) instead of avg (20000): 18500 is within 5% of 19000 -> MARKET');
assertEqual(rateMarketPrice(17000, benchmarkWithMedian, 2).code, 'GOOD', 'Uses median (19000): 17000 is < 95% of 19000 -> GOOD');

// Invalid inputs
assertEqual(rateMarketPrice(null, benchmark2, 2).code, 'NOT_RATED', 'null price returns NOT_RATED');
assertEqual(rateMarketPrice(undefined, benchmark2, 2).code, 'NOT_RATED', 'undefined price returns NOT_RATED');
assertEqual(rateMarketPrice(NaN, benchmark2, 2).code, 'NOT_RATED', 'NaN price returns NOT_RATED');
assertEqual(rateMarketPrice(Infinity, benchmark2, 2).code, 'NOT_RATED', 'Infinity price returns NOT_RATED');
assertEqual(rateMarketPrice(-500, benchmark2, 2).code, 'NOT_RATED', 'Negative price returns NOT_RATED');
assertEqual(rateMarketPrice(0, benchmark2, 2).code, 'NOT_RATED', 'Zero price returns NOT_RATED');
assertEqual(rateMarketPrice(20000, null, 2).code, 'NOT_RATED', 'null stats returns NOT_RATED');


// ── 2. InsightDetails IQR Logic Simulation ──
console.log('\n--- 2. Testing InsightDetails Quantile & Outlier Removal Logic ---');

function simulateInsightDetails(prices: number[]) {
  const allPrices = prices.filter(p => p > 0);
  const sortedPrices = [...allPrices].sort((a, b) => a - b);

  const q1 = sortedPrices.length >= 2 ? sortedPrices[Math.floor(sortedPrices.length * 0.25)] : 0;
  const q3 = sortedPrices.length >= 2 ? sortedPrices[Math.floor(sortedPrices.length * 0.75)] : 0;
  const iqr = q3 - q1;
  const lowerBound = q1 - 3.0 * iqr;
  const upperBound = q3 + 3.0 * iqr;
  const outliers = sortedPrices.filter(p => p < lowerBound || p > upperBound);
  const filteredPrices = sortedPrices.filter(p => p >= lowerBound && p <= upperBound);

  const priceCounts: Record<number, number> = {};
  sortedPrices.forEach(p => { priceCounts[p] = (priceCounts[p] || 0) + 1; });
  const dupPrices = Object.entries(priceCounts)
    .filter(([, count]) => count > 1)
    .map(([price]) => Number(price));

  return {
    allPrices,
    sortedPrices,
    q1,
    q3,
    iqr,
    lowerBound,
    upperBound,
    outliers,
    filteredPrices,
    dupPrices
  };
}

// InsightDetails N=0
{
  const res = simulateInsightDetails([]);
  assertEqual(res.filteredPrices.length, 0, 'InsightDetails N=0: filteredPrices is empty');
  assertEqual(res.outliers.length, 0, 'InsightDetails N=0: outliers is empty');
}

// InsightDetails N=1
{
  const res = simulateInsightDetails([25000]);
  assertEqual(res.allPrices.length, 1, 'InsightDetails N=1: allPrices has 1 item');
  assertEqual(res.filteredPrices.length, 0, 'InsightDetails N=1: filteredPrices is empty (threshold is 2)');
}

// InsightDetails N=2
{
  const res = simulateInsightDetails([25000, 27000]);
  assertEqual(res.allPrices.length, 2, 'InsightDetails N=2: allPrices has 2 items');
  assertEqual(res.q1, 25000, 'InsightDetails N=2: q1 is 25000');
  assertEqual(res.q3, 27000, 'InsightDetails N=2: q3 is 27000');
  assertEqual(res.iqr, 2000, 'InsightDetails N=2: iqr is 2000');
  assertEqual(res.lowerBound, 19000, 'InsightDetails N=2: lowerBound is 19000 (25000 - 3*2000)');
  assertEqual(res.upperBound, 33000, 'InsightDetails N=2: upperBound is 33000 (27000 + 3*2000)');
  assertEqual(res.filteredPrices.length, 2, 'InsightDetails N=2: both prices retained in filteredPrices');
  assertEqual(res.outliers.length, 0, 'InsightDetails N=2: 0 outliers');
}

// InsightDetails N=3
{
  const res = simulateInsightDetails([20000, 25000, 30000]);
  assertEqual(res.allPrices.length, 3, 'InsightDetails N=3: allPrices has 3 items');
  assertEqual(res.q1, 20000, 'InsightDetails N=3: q1 is 20000');
  assertEqual(res.q3, 30000, 'InsightDetails N=3: q3 is 30000');
  assertEqual(res.iqr, 10000, 'InsightDetails N=3: iqr is 10000');
  assertEqual(res.lowerBound, -10000, 'InsightDetails N=3: lowerBound is -10000');
  assertEqual(res.upperBound, 60000, 'InsightDetails N=3: upperBound is 60000');
  assertEqual(res.filteredPrices.length, 3, 'InsightDetails N=3: all 3 prices retained');
  assertEqual(res.outliers.length, 0, 'InsightDetails N=3: 0 outliers');
}

// InsightDetails N=4
{
  const res = simulateInsightDetails([20000, 22000, 24000, 26000]);
  assertEqual(res.filteredPrices.length, 4, 'InsightDetails N=4: all 4 prices retained');
}

// InsightDetails N=5 with outlier
{
  const res = simulateInsightDetails([20000, 21000, 22000, 23000, 100000]);
  assertEqual(res.filteredPrices.length, 4, 'InsightDetails N=5: 4 valid prices retained');
  assertEqual(res.outliers.length, 1, 'InsightDetails N=5: 1 extreme outlier detected');
  assertEqual(res.outliers[0], 100000, 'InsightDetails N=5: outlier is 100000');
}

// InsightDetails with duplicate prices
{
  const res = simulateInsightDetails([20000, 20000, 25000]);
  assertEqual(res.dupPrices.length, 1, 'InsightDetails duplicates: detects 1 duplicate price');
  assertEqual(res.dupPrices[0], 20000, 'InsightDetails duplicates: duplicate price is 20000');
  assertEqual(res.filteredPrices.length, 3, 'InsightDetails duplicates: all 3 prices retained');
}

// ── 3. summarizePrices (api/_lib/market-stats.cjs) ──
console.log('\n--- 3. Testing summarizePrices from backend API ---');

{
  const res0 = summarizePrices([]);
  assertEqual(res0.analytics_ready, false, 'summarizePrices N=0: analytics_ready is false');
  assertEqual(res0.stats, null, 'summarizePrices N=0: stats is null');

  const res1 = summarizePrices([20000]);
  assertEqual(res1.analytics_ready, false, 'summarizePrices N=1: analytics_ready is false');
  assertEqual(res1.stats, null, 'summarizePrices N=1: stats is null');

  const res2 = summarizePrices([20000, 22000]);
  assertEqual(res2.analytics_ready, true, 'summarizePrices N=2: analytics_ready is true');
  assert(res2.stats !== null, 'summarizePrices N=2: stats is non-null');
  assertEqual(res2.stats?.avg, 21000, 'summarizePrices N=2: avg is 21000');
  assertEqual(res2.included.length, 2, 'summarizePrices N=2: included length is 2');

  const res3 = summarizePrices([20000, 22000, 24000]);
  assertEqual(res3.analytics_ready, true, 'summarizePrices N=3: analytics_ready is true');
  assertEqual(res3.included.length, 3, 'summarizePrices N=3: included length is 3');
}

console.log(`\n=== TEST SUMMARY: ${passed} PASSED, ${failed} FAILED ===`);
if (failed > 0) {
  process.exit(1);
}

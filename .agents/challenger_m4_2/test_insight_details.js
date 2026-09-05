// Empirical verification test for rateMarketPrice and InsightDetails logic
import { rateMarketPrice } from '../../src/lib/marketPriceRating.ts';

console.log('Testing rateMarketPrice:');
const stats = { avg: 20000, median: 20000, min: 18000, max: 22000 };

// Test with comparableCount = 2
const rating2 = rateMarketPrice(20000, stats, 2);
console.log('comparableCount = 2:', rating2);

// Test with comparableCount = 3
const rating3 = rateMarketPrice(20000, stats, 3);
console.log('comparableCount = 3:', rating3);

// Test with comparableCount = 5
const rating5 = rateMarketPrice(20000, stats, 5);
console.log('comparableCount = 5:', rating5);

// Test InsightDetails logic
console.log('\nTesting InsightDetails IQR calculation logic:');
function simulateInsightDetails(sortedPrices) {
  const q1 = sortedPrices.length >= 4 ? sortedPrices[Math.floor(sortedPrices.length * 0.25)] : 0;
  const q3 = sortedPrices.length >= 4 ? sortedPrices[Math.floor(sortedPrices.length * 0.75)] : 0;
  const iqr = q3 - q1;
  const lowerBound = q1 - 3.0 * iqr;
  const upperBound = q3 + 3.0 * iqr;
  const outliers = sortedPrices.filter(p => p < lowerBound || p > upperBound);
  const filteredPrices = sortedPrices.filter(p => p >= lowerBound && p <= upperBound);
  return { q1, q3, iqr, lowerBound, upperBound, filteredCount: filteredPrices.length, outlierCount: outliers.length };
}

console.log('2 items [25000, 26000]:', simulateInsightDetails([25000, 26000]));
console.log('3 items [25000, 26000, 27000]:', simulateInsightDetails([25000, 26000, 27000]));
console.log('4 items [25000, 26000, 27000, 28000]:', simulateInsightDetails([25000, 26000, 27000, 28000]));

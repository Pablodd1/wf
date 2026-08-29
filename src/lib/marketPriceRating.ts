export interface MarketBenchmark {
  avg: number;
  median?: number;
  min: number;
  max: number;
}

export type MarketPriceRating = {
  code: 'GOOD' | 'MARKET' | 'HIGH' | 'NOT_RATED';
  label: string;
  reason: string;
  color: string;
};

export function rateMarketPrice(price: number | null | undefined, stats: MarketBenchmark | null, comparableCount: number): MarketPriceRating {
  const amount = Number(price);
  if (!stats || comparableCount < 2 || !Number.isFinite(amount) || amount <= 0) {
    return { code: 'NOT_RATED', label: 'Insufficient market data', reason: 'At least two valid comparable offers are required.', color: '#9ca3af' };
  }
  if (amount < stats.min || amount > stats.max) {
    return { code: 'NOT_RATED', label: 'Outside comparable range', reason: 'This price is outside the outlier-clean market range and is not rated.', color: '#d97706' };
  }
  const center = Number(stats.median || stats.avg);
  if (amount <= center * 0.95) {
    return { code: 'GOOD', label: 'Good price', reason: 'At least 5% below the comparable market center.', color: '#22c55e' };
  }
  if (amount <= center * 1.05) {
    return { code: 'MARKET', label: 'Market price', reason: 'Within 5% of the comparable market center.', color: '#d4b87a' };
  }
  return { code: 'HIGH', label: 'High price', reason: 'More than 5% above the comparable market center.', color: '#ef4444' };
}

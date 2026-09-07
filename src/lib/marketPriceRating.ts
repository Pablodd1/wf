export interface MarketBenchmark {
  avg?: number;
  median?: number;
  min?: number;
  max?: number;
  range?: number;
  q1?: number;
  q3?: number;
  iqr?: number;
  lower_fence?: number | null;
  upper_fence?: number | null;
  multiplier?: number;
  iqr_multiplier?: number;
}

export type MarketPriceRating = {
  code: 'GOOD' | 'MARKET' | 'HIGH' | 'NOT_RATED';
  label: string;
  reason: string;
  color: string;
};

/**
 * Rates an asking price against a supported comparable WTS cohort using database-computed Median / IQR methodology.
 * Requirement 3 & 5: Fail closed unless response explicitly supplies median, q1, q3, iqr, lower_fence, upper_fence,
 * iqr_multiplier exactly 3.0, qualified comparable count >= 2, AND all mathematical consistency invariants hold:
 *   - q1 <= median <= q3
 *   - iqr approximately equals q3 - q1
 *   - lower_fence approximately equals max(0, q1 - 3*iqr)
 *   - upper_fence approximately equals q3 + 3*iqr
 *   - lower_fence <= upper_fence
 *   - iqr_multiplier exactly 3.0
 */
export function rateMarketPrice(
  price: number | null | undefined,
  stats: MarketBenchmark | null | undefined,
  comparableCount: number | null | undefined
): MarketPriceRating {
  const amount = Number(price);

  if (
    !stats ||
    comparableCount === null ||
    comparableCount === undefined ||
    comparableCount < 2 ||
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return {
      code: 'NOT_RATED',
      label: 'Not enough comparable data',
      reason: 'At least 2 qualified unique WTS observations are required to compute market statistics.',
      color: '#9ca3af'
    };
  }

  // Requirement 3: Strict non-null checks. Do NOT calculate missing fences or default missing multiplier.
  const hasMedian = stats.median !== null && stats.median !== undefined && Number.isFinite(Number(stats.median));
  const hasQ1 = stats.q1 !== null && stats.q1 !== undefined && Number.isFinite(Number(stats.q1));
  const hasQ3 = stats.q3 !== null && stats.q3 !== undefined && Number.isFinite(Number(stats.q3));
  const hasIqr = stats.iqr !== null && stats.iqr !== undefined && Number.isFinite(Number(stats.iqr));
  const hasLowerFence = stats.lower_fence !== null && stats.lower_fence !== undefined && Number.isFinite(Number(stats.lower_fence));
  const hasUpperFence = stats.upper_fence !== null && stats.upper_fence !== undefined && Number.isFinite(Number(stats.upper_fence));
  
  const multVal = stats.iqr_multiplier !== undefined ? stats.iqr_multiplier : stats.multiplier;
  const hasValidMultiplier = multVal !== null && multVal !== undefined && Number(multVal) === 3.0;

  if (
    !hasMedian ||
    !hasQ1 ||
    !hasQ3 ||
    !hasIqr ||
    !hasLowerFence ||
    !hasUpperFence ||
    !hasValidMultiplier
  ) {
    return {
      code: 'NOT_RATED',
      label: 'Not enough comparable data',
      reason: 'Database-computed market statistics, IQR fence bounds, or 3.0x multiplier are missing or invalid.',
      color: '#9ca3af'
    };
  }

  const median = Number(stats.median);
  const q1 = Number(stats.q1);
  const q3 = Number(stats.q3);
  const iqr = Number(stats.iqr);
  const lowerFence = Number(stats.lower_fence);
  const upperFence = Number(stats.upper_fence);

  // Requirement 5: Consistency validation
  const isQuantileOrderValid = q1 <= median && median <= q3;
  const isIqrConsistent = Math.abs(iqr - (q3 - q1)) <= 0.05;
  const expectedLower = Math.max(0, q1 - 3.0 * iqr);
  const expectedUpper = q3 + 3.0 * iqr;
  const isLowerFenceConsistent = Math.abs(lowerFence - expectedLower) <= 0.05;
  const isUpperFenceConsistent = Math.abs(upperFence - expectedUpper) <= 0.05;
  const isFenceOrderValid = lowerFence <= upperFence;

  if (
    !isQuantileOrderValid ||
    !isIqrConsistent ||
    !isLowerFenceConsistent ||
    !isUpperFenceConsistent ||
    !isFenceOrderValid
  ) {
    return {
      code: 'NOT_RATED',
      label: 'Not enough comparable data',
      reason: 'Market statistics failed mathematical consistency validation.',
      color: '#9ca3af'
    };
  }

  if (amount < lowerFence || amount > upperFence) {
    return {
      code: 'NOT_RATED',
      label: 'Outside comparable range',
      reason: 'This price falls outside the 3.0 * IQR fence bounds of the comparable market cohort.',
      color: '#d97706'
    };
  }

  if (amount <= median * 0.95) {
    return {
      code: 'GOOD',
      label: 'Good price',
      reason: 'At least 5% below the median comparable market price.',
      color: '#22c55e'
    };
  }

  if (amount <= median * 1.05) {
    return {
      code: 'MARKET',
      label: 'Market price',
      reason: 'Within 5% of the median comparable market price.',
      color: '#d4b87a'
    };
  }

  return {
    code: 'HIGH',
    label: 'High price',
    reason: 'More than 5% above the median comparable market price.',
    color: '#ef4444'
  };
}

/**
 * dealRating.ts — Compute GOOD_DEAL / FAIR_DEAL / HIGH_PRICED ratings
 * 
 * Based on the listing's price_usd vs the reference's trimmed-average market price.
 * Requires 5+ samples per reference to be meaningful.
 */

export type DealRating = 'GOOD_DEAL' | 'FAIR_DEAL' | 'HIGH_PRICED' | 'NO_RATING';

export interface PriceAverageData {
  avg: number;
  rawAvg: number;
  count: number;
  min: number;
  max: number;
}

const GOOD_DEAL_THRESHOLD = 0.90;   // ≤ 90% of average = good deal
const FAIR_DEAL_UPPER = 1.10;        // ≤ 110% of average = fair deal
const MIN_SAMPLES = 5;                // Need at least 5 data points

/**
 * Compute the deal rating for a single listing.
 */
export function computeDealRating(
  priceUsd: number | null,
  averageData: PriceAverageData | undefined
): { rating: DealRating; label: string; percentOfAverage: number | null } {
  if (!priceUsd || priceUsd <= 0 || !averageData || averageData.count < MIN_SAMPLES) {
    return { rating: 'NO_RATING', label: 'NO RATING', percentOfAverage: null };
  }

  const percent = priceUsd / averageData.avg;

  if (percent <= GOOD_DEAL_THRESHOLD) {
    const discount = Math.round((1 - percent) * 100);
    return { rating: 'GOOD_DEAL', label: `GOOD DEAL -${discount}%`, percentOfAverage: percent };
  }

  if (percent <= FAIR_DEAL_UPPER) {
    return { rating: 'FAIR_DEAL', label: 'FAIR DEAL', percentOfAverage: percent };
  }

  const premium = Math.round((percent - 1) * 100);
  return { rating: 'HIGH_PRICED', label: `HIGH +${premium}%`, percentOfAverage: percent };
}

/**
 * Format a deal rating for display.
 * GOOD_DEAL → green badge | FAIR_DEAL → amber | HIGH_PRICED → red | NO_RATING → grey
 */
export function getDealRatingColor(rating: DealRating): { bg: string; text: string; border: string } {
  switch (rating) {
    case 'GOOD_DEAL':
      return { bg: 'bg-emerald-900/30', text: 'text-emerald-400', border: 'border-emerald-600/30' };
    case 'FAIR_DEAL':
      return { bg: 'bg-amber-900/30', text: 'text-amber-400', border: 'border-amber-600/30' };
    case 'HIGH_PRICED':
      return { bg: 'bg-rose-900/30', text: 'text-rose-400', border: 'border-rose-600/30' };
    case 'NO_RATING':
    default:
      return { bg: 'bg-gray-800/50', text: 'text-gray-500', border: 'border-gray-700/30' };
  }
}

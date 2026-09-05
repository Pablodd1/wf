import type { WatchRecord } from '@/types';

export interface PriceGroup {
  key: string;
  reference: string;
  dialColor: string;
  family: string;
  brand: string;
  count: number;
  minPrice: number;
  maxPrice: number;
  avgPrice: number;
  medianPrice: number;
  stdDev: number;
  buyerCount: number;
  sellerCount: number;
  records: WatchRecord[];
  outliers: WatchRecord[];
  removed: WatchRecord[];
  status: 'active' | 'insufficient' | 'outliers_removed';
}

export interface AnalyticsResult {
  groups: PriceGroup[];
  insufficient: PriceGroup[];
  allOutliers: WatchRecord[];
  totalReferences: number;
  totalDataPoints: number;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Safe min/max — Math.min(...arr) throws "Maximum call stack" on large arrays (1000+).
function arrMin(arr: number[]): number {
  let m = Infinity;
  for (let i = 0; i < arr.length; i++) if (arr[i] < m) m = arr[i];
  return m === Infinity ? 0 : m;
}
function arrMax(arr: number[]): number {
  let m = -Infinity;
  for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];
  return m === -Infinity ? 0 : m;
}

function stdDev(arr: number[], mean: number): number {
  if (arr.length <= 1) return 0;
  const variance = arr.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function iqrFilter(prices: number[]): { keep: number[]; remove: number[] } {
  if (prices.length < 2) return { keep: prices, remove: [] };
  const sorted = [...prices].sort((a, b) => a - b);
  const q1Idx = Math.floor(sorted.length * 0.25);
  const q3Idx = Math.floor(sorted.length * 0.75);
  const q1 = sorted[q1Idx];
  const q3 = sorted[q3Idx];
  const iqr = q3 - q1;
  const lower = q1 - 3.0 * iqr;
  const upper = q3 + 3.0 * iqr;
  return {
    keep: prices.filter((p) => p >= lower && p <= upper),
    remove: prices.filter((p) => p < lower || p > upper),
  };
}

export function buildPriceAnalytics(
  records: WatchRecord[],
  minDataPoints = 2
): AnalyticsResult {
  // Group by reference + dialColor
  const map = new Map<string, WatchRecord[]>();
  records.forEach((r) => {
    if (!r.reference || r.reference === 'Unknown') return;
    const key = `${r.reference}::${r.dialColor || 'UNKNOWN'}`;
    const group = map.get(key) || [];
    group.push(r);
    map.set(key, group);
  });

  const groups: PriceGroup[] = [];
  const insufficient: PriceGroup[] = [];
  const allOutliers: WatchRecord[] = [];
  let totalDataPoints = 0;

  map.forEach((recs, key) => {
    const reference = recs[0].reference;
    const dialColor = recs[0].dialColor || 'UNKNOWN';
    const family = recs[0].family || 'Other';
    const brand = recs[0].brand || 'Unknown';

    const prices = recs
      .map((r) => r.price)
      .filter((p) => p > 0);

    const buyers = recs.reduce((s, r) => s + (r.buyerCount || 0), 0);
    const sellers = recs.reduce((s, r) => s + (r.sellerCount || 0), 0);

    if (prices.length < minDataPoints) {
      insufficient.push({
        key,
        reference,
        dialColor,
        family,
        brand,
        count: prices.length,
        minPrice: prices.length > 0 ? arrMin(prices) : 0,
        maxPrice: prices.length > 0 ? arrMax(prices) : 0,
        avgPrice: prices.length > 0 ? prices.reduce((s, p) => s + p, 0) / prices.length : 0,
        medianPrice: median(prices),
        stdDev: 0,
        buyerCount: buyers,
        sellerCount: sellers,
        records: recs,
        outliers: [],
        removed: [],
        status: 'insufficient',
      });
      return;
    }

    const { keep: keepPrices, remove: removePrices } = iqrFilter(prices);
    const keepRecords = recs.filter((r) => r.price > 0 && keepPrices.includes(r.price));
    const outlierRecords = recs.filter((r) => r.price > 0 && removePrices.includes(r.price));

    allOutliers.push(...outlierRecords);

    const avg = keepPrices.reduce((s, p) => s + p, 0) / keepPrices.length;
    const med = median(keepPrices);
    const sd = stdDev(keepPrices, avg);

    groups.push({
      key,
      reference,
      dialColor,
      family,
      brand,
      count: keepPrices.length,
      minPrice: keepPrices.length > 0 ? arrMin(keepPrices) : 0,
      maxPrice: keepPrices.length > 0 ? arrMax(keepPrices) : 0,
      avgPrice: Math.round(avg),
      medianPrice: Math.round(med),
      stdDev: Math.round(sd),
      buyerCount: buyers,
      sellerCount: sellers,
      records: keepRecords,
      outliers: outlierRecords,
      removed: outlierRecords,
      status: outlierRecords.length > 0 ? 'outliers_removed' : 'active',
    });

    totalDataPoints += keepPrices.length;
  });

  // Sort active groups by data point count desc
  groups.sort((a, b) => b.count - a.count);

  return {
    groups,
    insufficient,
    allOutliers,
    totalReferences: map.size,
    totalDataPoints,
  };
}

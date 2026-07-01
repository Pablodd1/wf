/**
 * Unified data fetcher — routes through serverless API
 * to avoid frontend anon key issues.
 * All pages use this instead of direct Supabase REST calls.
 */

const API_BASE = import.meta.env.VITE_API_BASE || '';

/**
 * Fetch listings with filters.
 * Mirrors TradingFloor's existing query params.
 */
export async function fetchListings(params: {
  page?: number;
  limit?: number;
  query?: string;
  condition?: string;
  listingType?: string;
}): Promise<{ rows: any[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.query) qs.set('search', params.query);
  if (params.condition && params.condition !== 'All') qs.set('verdict', params.condition);

  const res = await fetch(`${API_BASE}/api/listings?${qs.toString()}`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  return { rows: data.rows || [], total: data.total || 0 };
}

/**
 * Fetch dashboard stats (verdict counts, avg confidence, price stats).
 */
export async function fetchStats(): Promise<{
  totalRecords: number;
  approvedCount: number;
  humanCount: number;
  recycleCount: number;
  reviewCount: number;
  avgConfidence: number;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  isSample?: boolean;
}> {
  const res = await fetch(`${API_BASE}/api/confidence-stats`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

/**
 * Fetch verdict distribution from materialized view.
 */
export async function fetchVerdictDist(): Promise<
  { verdict: string; count: number }[]
> {
  const res = await fetch(`${API_BASE}/api/confidence-stats`);
  if (!res.ok) return [];
  const data = await res.json();
  if (data.verdictDist) return data.verdictDist;
  return [];
}

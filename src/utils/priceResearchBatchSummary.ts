export interface PriceResearchBatchPair {
  brand: string;
  reference: string;
  dial?: string | null;
}

export interface PriceResearchBatchSummary {
  key: string;
  brand: string;
  reference: string;
  source_observation_count: number;
  wts_observation_count: number;
  wtb_observation_count: number;
  reference_qualified_wts_count: number;
  reference_analytics_ready: boolean;
  reference_stats: { avg: number; median?: number; min: number; max: number } | null;
  selected_dial: string | null;
  selected_dial_qualified_count: number;
  analytics_ready: boolean;
  stats: { avg: number; median?: number; min: number; max: number } | null;
  representative_image_url: string | null;
  source_scope: 'CANONICAL_QNSA_RELEASE' | 'BOUNDED_ANALYTICS_SOURCE';
  sample_capped: boolean;
}

interface BatchResponse {
  success?: boolean;
  summaries?: PriceResearchBatchSummary[];
}

const CLIENT_TTL_MS = 30_000;
const CLIENT_MAX_ENTRIES = 50;
const cache = new Map<string, { createdAt: number; value: Promise<PriceResearchBatchSummary[]> }>();

function compactReference(value: unknown) {
  return String(value || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function compactDial(value: unknown) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

export function priceResearchBatchKey(pairs: PriceResearchBatchPair[]) {
  return pairs.map(pair => [
    pair.brand.trim().toLowerCase(),
    compactReference(pair.reference),
    compactDial(pair.dial),
  ].join('|')).sort().join('\u001e');
}

export function loadPriceResearchBatchSummaries(pairs: PriceResearchBatchPair[], signal?: AbortSignal) {
  const normalized = pairs
    .filter(pair => pair.brand.trim() && pair.reference.trim())
    .slice(0, 24);
  if (!normalized.length) return Promise.resolve([]);
  const key = priceResearchBatchKey(normalized);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.createdAt < CLIENT_TTL_MS) return cached.value;
  if (cached) cache.delete(key);

  const value = fetch('/api/price-research-batch-summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairs: normalized }),
    signal,
  }).then(async response => {
    if (!response.ok) throw new Error('Batch market summaries are temporarily unavailable');
    const payload = await response.json() as BatchResponse;
    if (!payload.success || !Array.isArray(payload.summaries)) throw new Error('Invalid batch market summary response');
    const requested = new Set(normalized.map(priceResearchSummaryKey));
    return payload.summaries.filter(summary => requested.has(summary.key));
  }).catch(error => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, { createdAt: now, value });
  if (cache.size > CLIENT_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  return value;
}

export function priceResearchSummaryKey(pair: PriceResearchBatchPair) {
  return [
    pair.brand.trim().toLowerCase(),
    compactReference(pair.reference),
    compactDial(pair.dial),
  ].join('|');
}

export const priceResearchBatchCachePolicy = {
  ttlMs: CLIENT_TTL_MS,
  maxEntries: CLIENT_MAX_ENTRIES,
};

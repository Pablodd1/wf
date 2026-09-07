export interface PriceResearchBatchPair {
  brand: string;
  reference: string;
  dial?: string | null;
  condition?: string | null;
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
  source_scope: 'CANONICAL_QNSA_RELEASE' | 'BOUNDED_ANALYTICS_SOURCE' | 'CANONICAL_V2_RELEASE';
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
  return pairs.map(priceResearchSummaryKey).sort().join('\u001e');
}

async function loadExactCanarySummaries(pairs: PriceResearchBatchPair[], signal?: AbortSignal) {
  // Unknown dial/condition never becomes a cross-dial or cross-condition rating.
  const eligible = pairs.filter(pair => pair.dial?.trim() && pair.condition?.trim());
  const summaries: PriceResearchBatchSummary[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, eligible.length) }, async () => {
    while (next < eligible.length) {
      const pair = eligible[next++];
      const params = new URLSearchParams({ brand: pair.brand, reference: pair.reference,
        dial: pair.dial!, condition: pair.condition!, pageSize: '1' });
      const response = await fetch(`/api/canary/price-research?${params}`, { signal });
      if (!response.ok) throw new Error('Exact market cohort unavailable');
      const payload = await response.json();
      if (!payload.success || !payload.selected_cohort) throw new Error('Invalid exact market cohort');
      const cohort = payload.selected_cohort;
      if (priceResearchSummaryKey({ brand: cohort.brand || '', reference: cohort.reference || '',
        dial: cohort.dial_color, condition: cohort.condition }) !== priceResearchSummaryKey(pair)) {
        throw new Error('Mismatched exact market cohort');
      }
      const count = Number(payload.count);
      const ready = payload.analytics_ready === true && Number.isSafeInteger(count) && count >= 2 && payload.stats;
      summaries.push({ key: priceResearchSummaryKey(pair), brand: pair.brand, reference: pair.reference,
        source_observation_count: payload.totalListings, wts_observation_count: payload.wts_count,
        wtb_observation_count: payload.wtb_count, reference_qualified_wts_count: 0,
        reference_analytics_ready: false, reference_stats: null, selected_dial: pair.dial!,
        selected_dial_qualified_count: ready ? count : 0, analytics_ready: Boolean(ready),
        stats: ready ? payload.stats : null, representative_image_url: null,
        source_scope: 'CANONICAL_V2_RELEASE', sample_capped: false });
    }
  }));
  return summaries;
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

  const useExactCanary = normalized.some(pair => Object.prototype.hasOwnProperty.call(pair, 'condition'));
  const request = useExactCanary ? loadExactCanarySummaries(normalized, signal) : fetch('/api/price-research-batch-summary', {
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
  });
  const value = request.catch(error => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, { createdAt: now, value });
  if (cache.size > CLIENT_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  return value;
}

export function priceResearchSummaryKey(pair: PriceResearchBatchPair) {
  if (Object.prototype.hasOwnProperty.call(pair, 'condition')) {
    return 'v2:' + JSON.stringify([pair.brand.trim().toLowerCase(), pair.reference.trim().toUpperCase(),
      String(pair.dial || '').trim().toUpperCase(), String(pair.condition || '').trim().toUpperCase()]);
  }
  const parts = [
    pair.brand.trim().toLowerCase(),
    compactReference(pair.reference),
    compactDial(pair.dial),
  ];
  return parts.join('|');
}

export const priceResearchBatchCachePolicy = {
  ttlMs: CLIENT_TTL_MS,
  maxEntries: CLIENT_MAX_ENTRIES,
};

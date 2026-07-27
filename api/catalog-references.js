/**
 * CATALOG REFERENCES — /api/catalog-references?brand=Rolex&model=Submariner
 *
 * Returns catalog references only when an indexed exact lookup finds real,
 * approved listing evidence. Each result carries a bounded price/dial sample,
 * avoiding the former full-brand scan over millions of production rows.
 */
const { getClient } = require('./_lib/supabase');
const { listCatalogReferences, lookupCatalog } = require('./_lib/catalog');
const { isPublicationBrandAllowed } = require('./_lib/publication-brands.cjs');
const { isPublicationReferenceAllowed } = require('./_lib/publication-references.cjs');
const { classifyResearchEligibility } = require('./_lib/price-research-eligibility.cjs');
const { bundleCandidateCount, loadShadowBundleParentIds } = require('./_lib/unsplit-bundle-filter.cjs');

const _cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
const REFERENCE_SAMPLE_LIMIT = 500;
const MINIMUM_ANALYTICS_SAMPLE = 5;
const LOOKUP_CONCURRENCY = 8;

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function loadReferenceEvidence(client, brand, entry) {
  const { data, error } = await client
    .from('watch_records')
    .select('id, reference, price_usd, dial_color, raw_message, flags')
    .eq('brand', brand)
    .eq('reference', entry.reference)
    .eq('verdict', 'APPROVED')
    .eq('listing_type', 'WTS')
    .or('listing_status.is.null,listing_status.not.in.(HIDDEN,REJECTED,DELETED)')
    .gt('price_usd', 0)
    .limit(REFERENCE_SAMPLE_LIMIT);
  if (error) throw error;
  if (!data?.length) return null;

  const catalog = lookupCatalog(entry.reference, brand);
  const shadowBundleIds = await loadShadowBundleParentIds(client, data);
  const qualified = data.filter(row => !classifyResearchEligibility({
    ...row,
    brand,
    bundle_candidate_count: bundleCandidateCount(row, shadowBundleIds),
  }, catalog));
  const dials = new Map();
  let sum = 0;
  for (const row of qualified) {
    sum += Number(row.price_usd);
    const dial = row.dial_color || 'Unspecified';
    dials.set(dial, (dials.get(dial) || 0) + 1);
  }
  return {
    reference: entry.reference,
    listing_count: qualified.length,
    analytics_ready: qualified.length >= MINIMUM_ANALYTICS_SAMPLE,
    sample_capped: data.length >= REFERENCE_SAMPLE_LIMIT,
    avg_price: qualified.length >= MINIMUM_ANALYTICS_SAMPLE ? Math.round(sum / qualified.length) : null,
    dial_colors: [...dials.entries()]
      .map(([dial_color, count]) => ({ dial_color, count }))
      .sort((a, b) => b.count - a.count),
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const brand = (req.query.brand || '').trim();
  const model = (req.query.model || '').trim();
  if (!brand || !model) return res.status(400).json({ error: 'brand and model required' });
  if (!isPublicationBrandAllowed(brand)) {
    return res.status(404).json({ error: 'Brand is not included in this release' });
  }

  const cacheKey = `${brand}|${model}`;
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return res.status(200).json({ ...cached.payload, cached: true });
  }

  try {
    const client = getClient();
    const catalogReferences = listCatalogReferences(brand, model)
      .filter(entry => isPublicationReferenceAllowed(brand, entry.reference));
    const evidence = await mapWithConcurrency(
      catalogReferences,
      LOOKUP_CONCURRENCY,
      entry => loadReferenceEvidence(client, brand, entry)
    );
    // Keep every reference with real approved evidence searchable. The five-row
    // gate belongs to analytics publication, not reference discovery.
    const out = evidence
      .filter(item => item && item.listing_count > 0)
      .sort((a, b) => b.listing_count - a.listing_count);

    const payload = {
      success: true,
      brand,
      model,
      reference_count: out.length,
      references: out,
    };
    _cache.set(cacheKey, { at: Date.now(), payload });
    return res.status(200).json(payload);
  } catch (err) {
    console.error('[catalog-references] error:', err.message);
    return res.status(500).json({ error: 'Failed to load references', detail: err.message });
  }
};

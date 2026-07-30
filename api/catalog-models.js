/**
 * CATALOG MODELS — /api/catalog-models?brand=Rolex
 *
 * Returns catalog-confirmed models without scanning the multi-million-row live
 * listing table. The references endpoint verifies real listing evidence before
 * showing a reference. Uncatalogued references remain directly searchable and
 * are never presented as model names.
 */
const { listCatalogReferences } = require('./_lib/catalog');
const { getClient } = require('./_lib/supabase');
const { isPublicationBrandAllowed } = require('./_lib/publication-brands.cjs');
const {
  REVIEWED_ZENITH_RECORD_END,
  REVIEWED_ZENITH_RECORD_START,
  REVIEWED_ZENITH_SOURCE,
  isPublicationReferenceAllowed,
} = require('./_lib/publication-references.cjs');

const _cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
const ZENITH_REFERENCE_ONLY_MODEL = 'Reference-only listings';

async function loadReviewedZenithModels() {
  const client = getClient();
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from('price_research_verified_source')
      .select('id,model,reference')
      .gte('id', REVIEWED_ZENITH_RECORD_START)
      .lt('id', REVIEWED_ZENITH_RECORD_END)
      .eq('brand', 'Zenith')
      .eq('source', REVIEWED_ZENITH_SOURCE)
      .eq('verdict', 'APPROVED')
      .gte('confidence', 90)
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const models = new Map();
  for (const row of rows) {
    if (!row.reference) continue;
    const model = String(row.model || '').trim() || ZENITH_REFERENCE_ONLY_MODEL;
    if (!models.has(model)) models.set(model, new Set());
    if (row.reference) models.get(model).add(row.reference);
  }
  return [...models.entries()]
    .map(([model, references]) => ({
      model,
      reference_count: references.size,
      listing_count: rows.filter(row => (
        (String(row.model || '').trim() || ZENITH_REFERENCE_ONLY_MODEL) === model
      )).length,
    }))
    .sort((a, b) => b.listing_count - a.listing_count || a.model.localeCompare(b.model));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const brand = (req.query.brand || '').trim();
  if (!brand) return res.status(400).json({ error: 'brand required' });
  if (!isPublicationBrandAllowed(brand)) {
    return res.status(404).json({ error: 'Brand is not included in this release' });
  }

  const cached = _cache.get(brand);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return res.status(200).json({ ...cached.payload, cached: true });
  }

  try {
    if (brand.toLowerCase() === 'zenith') {
      const out = await loadReviewedZenithModels();
      const payload = {
        success: true,
        brand: 'Zenith',
        model_count: out.length,
        catalog_reference_count: out.reduce((sum, item) => sum + item.reference_count, 0),
        models: out,
        identity_source: 'OWNER_REVIEWED_WORKBOOK',
      };
      _cache.set(brand, { at: Date.now(), payload });
      return res.status(200).json(payload);
    }
    const catalogReferences = listCatalogReferences(brand)
      .filter(entry => isPublicationReferenceAllowed(brand, entry.reference));
    const models = new Map();
    for (const entry of catalogReferences) {
      if (!models.has(entry.model)) models.set(entry.model, new Set());
      models.get(entry.model).add(entry.reference);
    }

    const out = [...models.entries()]
      .map(([model, refs]) => ({ model, reference_count: refs.size }))
      .sort((a, b) => b.reference_count - a.reference_count || a.model.localeCompare(b.model));
    const payload = {
      success: true,
      brand,
      model_count: out.length,
      catalog_reference_count: catalogReferences.length,
      models: out,
    };
    _cache.set(brand, { at: Date.now(), payload });
    return res.status(200).json(payload);
  } catch (err) {
    console.error('[catalog-models] error:', err.message);
    return res.status(500).json({ error: 'Failed to load models', detail: err.message });
  }
};

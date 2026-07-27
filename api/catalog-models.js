/**
 * CATALOG MODELS — /api/catalog-models?brand=Rolex
 *
 * Returns catalog-confirmed models without scanning the multi-million-row live
 * listing table. The references endpoint verifies real listing evidence before
 * showing a reference. Uncatalogued references remain directly searchable and
 * are never presented as model names.
 */
const { listCatalogReferences } = require('./_lib/catalog');
const { isPublicationBrandAllowed } = require('./_lib/publication-brands.cjs');
const { isPublicationReferenceAllowed } = require('./_lib/publication-references.cjs');

const _cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

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

/**
 * CATALOG MODELS — /api/catalog-models?brand=Rolex
 *
 * Returns catalog-confirmed models without scanning the multi-million-row live
 * listing table. Browse identity is deterministic catalog metadata; exact
 * listing evidence is resolved only after a reference is selected.
 * Uncatalogued references remain directly searchable and are never presented
 * as model names.
 */
const { listCanonicalCatalogReferences, lookupCatalog } = require('./_lib/catalog');
const { getClient } = require('./_lib/supabase');
const { isPublicationBrandAllowed } = require('./_lib/publication-brands.cjs');
const {
  loadReviewedWorkbookBrandRows,
  isReviewedWorkbookBrowseBrand,
  summarizeReviewedWorkbookModels,
} = require('./_lib/reviewed-workbook-browse.cjs');
const {
  REVIEWED_PANERAI_RECORD_IDS,
  REVIEWED_PANERAI_SOURCE,
  REVIEWED_ZENITH_RECORD_END,
  REVIEWED_ZENITH_RECORD_START,
  REVIEWED_ZENITH_SOURCE,
  isPublicationReferenceAllowed,
  isReleaseListingEligible,
} = require('./_lib/publication-references.cjs');

const _cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
const REFERENCE_ONLY_MODEL = 'Reference-only listings';
const FOREIGN_BRAND_NAMES = [
  'Audemars Piguet',
  'Breguet',
  'Bulgari',
  'Cartier',
  'Franck Muller',
  'Girard-Perregaux',
  'Glashütte Original',
  'Grand Seiko',
  'H. Moser & Cie',
  'IWC',
  'Jacob & Co',
  'Omega',
  'Patek Philippe',
  'Piaget',
  'Rolex',
  'TAG Heuer',
  'Tudor',
  'Ulysse Nardin',
  'Vacheron Constantin',
];

const { normalizeCanonicalModel } = require('./_lib/catalog-taxonomy');

function reviewedWorkbookModel(row, brand) {
  const catalog = lookupCatalog(row.reference, brand);
  let modelName = '';
  if (catalog?.found && catalog.model) {
    modelName = String(catalog.model).trim();
  } else {
    const claimed = String(row.model || '').trim();
    const foreignBrand = FOREIGN_BRAND_NAMES.some(name =>
      name.toLowerCase() !== brand.toLowerCase()
      && claimed.toLowerCase().includes(name.toLowerCase()));
    modelName = claimed && !foreignBrand ? claimed : REFERENCE_ONLY_MODEL;
  }
  return normalizeCanonicalModel(modelName, brand);
}

function summarizeReviewedModels(rows, brand) {
  const models = new Map();
  for (const row of rows) {
    if (!row.reference) continue;
    const model = reviewedWorkbookModel(row, brand);
    const current = models.get(model) || { references: new Set(), listing_count: 0 };
    current.references.add(row.reference);
    current.listing_count += 1;
    models.set(model, current);
  }
  return [...models.entries()]
    .map(([model, value]) => ({
      model,
      reference_count: value.references.size,
      listing_count: value.listing_count,
    }))
    .sort((a, b) => b.listing_count - a.listing_count || a.model.localeCompare(b.model));
}

async function loadReviewedPaneraiModels() {
  const client = getClient();
  const { data, error } = await client
    .from('price_research_verified_source')
    .select('id,brand,model,reference,source,verdict,confidence,listing_type,listing_status')
    .in('id', REVIEWED_PANERAI_RECORD_IDS)
    .eq('brand', 'Panerai')
    .eq('source', REVIEWED_PANERAI_SOURCE)
    .eq('verdict', 'APPROVED')
    .gte('confidence', 90)
    .eq('listing_type', 'WTS');
  if (error) throw error;
  return summarizeReviewedModels((data || []).filter(isReleaseListingEligible), 'Panerai');
}

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
  return summarizeReviewedModels(rows, 'Zenith');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const brand = (req.query.brand || '').trim();
  if (!brand) return res.status(400).json({ error: 'brand required' });

  const cached = _cache.get(brand);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return res.status(200).json({ ...cached.payload, cached: true });
  }

  try {
    if (['omega', 'cartier'].includes(brand.toLowerCase())) {
      const client = getClient();
      const canonicalBrand = brand.toLowerCase() === 'cartier' ? 'Cartier' : 'Omega';
      const releaseIndexRpc = canonicalBrand === 'Cartier'
        ? 'qnsa_cartier_reference_index' : 'qnsa_omega_reference_index';
      const { data: observedRows, error: observedError } = await client.rpc(releaseIndexRpc);
      if (observedError) throw observedError;
      const grouped = new Map();
      for (const row of observedRows || []) {
        const model = String(row.model || canonicalBrand).trim() || canonicalBrand;
        const current = grouped.get(model) || { references: new Set(), listing_count: 0 };
        if (row.reference) current.references.add(String(row.reference));
        current.listing_count += Number(row.listing_count || 0);
        grouped.set(model, current);
      }
      const models = [...grouped.entries()].map(([model, value]) => ({
        model,
        reference_count: value.references.size,
        listing_count: value.listing_count,
      })).sort((a, b) => b.listing_count - a.listing_count || a.model.localeCompare(b.model));
      const payload = {
        success: true,
        brand: canonicalBrand,
        model_count: models.length,
        catalog_reference_count: models.reduce((sum, item) => sum + item.reference_count, 0),
        models,
        identity_source: 'EXACT_RELEASE_MANIFEST',
        evidence_resolution: 'EXACT_RELEASE_MANIFEST_ON_SELECTION',
      };
      _cache.set(brand, { at: Date.now(), payload });
      return res.status(200).json(payload);
    }
    if (brand.toLowerCase() === 'vacheron constantin') {
      const references = listCanonicalCatalogReferences('Vacheron Constantin')
        .filter(entry => String(entry.model || '').trim().toLowerCase() === 'overseas');
      const payload = {
        success: true,
        brand: 'Vacheron Constantin',
        model_count: 1,
        catalog_reference_count: references.length,
        models: [{ model: 'Overseas', reference_count: references.length }],
        identity_source: 'PREAGGREGATED_CATALOG_INDEX',
        evidence_resolution: 'EXACT_RELEASE_MANIFEST_ON_SELECTION',
        sample_capped: false,
      };
      _cache.set(brand, { at: Date.now(), payload });
      return res.status(200).json(payload);
    }
    if (isReviewedWorkbookBrowseBrand(brand)) {
      const { rows, truncated } = await loadReviewedWorkbookBrandRows(getClient(), brand);
      if (!rows.length) return res.status(404).json({ error: 'Brand has no published reviewed listings' });
      if (truncated) return res.status(503).json({ error: 'Brand inventory is too large for safe model browsing' });
      const out = summarizeReviewedWorkbookModels(rows);
      const payload = {
        success: true,
        brand,
        model_count: out.length,
        catalog_reference_count: out.reduce((sum, item) => sum + item.reference_count, 0),
        observed_listing_count: out.reduce((sum, item) => sum + item.listing_count, 0),
        models: out,
        identity_source: 'OWNER_REVIEWED_WORKBOOK',
        sample_capped: false,
      };
      _cache.set(brand, { at: Date.now(), payload });
      return res.status(200).json(payload);
    }
    if (!isPublicationBrandAllowed(brand)) {
      // ponytail: prefer the preaggregated in-memory catalog index. The
      // per-request reviewed-workbook row scan times out on large brands
      // (Richard Mille hit the 10k-row cap -> 503; Cartier hit the Postgres
      // statement timeout -> 500). Scan only as last resort for brands with
      // no catalog coverage.
      // ponytail: browse index shows ALL catalogued brand references — model
      // names + reference numbers are catalog metadata, not market evidence.
      // The reviewed-reference allowlist gates analytics display downstream,
      // not the browse tree (gating here emptied RM/Cartier back into the
      // timeout-prone DB scan).
      const catalogReferences = listCanonicalCatalogReferences(brand);
      if (catalogReferences.length) {
        const models = new Map();
        for (const entry of catalogReferences) {
          if (!entry.model) continue;
          const canonicalModel = normalizeCanonicalModel(entry.model, brand);
          if (!models.has(canonicalModel)) models.set(canonicalModel, new Set());
          models.get(canonicalModel).add(entry.reference);
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
          identity_source: 'PREAGGREGATED_CATALOG_INDEX',
          sample_capped: false,
        };
        _cache.set(brand, { at: Date.now(), payload });
        return res.status(200).json(payload);
      }
      const { rows, truncated } = await loadReviewedWorkbookBrandRows(getClient(), brand);
      if (!rows.length) return res.status(404).json({ error: 'Brand has no published reviewed listings' });
      if (truncated) return res.status(503).json({ error: 'Brand inventory is too large for safe model browsing' });
      const out = summarizeReviewedWorkbookModels(rows);
      const payload = {
        success: true,
        brand,
        model_count: out.length,
        catalog_reference_count: out.reduce((sum, item) => sum + item.reference_count, 0),
        models: out,
        identity_source: 'OWNER_REVIEWED_WORKBOOK',
        sample_capped: false,
      };
      _cache.set(brand, { at: Date.now(), payload });
      return res.status(200).json(payload);
    }
    if (brand.toLowerCase() === 'panerai') {
      const out = await loadReviewedPaneraiModels();
      const payload = {
        success: true,
        brand: 'Panerai',
        model_count: out.length,
        catalog_reference_count: out.reduce((sum, item) => sum + item.reference_count, 0),
        models: out,
        identity_source: 'OWNER_REVIEWED_WORKBOOK',
      };
      _cache.set(brand, { at: Date.now(), payload });
      return res.status(200).json(payload);
    }
    if (brand.toLowerCase() === 'zenith') {
      const catalogReferences = listCanonicalCatalogReferences('Zenith');
      const models = new Map();
      for (const entry of catalogReferences) {
        if (!entry.model) continue;
        const canonicalModel = normalizeCanonicalModel(entry.model, 'Zenith');
        if (!models.has(canonicalModel)) models.set(canonicalModel, new Set());
        models.get(canonicalModel).add(entry.reference);
      }
      const out = [...models.entries()]
        .map(([model, refs]) => ({ model, reference_count: refs.size }))
        .sort((a, b) => b.reference_count - a.reference_count || a.model.localeCompare(b.model));
      const payload = {
        success: true,
        brand: 'Zenith',
        model_count: out.length,
        catalog_reference_count: catalogReferences.length,
        models: out,
        identity_source: 'PREAGGREGATED_CATALOG_INDEX',
        sample_capped: false,
      };
      _cache.set(brand, { at: Date.now(), payload });
      return res.status(200).json(payload);
    }
    const catalogReferences = listCanonicalCatalogReferences(brand)
      .filter(entry => isPublicationReferenceAllowed(brand, entry.reference));
    const models = new Map();
    for (const entry of catalogReferences) {
      if (!entry.model) continue;
      const canonicalModel = normalizeCanonicalModel(entry.model, brand);
      if (!models.has(canonicalModel)) models.set(canonicalModel, new Set());
      models.get(canonicalModel).add(entry.reference);
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
// force recompile Sat Aug  1 19:01:51 EDT 2026

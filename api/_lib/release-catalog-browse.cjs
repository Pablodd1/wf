'use strict';

const { listCanonicalCatalogReferences } = require('./catalog');
const { normalizeCanonicalModel } = require('./catalog-taxonomy');

const REFERENCE_ONLY_MODEL = 'Reference-only listings';

function referenceKey(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function cleanModel(value, brand) {
  return normalizeCanonicalModel(String(value || '').trim() || REFERENCE_ONLY_MODEL, brand)
    || REFERENCE_ONLY_MODEL;
}

function buildReleaseBrowseIndex(brand, observedRows, catalogEntries = listCanonicalCatalogReferences(brand)) {
  const catalogByReference = new Map();
  for (const entry of catalogEntries || []) {
    const key = referenceKey(entry.reference);
    if (!key || catalogByReference.has(key)) continue;
    catalogByReference.set(key, {
      reference: String(entry.reference).trim(),
      model: cleanModel(entry.model, brand),
    });
  }

  const observedByReference = new Map();
  const unresolvedByModel = new Map();
  let unresolvedReferenceListingCount = 0;
  let unresolvedReferencePricedWtsCount = 0;
  for (const row of observedRows || []) {
    const key = referenceKey(row?.reference);
    if (!key) {
      const model = cleanModel(row?.model, brand);
      const listingCount = Number(row?.listing_count || 0);
      const pricedWtsCount = Number(row?.priced_wts_count || 0);
      unresolvedReferenceListingCount += listingCount;
      unresolvedReferencePricedWtsCount += pricedWtsCount;
      const unresolved = unresolvedByModel.get(model) || { listing_count: 0, priced_wts_count: 0 };
      unresolved.listing_count += listingCount;
      unresolved.priced_wts_count += pricedWtsCount;
      unresolvedByModel.set(model, unresolved);
      continue;
    }
    const candidates = observedByReference.get(key) || [];
    candidates.push({
      row,
      model: cleanModel(row.model, brand),
      listing_count: Number(row.listing_count || 0),
    });
    observedByReference.set(key, candidates);
  }

  const references = new Map();
  for (const [key, catalog] of catalogByReference) {
    references.set(key, {
      reference: catalog.reference,
      model: catalog.model,
      listing_count: 0,
      wts_observation_count: 0,
      wtb_observation_count: 0,
      priced_wts_observation_count: 0,
      eligible_observation_count: 0,
      analytics_ready: false,
      sample_capped: false,
      avg_price: null,
      dial_colors: [],
      identity_source: 'PREAGGREGATED_CATALOG_INDEX',
      evidence_resolution: 'EXACT_RELEASE_MANIFEST_ON_SELECTION',
    });
  }

  const modelConflicts = [];
  for (const [key, candidates] of observedByReference) {
    const catalog = catalogByReference.get(key);
    const selected = [...candidates].sort((left, right) => {
      const leftCanonical = catalog && left.model === catalog.model ? 1 : 0;
      const rightCanonical = catalog && right.model === catalog.model ? 1 : 0;
      if (leftCanonical !== rightCanonical) return rightCanonical - leftCanonical;
      const leftSpecific = left.model === REFERENCE_ONLY_MODEL ? 0 : 1;
      const rightSpecific = right.model === REFERENCE_ONLY_MODEL ? 0 : 1;
      if (leftSpecific !== rightSpecific) return rightSpecific - leftSpecific;
      return right.listing_count - left.listing_count || left.model.localeCompare(right.model);
    })[0];
    const models = [...new Set(candidates.map(candidate => candidate.model))].sort();
    if (models.length > 1) {
      modelConflicts.push({
        reference: catalog?.reference || String(selected.row.reference).trim(),
        selected_model: catalog?.model || selected.model,
        suppressed_models: models.filter(model => model !== (catalog?.model || selected.model)),
      });
    }
    const current = references.get(key) || {
      reference: String(selected.row.reference).trim(),
      model: selected.model,
      eligible_observation_count: 0,
      analytics_ready: false,
      sample_capped: false,
      avg_price: null,
      dial_colors: [],
      identity_source: 'SOURCE_PROVEN_RELEASE_REFERENCE',
      evidence_resolution: 'EXACT_RELEASE_MANIFEST_ON_SELECTION',
    };
    references.set(key, {
      ...current,
      model: catalog?.model || selected.model,
      listing_count: candidates.reduce((sum, candidate) => sum + Number(candidate.row.listing_count || 0), 0),
      wts_observation_count: candidates.reduce((sum, candidate) => sum + Number(candidate.row.wts_count || 0), 0),
      wtb_observation_count: candidates.reduce((sum, candidate) => sum + Number(candidate.row.wtb_count || 0), 0),
      priced_wts_observation_count: candidates.reduce((sum, candidate) => sum + Number(candidate.row.priced_wts_count || 0), 0),
      identity_source: selected.row.catalog_reference_confirmed === true
        ? 'CATALOG_AND_RELEASE_MANIFEST'
        : current.identity_source,
    });
  }

  const rows = [...references.values()].sort((left, right) => (
    left.model.localeCompare(right.model)
    || Number(right.listing_count || 0) - Number(left.listing_count || 0)
    || left.reference.localeCompare(right.reference)
  ));
  const modelMap = new Map();
  for (const row of rows) {
    const current = modelMap.get(row.model) || { model: row.model, reference_count: 0, listing_count: 0 };
    current.reference_count += 1;
    current.listing_count += Number(row.listing_count || 0);
    modelMap.set(row.model, current);
  }
  return {
    references: rows,
    models: [...modelMap.values()].sort((a, b) => b.listing_count - a.listing_count || a.model.localeCompare(b.model)),
    modelConflicts,
    unresolvedByModel: Object.fromEntries(unresolvedByModel),
    unresolvedReferenceListingCount,
    unresolvedReferencePricedWtsCount,
  };
}

module.exports = { buildReleaseBrowseIndex, cleanModel, referenceKey, REFERENCE_ONLY_MODEL };

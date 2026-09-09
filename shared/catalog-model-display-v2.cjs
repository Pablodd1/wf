'use strict';

// Presentation only. Raw/candidate/member payloads retain the original claims.
const registry = require('./exact-catalog-models.json');
const { brandKey, referenceKey, sourceModel, lookupExactCatalogModel } = require('./exact-catalog-model-map.cjs');

function buildBrandModelNames(models) {
  const result = {};
  for (const [brand, references] of Object.entries(models)) {
    const names = {};
    for (const { model } of Object.values(references)) {
      const key = model.replace(/^ +| +$/g, '').toLowerCase();
      if (!Object.hasOwn(names, key) || Buffer.compare(Buffer.from(model), Buffer.from(names[key])) < 0) names[key] = model;
    }
    result[brand] = names;
  }
  return result;
}
const brandModelNames = buildBrandModelNames(registry.models);

function resolveCatalogModelDisplay(source, data = registry, names = brandModelNames) {
  const claimed = sourceModel(source.model);
  const exact = lookupExactCatalogModel(source.reference, source.brand, data);
  if (exact) return {
    model: exact.model,
    source: 'CATALOG_EXACT_BRAND_REFERENCE',
    review_reason: claimed !== null && claimed !== exact.model ? 'SOURCE_MODEL_DIFFERS_FROM_EXACT_CATALOG_MODEL' : null,
    exact,
  };
  const brand = brandKey(source.brand), key = claimed === null ? '' : claimed.replace(/^ +| +$/g, '').toLowerCase();
  const known = Object.hasOwn(names, brand) && Object.hasOwn(names[brand], key) ? names[brand][key] : null;
  return {
    model: known,
    source: known ? 'SOURCE_MODEL_WITH_CATALOG_BRAND_NAME' : null,
    review_reason: claimed !== null && !known ? 'MODEL_CLAIM_NOT_VALIDATED_FOR_BRAND' : null,
    exact: null,
  };
}

function withCatalogModelDisplay(record, sourceIdentity = record) {
  const resolved = resolveCatalogModelDisplay(sourceIdentity);
  return {
    ...record,
    source_model: sourceIdentity.model ?? null,
    model: resolved.model,
    model_source: resolved.source,
    model_review_reason: resolved.review_reason,
    model_catalog_sha256: resolved.source ? registry.catalog_sha256 : null,
    model_catalog_reference: resolved.exact?.reference ?? null,
    model_catalog_source_files: resolved.exact?.source_files ?? [],
  };
}

module.exports = { buildBrandModelNames, brandModelNames, resolveCatalogModelDisplay, withCatalogModelDisplay, brandKey, referenceKey };

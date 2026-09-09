'use strict';

// Display-only identity lookup: never repairs references or source fields.
const aliases = require('./published-brand-aliases.json');
const trim = value => typeof value === 'string' ? value.replace(/^ +| +$/g, '') : '';
function brandKey(value) {
  const source = trim(value);
  return (Object.hasOwn(aliases, source.toLowerCase()) ? aliases[source.toLowerCase()] : source).toLowerCase();
}
function referenceKey(value) { return typeof value === 'string' ? value.replace(/[ \t\r\n\f\v]/g, '').toUpperCase() : ''; }
function sourceModel(value) { return typeof value === 'string' && trim(value) ? value : null; }
function buildExactCatalogModelMap(entries) {
  const grouped = new Map();
  for (const row of entries) {
    const brand = brandKey(row.brand), reference = referenceKey(row.reference);
    if (!brand || !reference) continue;
    const key = JSON.stringify([brand, reference]);
    if (!grouped.has(key)) grouped.set(key, { brand, reference, models: new Map(), files: new Set() });
    const group = grouped.get(key);
    for (const value of [row.model, ...(Array.isArray(row.model_claims) ? row.model_claims : [])]) {
      const model = trim(value);
      if (!model || /^(unknown|null|none|n\/?a|reference-only listings)$/i.test(model)) continue;
      const k = model.toLowerCase(), prior = group.models.get(k);
      if (!prior || Buffer.compare(Buffer.from(model), Buffer.from(prior)) < 0) group.models.set(k, model);
    }
    for (const file of row.source_files || []) if (typeof file === 'string' && file.trim()) group.files.add(file);
  }
  const result = {}, rejected = [];
  for (const group of [...grouped.values()].sort((a,b) => Buffer.compare(Buffer.from(JSON.stringify([a.brand,a.reference])), Buffer.from(JSON.stringify([b.brand,b.reference]))))) {
    if (group.models.size !== 1 || group.files.size === 0) {
      rejected.push({brand: group.brand, reference: group.reference, models: [...group.models.values()].sort(), reason: group.models.size > 1 ? 'AMBIGUOUS_EXACT_CATALOG_MODEL' : 'MISSING_CATALOG_MODEL_OR_SOURCE'});
      continue;
    }
    if (!Object.hasOwn(result, group.brand)) result[group.brand] = {};
    result[group.brand][group.reference] = { model: [...group.models.values()][0], source_files: [...group.files].sort() };
  }
  return { models: result, rejected, exact_pairs: grouped.size };
}
function lookupExactCatalogModel(reference, brand, registry = require('./exact-catalog-models.json')) {
  const b = brandKey(brand), r = referenceKey(reference);
  if (!b || !r || !Object.hasOwn(registry.models, b) || !Object.hasOwn(registry.models[b], r)) return null;
  const match = registry.models[b][r];
  return { model: match.model, brand_key: b, reference: r, source_files: [...match.source_files], catalog_sha256: registry.catalog_sha256 };
}
function withExactCatalogModel(record, sourceIdentity = record) {
  // Use the frozen identity bytes for the same lookup as the snapshot SQL.
  // Legacy display trimming must not make a broader catalog match.
  if (sourceModel(sourceIdentity.model) !== null) return record;
  const found = lookupExactCatalogModel(sourceIdentity.reference, sourceIdentity.brand);
  if (!found) return record;
  return { ...record, source_model: sourceIdentity.model ?? null, model: found.model,
    model_source: 'CATALOG_EXACT_BRAND_REFERENCE', model_catalog_sha256: found.catalog_sha256,
    model_catalog_reference: found.reference, model_catalog_source_files: found.source_files };
}
module.exports = { brandKey, referenceKey, sourceModel, buildExactCatalogModelMap, lookupExactCatalogModel, withExactCatalogModel };

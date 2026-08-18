/**
 * Brand-aware in-process catalog lookup for the live pipeline.
 *
 * The local catalog import is keyed by brand + reference. Reference values
 * alone are not globally unique, so an unbranded collision is returned as
 * ambiguous rather than silently assigning the wrong watch identity.
 */
const { readFileSync } = require('fs');
const { resolve } = require('path');
const { normalizeCanonicalModel } = require('./catalog-taxonomy');

const PUBLIC_DIR = resolve(process.cwd(), 'public');

let _catalog = null;
let _enriched = null;
let _sourceByBrandReference = null;
let _sourceByReference = null;
let _collapsedByBrandReference = null;
let _collapsedByReference = null;
let _curationOverrides = null;
let _curationAliases = null;
const LOOKUP_CACHE_MAX = 100_000;
const _lookupCache = new Map();

function normalizeRef(ref) {
  return String(ref || '').toUpperCase().replace(/[^A-Z0-9/\\-]/g, '');
}

function collapseRef(ref) {
  return String(ref || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeBrand(brand) {
  return String(brand || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Map common brand abbreviations/variants to their canonical official name */
const BRAND_ALIASES = {
  'PP': 'Patek Philippe',
  'AP': 'Audemars Piguet',
  'RM': 'Richard Mille',
  'VC': 'Vacheron Constantin',
  'JLC': 'Jaeger-LeCoultre',
  'GP': 'Girard-Perregaux',
  'GO': 'Glashütte Original',
  'A LANGE': 'A. Lange & Söhne',
  'A. LANGE': 'A. Lange & Söhne',
  'ALANGE': 'A. Lange & Söhne',
  'A LANGE SOHNE': 'A. Lange & Söhne',
  'A. LANGE & SOHNE': 'A. Lange & Söhne',
  'FP JOURNE': 'F.P. Journe',
  'F.P.JOURNE': 'F.P. Journe',
  'FPJOURNE': 'F.P. Journe',
  'H MOSER': 'H. Moser & Cie',
  'H. MOSER': 'H. Moser & Cie',
  'HMOSER': 'H. Moser & Cie',
  'GLASHUTTE ORIGINAL': 'Glashütte Original',
  'GLASHUTTE': 'Glashütte Original',
  'LUXURY WATCH': '',
  'TAG': 'TAG Heuer',
  'MB&F': 'MB&F',
  'MBF': 'MB&F',
};

function canonicalBrand(brand) {
  const raw = String(brand || '').trim();
  if (!raw) return '';
  const upper = raw.toUpperCase();
  if (BRAND_ALIASES[upper]) return BRAND_ALIASES[upper];
  // Check partial matches for multi-word aliases
  for (const [alias, canonical] of Object.entries(BRAND_ALIASES)) {
    if (upper === alias) return canonical;
  }
  return raw;
}

function inferredOrExpectedBrand(reference, expectedBrand) {
  return expectedBrand || inferBrand(reference) || null;
}

function inferBrand(rawRef) {
  const raw = String(rawRef || '').trim().toUpperCase();
  if (/^\d{3,4}(?:\.\d{2}){3,}\.\d{3}$/.test(raw)) return 'Omega';
  const r = collapseRef(rawRef);
  if (!r) return null;
  if (/^[3-7]\d{3}\//.test(normalizeRef(rawRef))) return 'Patek Philippe';
  if (/^RM\d{2}/.test(r)) return 'Richard Mille';
  if (/^IW\d{4,6}$/.test(r)) return 'IWC';
  if (/^(WSSA|WSNM|WGNM|WJSA|CRWS|CRWG)/.test(r)) return 'Cartier';
  if (/^(15|26|77)\d{3}[A-Z]{2}/.test(r)) return 'Audemars Piguet';
  if (/^(33\d{4}|47\d{4}|85\d{4}|81180|85180|4500V|4300V|6000V)/.test(r)) return 'Vacheron Constantin';
  if (/^\d{6}[A-Z]{0,4}$/.test(r)) return 'Rolex';
  if (/^(79\d{4}|70\d{4})[A-Z]*$/.test(r)) return 'Tudor';
  if (/^PAM\d{3,4}$/i.test(r)) return 'Panerai';
  if (/^Q\d{5,6}$/i.test(r)) return 'Jaeger-LeCoultre';
  if (/^(AB|A[123])\d{4}[A-Z]?$/i.test(r)) return 'Breitling';
  if (/^HUB\d{2}/.test(r)) return 'Hublot';
  if (/^(CR|WG|HP|WE)\d{3}/i.test(r)) return 'Cartier';
  return null;
}

function compatibleWithBrand(entry, expectedBrand) {
  return !expectedBrand || !entry.brand || normalizeBrand(entry.brand) === normalizeBrand(expectedBrand);
}

function found(entry, matchType, matchedRef) {
  return Object.assign({ found: true, matchType, matchedRef }, entry);
}

function curationKey(brand, reference) {
  return `${normalizeBrand(brand)}|${normalizeRef(reference)}`;
}

function loadCuration() {
  if (_curationOverrides && _curationAliases) return;
  _curationOverrides = new Map();
  _curationAliases = new Map();
  try {
    const curation = JSON.parse(readFileSync(resolve(process.cwd(), 'api/dictionaries/catalog-curation.json'), 'utf8'));
    for (const item of curation.overrides || []) {
      if (item?.brand && item?.reference) _curationOverrides.set(curationKey(item.brand, item.reference), item);
    }
    for (const item of curation.aliases || []) {
      if (item?.brand && item?.alias && item?.canonical_reference) {
        _curationAliases.set(curationKey(item.brand, item.alias), item);
      }
    }
  } catch (error) {
    console.error('[catalog] failed to load catalog curation:', error.message);
  }
}

function applyCuration(entry, reference = null) {
  if (!entry) return entry;
  loadCuration();
  const override = _curationOverrides.get(curationKey(entry.brand, reference || entry.reference));
  if (!override) return entry;
  const allowedDials = new Set(override.dial_colors || []);
  return {
    ...entry,
    dialColors: override.dial_colors || entry.dialColors,
    variants: Array.isArray(entry.variants)
      ? entry.variants.filter(variant => allowedDials.has(variant.dial_color))
      : entry.variants,
    source: 'catalog_curation',
    curationReason: override.reason || null,
  };
}

function addCollapsedEntry(reference, entry) {
  const collapsed = collapseRef(reference);
  if (!collapsed) return;
  const brandKey = `${normalizeBrand(entry.brand)}|${collapsed}`;
  if (!_collapsedByBrandReference.has(brandKey)) _collapsedByBrandReference.set(brandKey, []);
  _collapsedByBrandReference.get(brandKey).push({ reference, entry });
  if (!_collapsedByReference.has(collapsed)) _collapsedByReference.set(collapsed, []);
  _collapsedByReference.get(collapsed).push({ reference, entry });
}

function loadCatalogs() {
  if (_catalog && _enriched && _sourceByBrandReference && _sourceByReference
    && _collapsedByBrandReference && _collapsedByReference) return;
  _catalog = new Map();
  _enriched = new Map();
  _sourceByBrandReference = new Map();
  _sourceByReference = new Map();
  _collapsedByBrandReference = new Map();
  _collapsedByReference = new Map();

  try {
    const catalog = JSON.parse(readFileSync(resolve(PUBLIC_DIR, 'catalog.json'), 'utf8'));
    for (const item of catalog) {
      const ref = normalizeRef(item.reference);
      if (!ref) continue;
      _catalog.set(ref, {
        brand: item.brand || inferBrand(item.reference) || null,
        collection: item.collection || null,
        model: item.model || null,
        caseMetal: item.case_metal || null,
        productionYears: item.production_years || null,
        status: item.status || null,
        dialColors: item.dial_colors || null,
        source: 'catalog',
      });
      addCollapsedEntry(ref, _catalog.get(ref));
    }
  } catch (error) {
    console.error('[catalog] failed to load catalog.json:', error.message);
  }

  try {
    const enrichedRaw = JSON.parse(readFileSync(resolve(PUBLIC_DIR, 'enriched_refs.json'), 'utf8'));
    // enriched_refs.json may be an array or an object keyed by reference
    const enriched = Array.isArray(enrichedRaw)
      ? enrichedRaw
      : Object.entries(enrichedRaw).map(([key, val]) => ({ ...val, reference: val.reference || key }));
    for (const item of enriched) {
      const ref = normalizeRef(item.reference);
      if (!ref || _enriched.has(ref)) continue;
      const resolvedBrand = canonicalBrand(item.brand) || inferBrand(item.reference) || null;
      if (!resolvedBrand) continue; // Skip unresolvable brands like "Luxury Watch"
      _enriched.set(ref, {
        brand: resolvedBrand,
        collection: item.collection && item.collection !== 'Unknown' ? item.collection : null,
        model: item.model && item.model !== 'Unknown' ? item.model : null,
        caseMetal: item.case_metal && item.case_metal !== 'Unknown' ? item.case_metal : null,
        productionYears: item.production_years && item.production_years !== 'Unknown' ? item.production_years : null,
        liquidityScore: item.liquidity_score != null ? item.liquidity_score : null,
        totalMentions: item.total_mentions != null ? item.total_mentions : null,
        avgPrice: item.avg_price != null ? item.avg_price : null,
        source: 'enriched',
      });
      addCollapsedEntry(ref, _enriched.get(ref));
    }
  } catch (error) {
    console.error('[catalog] failed to load enriched_refs.json:', error.message);
  }

  try {
    const source = JSON.parse(readFileSync(resolve(PUBLIC_DIR, 'catalog-source-v1.json'), 'utf8'));
    for (const item of source.entries || []) {
      const ref = normalizeRef(item.reference);
      const brand = String(item.brand || '').trim();
      if (!ref || !brand) continue;
      const entry = {
        reference: item.reference,
        brand,
        collection: null,
        model: item.model || null,
        modelClaims: item.model_claims || [],
        dialColors: item.dial_colors || [],
        variants: item.variants || [],
        source: 'local_catalog_v1',
      };
      _sourceByBrandReference.set(`${normalizeBrand(brand)}|${ref}`, entry);
      addCollapsedEntry(ref, entry);
      const candidates = _sourceByReference.get(ref) || [];
      candidates.push(entry);
      _sourceByReference.set(ref, candidates);
    }
  } catch (error) {
    console.error('[catalog] failed to load catalog-source-v1.json:', error.message);
  }
}

function sourceExactMatch(ref, expectedBrand) {
  if (expectedBrand) {
    const entry = _sourceByBrandReference.get(`${normalizeBrand(expectedBrand)}|${ref}`);
    return entry ? found(applyCuration(entry, ref), 'exact', ref) : null;
  }

  const candidates = _sourceByReference.get(ref) || [];
  if (candidates.length === 1) return found(applyCuration(candidates[0], ref), 'exact', ref);
  if (candidates.length > 1) {
    const inferred = inferBrand(ref);
    const inferredCandidate = inferred
      ? candidates.find(entry => normalizeBrand(entry.brand) === normalizeBrand(inferred))
      : null;
    if (inferredCandidate) return found(applyCuration(inferredCandidate, ref), 'exact_inferred_brand', ref);
    return {
      found: false,
      brand: null,
      source: 'local_catalog_v1',
      matchType: 'ambiguous_reference',
      matchedRef: null,
      candidates: candidates.map(entry => ({ brand: entry.brand, model: entry.model || null })),
    };
  }
  return null;
}

function curatedAliasMatch(ref, expectedBrand) {
  if (!expectedBrand) return null;
  loadCuration();
  const alias = _curationAliases.get(curationKey(expectedBrand, ref));
  if (!alias) return null;
  const canonicalRef = normalizeRef(alias.canonical_reference);
  const canonical = sourceExactMatch(canonicalRef, alias.brand);
  if (!canonical) return null;
  const { found: _found, matchType: _matchType, matchedRef: _matchedRef, ...entry } = canonical;
  return found({
    ...entry,
    source: 'catalog_curation',
    aliasOf: canonicalRef,
    curationReason: alias.reason || canonical.curationReason || null,
  }, 'exact_alias', canonicalRef);
}

function legacyMatch(map, reference, expectedBrand, matchType) {
  const ref = normalizeRef(reference);
  const direct = map.get(ref);
  if (direct && compatibleWithBrand(direct, expectedBrand)) return found(direct, matchType, ref);
  return null;
}

function lookupCatalogUncached(reference, expectedBrand = null) {
  loadCatalogs();
  const empty = {
    found: false,
    brand: inferredOrExpectedBrand(reference, expectedBrand),
    source: null,
    matchType: null,
    matchedRef: null,
  };
  const ref = normalizeRef(reference);
  if (!ref) return empty;

  const curatedAlias = curatedAliasMatch(ref, expectedBrand);
  if (curatedAlias) return curatedAlias;

  const sourceExact = sourceExactMatch(ref, expectedBrand);
  if (sourceExact) return sourceExact;

  let incompleteExact = null;
  for (const map of [_catalog, _enriched]) {
    const direct = legacyMatch(map, reference, expectedBrand, 'exact');
    if (direct?.model) return direct;
    if (direct && !incompleteExact) incompleteExact = direct;
  }

  const collapsed = collapseRef(reference);
  const collapsedCandidates = expectedBrand
    ? (_collapsedByBrandReference.get(`${normalizeBrand(expectedBrand)}|${collapsed}`) || [])
    : (_collapsedByReference.get(collapsed) || []);
  const collapsedBrands = new Set(collapsedCandidates.map(candidate => normalizeBrand(candidate.entry.brand)).filter(Boolean));
  if (!expectedBrand && collapsedBrands.size > 1) {
    return {
      ...empty,
      matchType: 'ambiguous_reference',
      candidates: collapsedCandidates.map(candidate => ({ brand: candidate.entry.brand, model: candidate.entry.model || null })),
    };
  }
  const sourceRank = { local_catalog_v1: 0, catalog_curation: 0, catalog: 1, enriched: 2 };
  const orderedCollapsed = [...collapsedCandidates].sort((left, right) =>
    (sourceRank[left.entry.source] ?? 9) - (sourceRank[right.entry.source] ?? 9));
  for (const candidate of orderedCollapsed) {
    if (candidate.entry.model && compatibleWithBrand(candidate.entry, expectedBrand)) {
      return found(candidate.entry, 'collapsed', candidate.reference);
    }
  }

  // Partial values are candidates, never catalog confirmation. The caller must
  // still gate them before normalizing a listing.
  for (const map of [_sourceByBrandReference, _catalog, _enriched]) {
    for (const [key, entry] of map) {
      const entryRef = map === _sourceByBrandReference ? key.split('|').slice(1).join('|') : key;
      const shorter = ref.length <= entryRef.length ? ref : entryRef;
      if (shorter.length >= 4 && (entryRef.startsWith(ref) || ref.startsWith(entryRef)) && compatibleWithBrand(entry, expectedBrand)) {
        return found(entry, 'partial', entryRef);
      }
    }
  }

  // An exact enrichment record may contain only a claimed reference and image.
  // Prefer a modeled canonical-family candidate above, but retain that exact
  // evidence when no useful catalog candidate exists.
  return incompleteExact || empty;
}

function lookupCatalog(reference, expectedBrand = null) {
  const cacheKey = `${normalizeBrand(expectedBrand)}|${normalizeRef(reference)}`;
  const cached = _lookupCache.get(cacheKey);
  if (cached) return cached;

  const result = lookupCatalogUncached(reference, expectedBrand);
  if (_lookupCache.size >= LOOKUP_CACHE_MAX) {
    const oldest = _lookupCache.keys().next().value;
    _lookupCache.delete(oldest);
  }
  _lookupCache.set(cacheKey, result);
  return result;
}

function listEquivalentReferences(reference, expectedBrand = null) {
  const normalizedReference = normalizeRef(reference);
  const references = new Set([normalizedReference].filter(Boolean));
  const brand = normalizeBrand(expectedBrand);

  // Patek dealers commonly omit the terminal -001 configuration suffix. Keep
  // this deterministic pair available even when serverless file tracing omits
  // the optional curation JSON from a deployed function bundle.
  if (brand === 'PATEKPHILIPPE') {
    const patekBase = normalizedReference.match(/^(\d{4}\/\d[A-Z])(?:-001)?$/)?.[1];
    if (patekBase) {
      references.add(patekBase);
      references.add(`${patekBase}-001`);
    }
  }

  const match = lookupCatalog(reference, expectedBrand);
  // Partial catalog matches are suggestions, not equivalent identities. A
  // partial token such as 5711 must not inherit 5711/110P-001 here because
  // downstream market queries treat this list as exact evidence.
  if (!match?.found || match.matchType === 'partial') return [...references].sort();

  loadCuration();
  const canonical = normalizeRef(match.aliasOf || match.matchedRef || match.reference || reference);
  const matchedBrand = normalizeBrand(expectedBrand || match.brand);
  references.add(canonical);

  for (const alias of _curationAliases.values()) {
    if (normalizeBrand(alias.brand) !== matchedBrand) continue;
    if (normalizeRef(alias.canonical_reference) === canonical) references.add(normalizeRef(alias.alias));
  }

  return [...references].sort();
}

function catalogStats() {
  loadCatalogs();
  return {
    catalog: _catalog.size,
    enriched: _enriched.size,
    localSource: _sourceByBrandReference.size,
    uniqueLocalReferences: _sourceByReference.size,
  };
}

function listCatalogReferences(brand, model = null) {
  loadCatalogs();
  const expectedBrand = normalizeBrand(brand);
  const candidates = [];
  for (const entry of _sourceByBrandReference.values()) candidates.push(entry);
  for (const [reference, entry] of _catalog) candidates.push({ ...entry, reference });
  for (const [reference, entry] of _enriched) candidates.push({ ...entry, reference });

  const FALLBACK_MODEL = 'Reference-only listings';
  const unique = new Map();
  for (const entry of candidates) {
    if (normalizeBrand(entry.brand) !== expectedBrand || !entry.reference) continue;
    const entryModel = entry.model || FALLBACK_MODEL;
    const key = normalizeRef(entry.reference);
    if (!unique.has(key) || entry.source === 'local_catalog_v1') {
      unique.set(key, { reference: entry.reference, brand: entry.brand, model: entryModel });
    }
  }
  return [...unique.values()]
    .filter(entry => !model || entry.model === model)
    .sort((a, b) => a.model.localeCompare(b.model) || a.reference.localeCompare(b.reference));
}

/**
 * Return only identities carried by the deterministic catalog-source file.
 *
 * `listCatalogReferences` intentionally retains legacy/enrichment identities
 * for private exact lookup compatibility. Those legacy files also contain
 * observed listing tokens (prices, currencies, years and message fragments),
 * so they must not be used to build the public Price Research browse tree.
 */
function listCanonicalCatalogReferences(brand, model = null) {
  loadCatalogs();
  const expectedBrand = normalizeBrand(brand);
  const FALLBACK_MODEL = 'Reference-only listings';
  const unique = new Map();

  for (const entry of _sourceByBrandReference.values()) {
    if (normalizeBrand(entry.brand) !== expectedBrand || !entry.reference) continue;
    const reference = String(entry.reference).trim();
    const curated = applyCuration(entry, normalizeRef(reference));
    const canonicalBrand = curated.brand || entry.brand;
    const canonical = {
      reference,
      brand: canonicalBrand,
      model: normalizeCanonicalModel(curated.model || entry.model || FALLBACK_MODEL, canonicalBrand),
    };
    const key = normalizeRef(reference);
    if (!unique.has(key)) unique.set(key, canonical);
  }

  return [...unique.values()]
    .filter(entry => !model || entry.model === model)
    .sort((a, b) => a.model.localeCompare(b.model) || a.reference.localeCompare(b.reference));
}

function listCatalogBrands() {
  loadCatalogs();
  const brands = new Map();
  for (const entry of _sourceByBrandReference.values()) {
    if (!entry.brand || !entry.reference) continue;
    const current = brands.get(entry.brand) || { references: new Set(), models: new Set() };
    current.references.add(entry.reference);
    current.models.add(normalizeCanonicalModel(entry.model || 'Reference-only listings', entry.brand));
    brands.set(entry.brand, current);
  }
  return [...brands.entries()]
    .map(([brand, values]) => ({
      brand,
      reference_count: values.references.size,
      model_count: values.models.size,
    }))
    .sort((a, b) => b.reference_count - a.reference_count || a.brand.localeCompare(b.brand));
}

function levenshteinDistance(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[b.length];
}

/**
 * Return bounded, catalog-backed reference suggestions for marketplace search.
 * Suggestions are presentation candidates only: callers must not treat a
 * prefix or typo match as a confirmed listing identity until the user selects
 * the exact reference.
 */
function listCatalogSuggestions(query, { brand = null, limit = 10 } = {}) {
  loadCatalogs();
  const rawQuery = String(query || '').trim();
  const queryKey = collapseRef(rawQuery);
  const queryText = rawQuery.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  if (queryKey.length < 2 && queryText.length < 2) return [];

  const expectedBrand = normalizeBrand(brand);
  // Autocomplete is a public identity surface, so it must use only the
  // deterministic catalog-source cache. The legacy catalog/enrichment files
  // contain observed listing strings (for example condition/year suffixes)
  // that remain useful as private lookup evidence but are not canonical
  // reference suggestions.
  const candidates = [..._sourceByBrandReference.values()];

  const unique = new Map();
  for (const entry of candidates) {
    const reference = normalizeRef(entry.reference);
    const referenceKey = collapseRef(reference);
    const entryBrand = canonicalBrand(entry.brand) || entry.brand || '';
    const brandKey = normalizeBrand(entryBrand);
    if (!reference || !entryBrand || (expectedBrand && brandKey !== expectedBrand)) continue;

    const model = String(entry.model || '').trim();
    const searchableText = `${entryBrand} ${model} ${reference}`.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
    let score = Number.POSITIVE_INFINITY;
    let matchType = null;
    if (referenceKey === queryKey) {
      score = 0;
      matchType = 'exact_reference';
    } else if (referenceKey.startsWith(queryKey)) {
      score = 10 + Math.min(referenceKey.length - queryKey.length, 9);
      matchType = 'reference_prefix';
    } else if (queryKey.length >= 3 && referenceKey.includes(queryKey)) {
      score = 25 + referenceKey.indexOf(queryKey);
      matchType = 'reference_contains';
    } else if (queryText && searchableText.startsWith(queryText)) {
      score = 35;
      matchType = 'catalog_text_prefix';
    } else if (queryText.length >= 3 && searchableText.includes(queryText)) {
      score = 45 + searchableText.indexOf(queryText) / 100;
      matchType = 'catalog_text_contains';
    } else if (/\d/.test(queryKey) && queryKey.length >= 5) {
      const tolerance = queryKey.length >= 9 ? 2 : 1;
      const distance = Math.abs(referenceKey.length - queryKey.length) <= tolerance
        ? levenshteinDistance(referenceKey, queryKey)
        : tolerance + 1;
      if (distance <= tolerance) {
        score = 60 + distance + Math.abs(referenceKey.length - queryKey.length) / 10;
        matchType = 'reference_typo_candidate';
      }
    }
    if (!matchType) continue;

    const curated = applyCuration(entry, reference);
    const variantImage = Array.isArray(curated.variants)
      ? curated.variants.find(variant => /^https?:\/\//i.test(String(variant?.image_url || '')))?.image_url
      : null;
    const key = `${brandKey}|${referenceKey}`;
    const suggestion = {
      brand: entryBrand,
      model: curated.model || model || null,
      reference,
      dial_colors: curated.dialColors || [],
      image_url: variantImage || null,
      match_type: matchType,
      score,
      source: curated.source || entry.source || 'catalog',
    };
    const existing = unique.get(key);
    const sourcePriority = suggestion.source === 'catalog_curation' || suggestion.source === 'local_catalog_v1' ? 0 : 1;
    const existingPriority = existing?.source === 'catalog_curation' || existing?.source === 'local_catalog_v1' ? 0 : 1;
    if (!existing || score < existing.score || (score === existing.score && sourcePriority < existingPriority)) {
      unique.set(key, suggestion);
    }
  }

  return [...unique.values()]
    .sort((left, right) => left.score - right.score
      || left.brand.localeCompare(right.brand)
      || left.reference.localeCompare(right.reference))
    .slice(0, Math.min(Math.max(Number(limit) || 10, 1), 20));
}

module.exports = {
  lookupCatalog,
  listEquivalentReferences,
  inferBrand,
  canonicalBrand,
  normalizeRef,
  catalogStats,
  listCatalogReferences,
  listCanonicalCatalogReferences,
  listCatalogBrands,
  listCatalogSuggestions,
};

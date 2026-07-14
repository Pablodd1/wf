/**
 * Brand-aware in-process catalog lookup for the live pipeline.
 *
 * The local catalog import is keyed by brand + reference. Reference values
 * alone are not globally unique, so an unbranded collision is returned as
 * ambiguous rather than silently assigning the wrong watch identity.
 */
const { readFileSync } = require('fs');
const { resolve } = require('path');

const PUBLIC_DIR = resolve(process.cwd(), 'public');

let _catalog = null;
let _enriched = null;
let _sourceByBrandReference = null;
let _sourceByReference = null;

function normalizeRef(ref) {
  return String(ref || '').toUpperCase().replace(/[^A-Z0-9/\\-]/g, '');
}

function collapseRef(ref) {
  return String(ref || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeBrand(brand) {
  return String(brand || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function humanLabel(value) {
  const label = String(value || '').trim();
  return label && !/^(unknown|n\/a|unspecified|null)$/i.test(label) ? label : null;
}

function inferredOrExpectedBrand(reference, expectedBrand) {
  return expectedBrand || inferBrand(reference) || null;
}

function inferBrand(rawRef) {
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
  if (/^3\d{4}\.\d/.test(String(rawRef))) return 'Omega';
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

function loadCatalogs() {
  if (_catalog && _enriched && _sourceByBrandReference && _sourceByReference) return;
  _catalog = new Map();
  _enriched = new Map();
  _sourceByBrandReference = new Map();
  _sourceByReference = new Map();

  try {
    const catalog = JSON.parse(readFileSync(resolve(PUBLIC_DIR, 'catalog.json'), 'utf8'));
    for (const item of catalog) {
      const ref = normalizeRef(item.reference);
      if (!ref) continue;
      _catalog.set(ref, {
        brand: item.brand || inferBrand(item.reference) || null,
        collection: item.collection || null,
        model: humanLabel(item.model) || humanLabel(item.collection),
        caseMetal: item.case_metal || null,
        productionYears: item.production_years || null,
        status: item.status || null,
        dialColors: item.dial_colors || null,
        source: 'catalog',
      });
    }
  } catch (error) {
    console.error('[catalog] failed to load catalog.json:', error.message);
  }

  try {
    const enriched = JSON.parse(readFileSync(resolve(PUBLIC_DIR, 'enriched_refs.json'), 'utf8'));
    for (const item of enriched) {
      const ref = normalizeRef(item.reference);
      if (!ref || _enriched.has(ref)) continue;
      _enriched.set(ref, {
        brand: item.brand || inferBrand(item.reference) || null,
        collection: humanLabel(item.collection),
        model: humanLabel(item.model) || humanLabel(item.collection),
        caseMetal: item.case_metal && item.case_metal !== 'Unknown' ? item.case_metal : null,
        productionYears: item.production_years && item.production_years !== 'Unknown' ? item.production_years : null,
        liquidityScore: item.liquidity_score != null ? item.liquidity_score : null,
        totalMentions: item.total_mentions != null ? item.total_mentions : null,
        avgPrice: item.avg_price != null ? item.avg_price : null,
        source: 'enriched',
      });
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
        brand,
        collection: null,
        model: item.model || null,
        modelClaims: item.model_claims || [],
        dialColors: item.dial_colors || [],
        variants: item.variants || [],
        source: 'local_catalog_v1',
      };
      _sourceByBrandReference.set(`${normalizeBrand(brand)}|${ref}`, entry);
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
    return entry ? found(entry, 'exact', ref) : null;
  }

  const candidates = _sourceByReference.get(ref) || [];
  if (candidates.length === 1) return found(candidates[0], 'exact', ref);
  if (candidates.length > 1) {
    const inferred = inferBrand(ref);
    const inferredCandidate = inferred
      ? candidates.find(entry => normalizeBrand(entry.brand) === normalizeBrand(inferred))
      : null;
    if (inferredCandidate) return found(inferredCandidate, 'exact_inferred_brand', ref);
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

function legacyMatch(map, reference, expectedBrand, matchType) {
  const ref = normalizeRef(reference);
  const direct = map.get(ref);
  if (direct && compatibleWithBrand(direct, expectedBrand)) return found(direct, matchType, ref);
  return null;
}

function lookupCatalog(reference, expectedBrand = null) {
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

  const sourceExact = sourceExactMatch(ref, expectedBrand);
  if (sourceExact) return sourceExact;

  for (const map of [_catalog, _enriched]) {
    const direct = legacyMatch(map, reference, expectedBrand, 'exact');
    if (direct) return direct;
  }

  const collapsed = collapseRef(reference);
  for (const map of [_sourceByBrandReference, _catalog, _enriched]) {
    for (const [key, entry] of map) {
      const entryRef = map === _sourceByBrandReference ? key.split('|').slice(1).join('|') : key;
      if (collapseRef(entryRef) === collapsed && compatibleWithBrand(entry, expectedBrand)) {
        return found(entry, 'collapsed', entryRef);
      }
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

  return empty;
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

module.exports = { lookupCatalog, inferBrand, normalizeRef, catalogStats };

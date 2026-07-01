/**
 * reference-catalog.js
 * Lightweight validation layer for parsed (brand, reference) pairs
 * against legacy MySQL taxonomy + fallback live tables.
 *
 * Data sources:
 *   - watchfacts_platforms_feeds.tbl_references (11,103 refs)
 *   - watchfacts_platforms_feeds.tbl_models     (1,704 models)
 *   - watchfacts_platforms_feeds.tbl_brands     (214 brands)
 *   - watchfacts_live.master_models             (19,256 models)
 *   - watchfacts_live.master_brand              (190 brands)
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Load the JSON catalog built from MySQL exports
const CATALOG_PATH = path.join(__dirname, 'reference-catalog.json');
let _catalog = null;
let _meta = null;

function loadCatalog() {
  if (_catalog) return { catalog: _catalog, meta: _meta };
  try {
    const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
    const data = JSON.parse(raw);
    _catalog = data.catalog || {};
    _meta = data.meta || {};
  } catch (err) {
    console.error('[ref-catalog] Failed to load reference-catalog.json:', err.message);
    _catalog = {};
    _meta = {};
  }
  return { catalog: _catalog, meta: _meta };
}

/**
 * Normalise brand name for lookup (case-insensitive, trim).
 */
function normaliseBrand(brand) {
  if (!brand) return null;
  return brand.trim();
}

/**
 * Normalise reference for lookup (uppercase, strip spaces).
 */
function normaliseRef(ref) {
  if (!ref) return null;
  return ref.toUpperCase().replace(/\s+/g, '');
}

/**
 * Strip common reference suffixes that don't change the base reference.
 * E.g. 116500LN -> 116500, 126610LV -> 126610, 5712/1A-001 -> 5712
 */
function stripRefSuffix(ref) {
  if (!ref) return null;
  return ref
    .toUpperCase()
    .replace(/[\s\-]+/g, '')
    .replace(/^(\d{5,6})(LN|LV|LB|LR|CH|DJ|DJ2|DD|DD2|SD|YM|YML|II|I|OR|OS|NR|NG|NA|NJ|NK|BLNR|BLRO|CHNR|SARU|SACO|RBOW|HULK|KERMIT|BATMAN|ROOTBEER|SMURF|PEPSI|COKA|COKE|JUB|OY|BP|TT|YG|WG|PG|RG|SS|ST|TT|TTG|BR|BL|BK|WH|GR|GN|BU|CH|SL|SA|OR|RD|PU|GY|BN|CH|CHS|CHP|CHNR|LN|LV|LB|LR|DJ|DJII|DJ2|DD|DDII|DD2|SD|YM|YML|II|I|OR|OS|NR|NG|NA|NJ|NK|BLNR|BLRO|CHNR|SARU|SACO|RBOW|HULK|KERMIT|BATMAN|ROOTBEER|SMURF|PEPSI|COKA|COKE|JUB|OY|BP|TT|YG|WG|PG|RG|SS|ST|TT|TTG|BR|BL|BK|WH|GR|GN|BU|CH|SL|SA|OR|RD|PU|GY|BN)$/i, '$1')
    .replace(/^(\d{4,6})([A-Z]{0,2})\d{0,2}$/i, '$1$2')
    .replace(/^(RM\d{2})([\-–]?\d{2}).*$/i, '$1$2')
    .replace(/^(\d{3}\.\d{3}).*$/i, '$1');
}

/**
 * Check if a (brand, reference) pair exists in the catalog.
 * Returns an object with match details.
 *
 * @param {string} brand   - Canonical brand name
 * @param {string} ref     - Extracted reference number
 * @returns {object}       - { matched, brandKnown, modelName, source }
 */
function validateReference(brand, ref) {
  const { catalog, meta } = loadCatalog();
  const b = normaliseBrand(brand);
  const r = normaliseRef(ref);
  const rBase = stripRefSuffix(r);

  if (!b || !r) {
    return { matched: false, brandKnown: false, modelName: null, source: null };
  }

  // Helper to search refs (exact + base suffix stripped)
  function searchInBrandEntry(brandEntry) {
    for (const [modelName, refs] of Object.entries(brandEntry)) {
      if (refs.includes(r)) return { matched: true, modelName };
      if (refs.includes(rBase)) return { matched: true, modelName };
      // Also try stripping suffixes from catalog refs for very loose match
      for (const cr of refs) {
        if (stripRefSuffix(cr) === rBase) return { matched: true, modelName };
      }
    }
    return null;
  }

  // 1. Exact brand match in primary catalog (platforms_feeds)
  const brandEntry = catalog[b];
  if (brandEntry) {
    const found = searchInBrandEntry(brandEntry);
    if (found) return { matched: true, brandKnown: true, modelName: found.modelName, source: 'platforms_feeds' };
    return { matched: false, brandKnown: true, modelName: null, source: 'platforms_feeds' };
  }

  // 2. Case-insensitive brand fallback
  const ciBrand = Object.keys(catalog).find(k => k.toLowerCase() === b.toLowerCase());
  if (ciBrand) {
    const found = searchInBrandEntry(catalog[ciBrand]);
    if (found) return { matched: true, brandKnown: true, modelName: found.modelName, source: 'platforms_feeds' };
    return { matched: false, brandKnown: true, modelName: null, source: 'platforms_feeds' };
  }

  // 3. Fallback: check if brand exists in live brand list
  const liveBrands = (meta.brandList || []);
  const liveBrandMatch = liveBrands.find(k => k.toLowerCase() === b.toLowerCase());
  if (liveBrandMatch) {
    return { matched: false, brandKnown: true, modelName: null, source: 'live_brand_fallback' };
  }

  // 4. Brand completely unknown
  return { matched: false, brandKnown: false, modelName: null, source: null };
}

/**
 * Quick check: is the brand known at all (in either source)?
 */
function isKnownBrand(brand) {
  const { catalog, meta } = loadCatalog();
  const b = normaliseBrand(brand);
  if (!b) return false;
  if (catalog[b]) return true;
  if (Object.keys(catalog).some(k => k.toLowerCase() === b.toLowerCase())) return true;
  const liveBrands = (meta.brandList || []);
  return liveBrands.some(k => k.toLowerCase() === b.toLowerCase());
}

/**
 * Quick check: is the model name known for this brand?
 */
function isKnownModel(brand, model) {
  const { catalog } = loadCatalog();
  const b = normaliseBrand(brand);
  const m = normaliseBrand(model);
  if (!b || !m) return false;
  const brandEntry = catalog[b] || Object.entries(catalog).find(([k]) => k.toLowerCase() === b.toLowerCase())?.[1];
  if (!brandEntry) return false;
  return Object.keys(brandEntry).some(k => k.toLowerCase() === m.toLowerCase());
}

module.exports = {
  validateReference,
  isKnownBrand,
  isKnownModel,
  loadCatalog,
};

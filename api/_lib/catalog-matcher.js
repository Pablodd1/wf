/**
 * Catalog Matcher — Loads catalog.json and provides fast reference lookups.
 * When a parsed reference matches the catalog, confidence goes to 100%.
 *
 * The catalog is a 6958-entry JSON array loaded once at module init.
 * Lookups are O(1) via a Map indexed by brand+reference key.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Load once at require-time
const CATALOG_PATH = path.join(__dirname, '..', '..', 'public', 'catalog.json');
let catalogData = [];
let catalogIndex = new Map();  // key: brand|ref_upper → entry

try {
  const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
  catalogData = JSON.parse(raw);

  for (const entry of catalogData) {
    if (!entry.brand || !entry.reference) continue;
    const brand = entry.brand.toUpperCase().trim();
    const ref = entry.reference.toUpperCase().trim();
    const key = `${brand}|${ref}`;
    catalogIndex.set(key, entry);
  }

  console.log(`[catalog-matcher] Loaded ${catalogIndex.size} catalog entries (${catalogData.length} raw)`);
} catch (err) {
  console.warn('[catalog-matcher] Failed to load catalog.json:', err.message);
  console.warn('[catalog-matcher] Catalog matching will be disabled. Non-fatal.');
  // Non-fatal — app works without catalog
  catalogData = [];
  catalogIndex = new Map();
}

/**
 * Look up a catalog entry by brand and reference.
 *
 * @param {string} brand - Brand name (e.g., "Rolex", "Patek Philippe")
 * @param {string} ref - Reference number (e.g., "126610LN", "5711/1A")
 * @returns {object|null} Catalog entry with { brand, model, reference, dialColor, imageUrl }
 */
function lookupCatalog(brand, ref) {
  if (!brand || !ref) return null;
  if (catalogIndex.size === 0) return null;

  const brandUpper = brand.toUpperCase().trim();
  const refUpper = ref.toUpperCase().trim();

  // 1. Exact match: brand + full reference
  let key = `${brandUpper}|${refUpper}`;
  if (catalogIndex.has(key)) return catalogIndex.get(key);

  // 2. Brand + reference without suffix (5711/1A-001 → 5711/1A)
  const refNoSuffix = refUpper.replace(/[-_.]\w+$/, '');
  if (refNoSuffix !== refUpper) {
    key = `${brandUpper}|${refNoSuffix}`;
    if (catalogIndex.has(key)) return catalogIndex.get(key);
  }

  // 3. Prefix match: brand + first 4-6 chars of ref
  const prefixes = [refUpper.substring(0, 6), refUpper.substring(0, 5), refUpper.substring(0, 4)];
  for (const prefix of prefixes) {
    if (prefix.length < 4) continue;
    // Search all entries for this brand with matching prefix
    for (const [k, v] of catalogIndex) {
      const [cbrand, cref] = k.split('|');
      if (cbrand === brandUpper && cref.startsWith(prefix)) {
        return v; // First match wins
      }
    }
  }

  // 4. Fuzzy: same ref, any brand (cross-brand match)
  // This catches cases where the parser identifies a ref but under wrong brand
  for (const [k, v] of catalogIndex) {
    const [, cref] = k.split('|');
    if (cref === refUpper || cref.startsWith(refUpper.substring(0, 6))) {
      return v;
    }
  }

  return null;
}

/**
 * Match a parsed listing against the catalog and return catalog data.
 * Used by the parser pipeline to populate catalogEntry for confidence scoring.
 *
 * @param {object} parsed - Parsed listing from parseFull()
 * @returns {object|null} Catalog entry or null
 */
function matchParsedListing(parsed) {
  const brand = parsed?.brand;
  const ref = parsed?.reference || parsed?.ref;

  if (!brand || !ref) return null;

  const entry = lookupCatalog(brand, ref);
  if (entry) return entry;

  // Also try quoted/corrected brand if the parser has one
  if (parsed.canonicalBrand && parsed.canonicalBrand !== brand) {
    return lookupCatalog(parsed.canonicalBrand, ref);
  }

  return null;
}

/**
 * Get catalog statistics.
 */
function getStats() {
  return {
    totalEntries: catalogData.length,
    indexedEntries: catalogIndex.size,
    brands: [...new Set(catalogData.map(e => e.brand).filter(Boolean))].length,
  };
}

module.exports = {
  lookupCatalog,
  matchParsedListing,
  getStats,
  catalogIndex,
  catalogData,
};

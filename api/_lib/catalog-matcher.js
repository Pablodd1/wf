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
const SHORTREF_MAP_PATH = path.join(__dirname, 'shortref-map.json');
let catalogData = [];
let catalogIndex = new Map();  // key: brand|ref_upper → entry
let shortrefMap = {};          // JASS-6 Phase 0: "BRAND|SHORT" → "FULLREF" (unambiguous folds only)

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

// JASS-6 Phase 0 short→full map. Built by scripts/build-shortref-map.js — folds
// a bare short ref to its full catalog form ONLY when the expansion is
// unambiguous (exactly one full ref extends that numeric base). Ambiguous bases
// (e.g. AP 15210 → 28 variants) are deliberately absent, so we never guess.
try {
  shortrefMap = JSON.parse(fs.readFileSync(SHORTREF_MAP_PATH, 'utf8'));
  console.log(`[catalog-matcher] Loaded ${Object.keys(shortrefMap).length} short→full ref mappings`);
} catch (err) {
  console.warn('[catalog-matcher] short→full map not loaded (non-fatal):', err.message);
  shortrefMap = {};
}

/**
 * Look up a catalog entry by brand and reference.
 * v4.1: Enhanced fuzzy matching — normalizes spacing, dashes, case
 *       variations, and partial reference matching.
 *
 * @param {string} brand - Brand name (e.g., "Rolex", "Patek Philippe")
 * @param {string} ref - Reference number (e.g., "126610LN", "5711/1A")
 * @returns {object|null} Catalog entry with { brand, model, reference, dialColor, imageUrl }
 */
function lookupCatalog(brand, ref) {
  if (!brand || !ref) return null;
  if (catalogIndex.size === 0) return null;

  const brandUpper = brand.toUpperCase().trim();
  const refUpper = ref.toUpperCase().trim().replace(/\s+/g, '');

  // 0. v4.1: Normalize common dealer variations
  // "116500 L.N" → "116500LN", "116500 L N" → "116500LN"
  const refNormalized = refUpper
    .replace(/\s+/g, '')           // Remove all spaces
    .replace(/[._]/g, '');          // Remove dots/underscores

  // 1. Exact match: brand + full reference
  let key = `${brandUpper}|${refNormalized}`;
  if (catalogIndex.has(key)) return catalogIndex.get(key);

  // 1a. JASS-6 Phase 0 short→full fold. BEFORE the fuzzy prefix walk below,
  // consult the unambiguous short→full map. This deterministically resolves
  // a bare "116500" to "116500LN" instead of letting the fuzzy walk grab the
  // wrong sibling (116503) that merely shares the "1165" prefix. Only present
  // for bases with exactly ONE full-ref expansion, so it never guesses.
  const mapKey = `${brandUpper}|${refNormalized}`;
  if (shortrefMap[mapKey]) {
    const fullEntry = catalogIndex.get(`${brandUpper}|${shortrefMap[mapKey]}`);
    if (fullEntry) return fullEntry;
  }

  // 1b. Try original ref (in case normalization changed something)
  if (refNormalized !== refUpper) {
    key = `${brandUpper}|${refUpper}`;
    if (catalogIndex.has(key)) return catalogIndex.get(key);
  }

  // 2. Brand + reference without suffix (5711/1A-001 → 5711/1A)
  const refNoSuffix = refNormalized.replace(/[-_.]\w+$/, '');
  if (refNoSuffix !== refNormalized) {
    key = `${brandUpper}|${refNoSuffix}`;
    if (catalogIndex.has(key)) return catalogIndex.get(key);
  }

  // 2b. v4.1: Try adding/removing common separators
  // "126610LN" → also try "126610-LN", "126610 LN"
  // "5711/1A" → also try "57111A"
  const refVariants = [
    refNormalized.replace(/([A-Z])(?=[A-Z])/g, '$1-'),  // Insert dash between letter groups
    refNormalized.replace(/([A-Z]+)/g, '-$1'),           // Dash before letters
    refNoSuffix.replace(/\/([0-9A-Z])/g, '-$1'),         // Slash → dash
    refNoSuffix.replace(/[-\/]/g, ''),                    // Remove all separators
  ];
  for (const variant of refVariants) {
    if (variant && variant.length >= 4) {
      key = `${brandUpper}|${variant}`;
      if (catalogIndex.has(key)) return catalogIndex.get(key);
    }
  }

  // 3. Prefix match: brand + first 4-6 chars of ref
  const prefixes = [refNormalized.substring(0, 6), refNormalized.substring(0, 5), refNormalized.substring(0, 4)];
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

  // 4. v4.1: Numeric-only ref → match catalog refs starting with same digits
  // Handles: "116500" matching "116500LN", "116500LN " etc.
  const numericPart = refNormalized.match(/^\d{4,6}/);
  if (numericPart) {
    const numBase = numericPart[0];
    for (const [k, v] of catalogIndex) {
      const [cbrand, cref] = k.split('|');
      if (cbrand === brandUpper) {
        const catNum = cref.match(/^\d{4,6}/);
        if (catNum && catNum[0] === numBase) {
          return v;
        }
      }
    }
  }

  // 5. Cross-brand fuzzy fallback REMOVED (v4.10).
  // Previously this matched refs against ALL brands regardless of the
  // requested brand, causing cross-brand contamination: e.g.
  // lookupCatalog('Rolex', '82172') would return a Vacheron entry.
  // The parser's candidate scoring then gave this a +50 prefix-fold bonus,
  // causing a Rolex candidate ('82172') to steal the ref from the correct
  // Patek candidate ('82172/000R'). Cross-brand matches are unreliable
  // and should not influence brand-scoped ref selection.

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

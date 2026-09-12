'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const floor = fs.readFileSync(path.join(root, 'src/pages/TradingFloor.tsx'), 'utf8');
const language = fs.readFileSync(path.join(root, 'src/i18n/LanguageContext.tsx'), 'utf8');
const { enforceListingDisplayContract, adaptLegacyListingDisplayV1 } = require('../shared/listing-display-contract.cjs');

test('Trading Floor keeps category and activity controls in the filter panel only', () => {
  assert.doesNotMatch(floor, /Search observed references directly; catalog match is optional/);
  assert.doesNotMatch(floor, /Choose one or several posting countries/);
  assert.match(floor, /function DesktopFilters[\s\S]*t\('Category'\)[\s\S]*CATEGORY_OPTIONS\.map/);
  assert.match(floor, /function DesktopFilters[\s\S]*t\('Listing type'\)[\s\S]*INTENT_OPTIONS\.map/);
});

test('Japanese is a supported persisted application language', () => {
  assert.match(language, /AppLanguage = 'en' \| 'es' \| 'pt' \| 'zh' \| 'ja'/);
  assert.match(language, /code: 'ja', label: '日本語'/);
  assert.match(language, /browserLanguage\.startsWith\('ja'\)/);
  assert.match(language, /'Trading Floor': '取引フロア'/);
});

test('card contract exposes only evidence-backed USD as verified display price', () => {
  // Phase 2 strict provenance: these fixtures carry no V2 provenance
  // (source_id/source_hash), so the strict V2 path must fail closed and the
  // legacy V1 adapter is the explicit, correct entry point.
  assert.throws(() => enforceListingDisplayContract({
    id: 'one',
    price_usd: 12500,
    price_evidence_status: 'EXPLICIT_SOURCE_FX_CONVERTED',
  }), /Provenance assertion failed \[PROVENANCE_MISSING\]/);
  const converted = adaptLegacyListingDisplayV1({
    id: 'one',
    price_usd: 12500,
    price_evidence_status: 'EXPLICIT_SOURCE_FX_CONVERTED',
  });
  const ambiguous = adaptLegacyListingDisplayV1({
    id: 'two',
    price_usd: 12500,
    price_evidence_status: 'AMBIGUOUS_CURRENCY',
  });
  // A status label alone is not currency/FX evidence, including on the legacy adapter.
  assert.equal(converted.price_display_verified, false);
  assert.equal(converted.price_status, 'UNRESOLVED_CURRENCY');
  assert.equal(ambiguous.price_display_verified, false);
  assert.equal(converted.contract_version, 'watchfacts-listing-display-v1');
  assert.equal(converted.listing_display_contract_version, 'watchfacts-listing-display-v1');
  assert.equal(converted.price_research_eligible, false);
  assert.equal(converted.seller_name, null);
});

test('right-side Trading Floor scroll control is smooth and remains above overlays', () => {
  assert.match(floor, /document\.documentElement\.style\.scrollBehavior = 'smooth'/);
  assert.match(floor, /behavior: 'smooth'/);
  assert.match(floor, /z-\[60\]/);
});

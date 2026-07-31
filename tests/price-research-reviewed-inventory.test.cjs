'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'PriceResearch.tsx'), 'utf8');

test('Price Research browses reviewed inventory independently from qualified analytics', () => {
  assert.match(source, /api\/reviewed-market-inventory\?\$\{params\.toString\(\)\}/);
  assert.match(source, /Qualified price analytics are pending[\s\S]*Listings remain available below/);
  assert.match(source, /Available listings/);
  assert.match(source, /reviewedInventory\.total\.toLocaleString\(\)/);
  assert.match(source, /fetchReviewedInventory\(reviewedFilter\.reference, reviewedFilter\.brand, reviewedInventory\.page \+ 1\)/);
});

test('reviewed listing cards preserve evidence and never create client-side market averages', () => {
  assert.match(source, /record\.posted_by \|\| record\.seller_name/);
  assert.match(source, /record\.phone_number \|\| record\.seller_phone/);
  assert.match(source, /record\.raw_message/);
  assert.match(source, /Not used in averages: source currency evidence is unresolved/);
  assert.match(source, /SOURCE_EXPLICIT_USD_MATCH/);
  assert.doesNotMatch(source, /reviewedListings\.reduce/);
  assert.match(source, /api\/reviewed-seller-summary\?id=\$\{encodeURIComponent\(record\.id\)\}/);
  const reviewedCard = source.slice(source.indexOf('function ReviewedEvidenceCard'), source.indexOf('function ListingRow'));
  assert.doesNotMatch(reviewedCard, /api\/listing-contact|api\/price-research-listing/);
});

test('reviewed inventory images are original-only and remove their frame after a load failure', () => {
  const imageComponent = source.slice(source.indexOf('function ReviewedEvidenceImage'), source.indexOf('function reviewedPriceLabel'));
  assert.match(imageComponent, /if \(!src \|\| failed\) return null/);
  assert.match(imageComponent, /onError=\{\(\) => setFailed\(true\)\}/);
  assert.doesNotMatch(imageComponent, /placeholder|fallback|mock/i);
});

test('brand browsing is sourced from the reviewed publication inventory', () => {
  assert.match(source, /fetch\('\/api\/reviewed-market-inventory\?page=1&pageSize=12'/);
  assert.match(source, /payload\.summary\?\.brands \|\| payload\.summary\?\.publicationBrands \|\| payload\.publicationBrands/);
  assert.match(source, /typeof item === 'string'/);
  assert.match(source, /item\.listing_count\.toLocaleString\(\)\} listings/);
});

test('reference-only searches use the exact reviewed-inventory index', () => {
  assert.match(source, /if \(evidencePage === 1\) void fetchReviewedInventory\(normalizedReference, brand, 1\)/);
  assert.doesNotMatch(source, /Select a brand so the reviewed inventory/);
  assert.match(source, /aria-label="Watch brand"/);
});

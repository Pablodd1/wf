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
  assert.match(source, /Market comparison unavailable: currency is not explicit in the original listing/);
  assert.match(source, /SOURCE_EXPLICIT_USD_MATCH/);
  assert.doesNotMatch(source, /reviewedListings\.reduce/);
  assert.match(source, /api\/reviewed-seller-summary\?id=\$\{encodeURIComponent\(record\.id\)\}/);
  const reviewedCard = source.slice(source.indexOf('function ReviewedEvidenceCard'), source.indexOf('function ListingRow'));
  assert.doesNotMatch(reviewedCard, /api\/listing-contact|api\/price-research-listing/);
});

test('reviewed cards never fall back to a workbook USD value', () => {
  const priceLabel = source.slice(source.indexOf('function reviewedPriceLabel'), source.indexOf('function reviewedPriceEvidenceLabel'));
  const priceContext = source.slice(source.indexOf('function ReviewedPriceContext'), source.indexOf('function ReviewedEvidenceCard'));
  assert.doesNotMatch(priceLabel, /workbook_price_usd/);
  assert.doesNotMatch(priceContext, /workbook_price_usd/);
  assert.match(priceLabel, /source_price_text/);
  assert.match(priceLabel, /source_currency/);
});

test('rating and posting-date chart require the exact verified USD cohort', () => {
  const context = source.slice(source.indexOf('function ReviewedPriceContext'), source.indexOf('function ReviewedEvidenceCard'));
  assert.match(context, /record\.price_research_eligible === true/);
  assert.match(context, /record\.price_evidence_status === 'SOURCE_EXPLICIT_USD_MATCH'/);
  assert.match(context, /record\.listing_type === 'WTS'/);
  assert.match(context, /analytics\.analytics_ready/);
  assert.match(context, /sameEvidenceValue\(recordBrand, analytics\.brand\)/);
  assert.match(context, /record\.reference_search_key === referenceComparisonKey\(analyticsReference\)/);
  assert.match(context, /: sameEvidenceValue\(recordReference, analyticsReference\)/);
  assert.match(context, /sameEvidenceValue\(record\.dial_color, analytics\.selected_cohort\.dial_color\)/);
  assert.match(context, /rateMarketPrice\(price, analytics\.stats, analytics\.count\)/);
  assert.match(context, /analytics\.monthly\.map/);
  assert.match(context, /Price rating and timeline require at least five verified USD comparable offers for this exact reference and dial/);
  assert.match(context, /Projections remain unavailable unless the separate historical validation also passes/);
  assert.doesNotMatch(context, /\.reduce\(/);
});

test('customer cards explain evidence without internal workflow language', () => {
  const card = source.slice(source.indexOf('function ReviewedEvidenceCard'), source.indexOf('function ListingRow'));
  assert.match(source, /Currency basis: USD stated in the original listing/);
  assert.match(source, /verified USD comparables/);
  assert.doesNotMatch(card, /parser|human review|review queue|normalization confidence/i);
});

test('reviewed inventory images are source-supplied-only and remove their frame after a load failure', () => {
  const imageComponent = source.slice(source.indexOf('function ReviewedEvidenceImage'), source.indexOf('function reviewedPriceLabel'));
  assert.match(imageComponent, /if \(!src \|\| failed\) return null/);
  assert.match(imageComponent, /onError=\{\(\) => setFailed\(true\)\}/);
  assert.doesNotMatch(imageComponent, /placeholder|fallback|mock/i);
});

test('brand browsing is sourced from the reviewed publication inventory', () => {
  assert.match(source, /fetch\('\/api\/reviewed-market-inventory\?page=1&pageSize=12'/);
  assert.match(source, /payload\.publicationBrands \|\| payload\.summary\?\.publicationBrands/);
  assert.doesNotMatch(source, /payload\.summary\?\.brands \|\|/);
  assert.match(source, /typeof item === 'string'/);
  assert.match(source, /item\.listing_count\.toLocaleString\(\)\} listings/);
});

test('reference-only searches use the exact reviewed-inventory index', () => {
  assert.match(source, /if \(evidencePage === 1\) void fetchReviewedInventory\(normalizedReference, brand, 1\)/);
  assert.doesNotMatch(source, /Select a brand so the reviewed inventory/);
  assert.match(source, /aria-label="Watch brand"/);
});

test('a conventional punctuated reference is sent as an exact query without client-side fuzzy scanning', () => {
  const fetchReviewed = source.slice(source.indexOf('const fetchReviewedInventory'), source.indexOf('const loadModels'));
  const params = new URLSearchParams({ reference: '5712/1A', page: '1', pageSize: '24' });
  assert.equal(params.get('reference'), '5712/1A');
  assert.match(fetchReviewed, /new URLSearchParams\(\{ reference, page: String\(page\), pageSize: '24' \}\)/);
  assert.doesNotMatch(fetchReviewed, /includes\(|startsWith\(|endsWith\(|replace\([^)]*\//);
  assert.match(source, /record\.reference \|\| record\.normalized_reference \|\| record\.catalog_reference \|\| record\.raw_reference/);
  assert.match(source, /record\.reference_search_key === referenceComparisonKey\(analyticsReference\)/);
});

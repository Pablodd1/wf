'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const api = require('../api/reviewed-market-inventory.js');
const source = fs.readFileSync(
  path.join(__dirname, '../api/reviewed-market-inventory.js'),
  'utf8',
);
const migration = fs.readFileSync(
  path.join(__dirname, '../supabase/migrations/20260731180000_reviewed_workbook_evidence_order.sql'),
  'utf8',
);
const workflow = fs.readFileSync(
  path.join(__dirname, '../.github/workflows/reviewed-workbook-inventory-release.yml'),
  'utf8',
);

test('parses a combined exact-reference and dial search into indexed filters', () => {
  assert.match(source, /parseTradingSearch\(search\)/);
  assert.match(source, /req\.query\?\.reference \|\| parsedSearch\.reference/);
  assert.match(source, /query\.in\('dial_color', exactDialVariants\)/);
});

function record(overrides = {}) {
  return {
    id: 'workbook_1',
    source_file: 'Rolex all 1.xlsx',
    source_row_number: 2,
    source_record_id: 'auction_1',
    posting_date: '2026-07-01T00:00:00.000Z',
    posted_by: 'Dealer One',
    phone_number: '+15550100',
    contact_publication_approved: true,
    raw_message: 'Rolex 126500LN white USD 30,000',
    listing_type: 'WTS',
    brand_scope: 'Rolex',
    supplied_brand: 'Rolex',
    canonical_brand: 'Rolex',
    model: 'Daytona',
    catalog_model: null,
    raw_reference: '126500LN',
    normalized_reference: '126500LN',
    catalog_reference: null,
    dial_color: 'White',
    catalog_dial: null,
    condition: 'Used',
    workbook_price_usd: '30000',
    source_price_amount: '30000',
    source_price_text: 'USD 30,000',
    source_currency: 'USD',
    price_evidence_status: 'SOURCE_EXPLICIT_USD_MATCH',
    confidence: 100,
    verification_status: 'Reviewed',
    user_image_url: 'https://images.example.test/original.jpg',
    has_exact_source_image: true,
    has_verified_usd_price: true,
    verified_price_usd: '30000',
    reference_search_key: '126500LN',
    public_reference: '126500LN',
    reference_is_price_token: false,
    has_complete_identity: true,
    imported_at: '2026-07-31T00:00:00.000Z',
    ...overrides,
  };
}

test('maps exact reviewed evidence to the Trading Floor-compatible contract', () => {
  const mapped = api.mapReviewedRecord(record({
    model: 'Owner-reviewed Daytona',
    catalog_model: 'Catalog Daytona',
    normalized_reference: '126500LN',
    catalog_reference: '126500LN-CATALOG',
    dial_color: 'Owner-reviewed White',
    catalog_dial: 'Catalog White',
  }));
  assert.equal(mapped.brand, 'Rolex');
  assert.equal(mapped.model, 'Owner-reviewed Daytona');
  assert.equal(mapped.reference, '126500LN');
  assert.equal(mapped.reference_search_key, '126500LN');
  assert.equal(mapped.dial_color, 'Owner-reviewed White');
  assert.equal(mapped.price_usd, 30000);
  assert.equal(mapped.price_raw, 30000);
  assert.equal(mapped.currency, 'USD');
  assert.equal(mapped.seller_name, 'Dealer One');
  assert.equal(mapped.seller_phone, '+15550100');
  assert.equal(mapped.has_images, true);
  assert.equal(mapped.thumbnail_url, 'https://images.example.test/original.jpg');
  assert.deepEqual(mapped.image_urls, ['https://images.example.test/original.jpg']);
  assert.equal(mapped.evidence_coverage.identity.complete, true);
  assert.equal(mapped.evidence_coverage.contact.available, true);
  assert.equal(mapped.evidence_coverage.image.provenance, 'EXACT_SOURCE_URL');
  assert.equal(mapped.evidence_coverage.price.analytics_eligible, true);
});

test('labels generated workbook text as a summary rather than an original post', () => {
  const generated = api.mapReviewedRecord(record({ raw_message: 'WTS Rolex 126500LN White 30000.00' }));
  assert.equal(generated.raw_message_scope, 'normalized_summary');
  assert.equal(generated.raw_message_evidence_type, 'WORKBOOK_NORMALIZED_SUMMARY');
  const generatedWithoutSourcePrice = api.mapReviewedRecord(record({
    raw_message: 'WTS Rolex 126500LN White 30000.00',
    source_price_amount: null,
  }));
  assert.equal(generatedWithoutSourcePrice.raw_message_scope, 'normalized_summary');
  assert.equal(generatedWithoutSourcePrice.raw_message_evidence_type, 'WORKBOOK_NORMALIZED_SUMMARY');
  const recovered = api.mapReviewedRecord(record({
    raw_message: 'NTQ - 5821/1a green',
    listing_type: 'WTB',
    model: 'Cubitus',
    raw_reference: '5821/1a',
    normalized_reference: '5821/1A',
    source_price_amount: null,
  }));
  assert.equal(recovered.raw_message_scope, 'stored_source_message');
  assert.equal(recovered.raw_message_evidence_type, 'SOURCE_RAW_MESSAGE');
});

test('removes the entire image contract when no exact supplied image exists', () => {
  const mapped = api.mapReviewedRecord(record({
    user_image_url: null,
    has_exact_source_image: false,
    catalog_image_url: 'https://catalog.example.test/reference.jpg',
    display_image_url: 'https://catalog.example.test/reference.jpg',
  }));
  assert.equal(mapped.has_images, false);
  assert.equal(mapped.thumbnail_url, null);
  assert.deepEqual(mapped.image_urls, []);
  assert.equal(mapped.image_evidence_type, 'NO_IMAGE');
  assert.doesNotMatch(JSON.stringify(mapped), /catalog\.example\.test/);
});

test('customer image copy contains no internal review-process labels', () => {
  const mapped = api.mapReviewedRecord(record());
  assert.equal(mapped.image_evidence_label, 'Source-supplied listing image');
  assert.equal(mapped.image_evidence_notice, 'Exact image URL supplied with this source listing.');
  assert.doesNotMatch(mapped.image_evidence_notice, /review/i);
});

test('never promotes unresolved workbook USD values into verified USD price', () => {
  const mapped = api.mapReviewedRecord(record({
    workbook_price_usd: '38461',
    source_price_amount: '300000',
    source_price_text: 'HKD 300,000',
    source_currency: 'HKD',
    price_evidence_status: 'DATED_FX_PROVENANCE_REQUIRED',
    has_verified_usd_price: false,
    verified_price_usd: null,
  }));
  assert.equal(mapped.price_usd, null);
  assert.equal(mapped.price_raw, 300000);
  assert.equal(mapped.currency, 'HKD');
  assert.equal(mapped.workbook_price_usd, 38461);
  assert.equal(mapped.price_research_eligible, false);
});

test('reference punctuation variants share one exact key without changing display reference', () => {
  assert.equal(api.referenceComparisonKey('5712/1A'), '57121A');
  assert.equal(api.referenceComparisonKey('5712-1A'), '57121A');
  assert.equal(api.referenceComparisonKey('57121A'), '57121A');
  assert.equal(api.referenceComparisonKey('5712'), '5712');
  const mapped = api.mapReviewedRecord(record({
    raw_reference: '5712/1A',
    normalized_reference: '57121A',
    public_reference: '57121A',
    reference_search_key: '57121A',
  }));
  assert.equal(mapped.reference, '5712/1A');
  assert.equal(mapped.reference_search_key, '57121A');
  assert.match(source, /\.eq\('reference_search_key', reference\)/);
  assert.doesNotMatch(source, /\.ilike\(|\.contains\(/);
});

test('fails closed when a price and currency token contaminates the reference', () => {
  assert.equal(api.referenceIsPriceToken('470000USDT', 470000, 'USDT'), true);
  assert.equal(api.referenceIsPriceToken('USDT470000', 470000, 'USDT'), true);
  assert.equal(api.referenceIsPriceToken('000USD', null, null), true);
  assert.equal(api.referenceIsPriceToken('5712/1A', 470000, 'USDT'), false);
  assert.equal(api.referenceIsPriceToken('116500LN', 30000, 'USD'), false);

  const mapped = api.mapReviewedRecord(record({
    raw_message: 'Patek Philippe watch 470000 USDT',
    normalized_reference: '470000USDT',
    raw_reference: '470000USDT',
    public_reference: null,
    reference_search_key: null,
    reference_is_price_token: true,
    has_complete_identity: false,
    source_price_amount: '470000',
    source_price_text: '470000 USDT',
    source_currency: 'USDT',
    workbook_price_usd: '470000',
    verified_price_usd: '470000',
  }));

  assert.equal(mapped.reference, null);
  assert.equal(mapped.reference_search_key, null);
  assert.equal(mapped.raw_reference, '470000USDT');
  assert.equal(mapped.normalized_reference, '470000USDT');
  assert.equal(mapped.reference_invalid_reason, 'PRICE_CURRENCY_TOKEN');
  assert.equal(mapped.has_complete_identity, false);
  assert.equal(mapped.price_usd, 470000);
  assert.equal(mapped.price_research_eligible, false);
  assert.equal(mapped.evidence_coverage.identity.complete, false);
  assert.equal(mapped.evidence_coverage.identity.invalid_reference_reason, 'PRICE_CURRENCY_TOKEN');
  assert.equal(mapped.evidence_coverage.price.analytics_eligible, false);
});

test('verified USD remains ineligible until every identity field is present', () => {
  for (const overrides of [
    { model: null, catalog_model: null },
    { dial_color: null, catalog_dial: null },
  ]) {
    const mapped = api.mapReviewedRecord(record({
      ...overrides,
      has_complete_identity: false,
    }));
    assert.equal(mapped.price_usd, 30000);
    assert.equal(mapped.has_complete_identity, false);
    assert.equal(mapped.price_research_eligible, false);
    assert.equal(mapped.evidence_coverage.price.analytics_eligible, false);
  }
});

test('coverage summary is page-bounded and reconciles evidence flags', () => {
  const complete = api.mapReviewedRecord(record());
  const incomplete = api.mapReviewedRecord(record({
    id: 'workbook_2',
    model: null,
    catalog_model: null,
    phone_number: null,
    contact_publication_approved: false,
    user_image_url: null,
    has_exact_source_image: false,
    price_evidence_status: 'CURRENCY_AMBIGUOUS_OR_MISSING',
    has_verified_usd_price: false,
    verified_price_usd: null,
  }));
  assert.deepEqual(api.summarizeCoverage([complete, incomplete]), {
    scope: 'returned_page',
    record_count: 2,
    identity_complete: 1,
    contact_available: 1,
    exact_source_image: 1,
    price_analytics_eligible: 1,
  });
});

test('suppresses seller contact unless the stored owner-publication approval is true', () => {
  const mapped = api.mapReviewedRecord(record({ contact_publication_approved: false }));
  assert.equal(mapped.seller_name, null);
  assert.equal(mapped.seller_phone, null);
});

test('supports numeric and base64url page cursors', () => {
  assert.equal(api.parseCursorPage('2'), 2);
  assert.equal(api.parseCursorPage(Buffer.from('177755').toString('base64url')), 177755);
  assert.equal(api.parseCursorPage('0'), null);
  assert.equal(api.parseCursorPage('bad-token'), null);
});

test('scoped pages use one lookahead row instead of trusting estimated totals', () => {
  const rows = Array.from({ length: 25 }, (_, index) => ({ id: `workbook_${index}` }));
  const page = api.boundedPage(rows, 24, true);
  assert.equal(page.records.length, 24);
  assert.equal(page.hasLookahead, true);
  assert.deepEqual(api.boundedPage(rows.slice(0, 8), 24, true), {
    records: rows.slice(0, 8),
    hasLookahead: false,
  });
  assert.match(source, /pageWindow\.end \+ Number\(scopedFilter\)/);
  assert.match(source, /scopedFilter[\s\S]*\? pageResult\.hasLookahead/);
});

test('publication brands are derived from populated reviewed checkpoints', () => {
  assert.deepEqual(api.publicationBrandsFromSummary({ brands: [
    { brand: 'Rolex', canonical_listings: 10 },
    { brand: 'Patek Philippe', canonical_listings: 4 },
    { brand: 'Empty', canonical_listings: 0 },
  ] }), ['Rolex', 'Patek Philippe']);
});

test('public brand filters preserve punctuation and exact references use exact counts', () => {
  assert.match(source, /const requestedBrand = cleanExactText\(req\.query\?\.brand \|\| parsedSearch\.brand, 80\)/);
  assert.match(source, /item\.brand\?\.toLocaleLowerCase\(\) === requestedBrand\.toLocaleLowerCase\(\)/);
  assert.match(source, /const preciseCount = Boolean\(reference\)/);
  assert.match(source, /count: preciseCount \? 'exact' : scopedFilter \? 'estimated' : undefined/);
});

test('endpoint is read-only and reuses the exact-image then verified-USD v1 order', () => {
  assert.match(source, /\.from\(MARKET_SOURCE_VIEW\)/);
  assert.doesNotMatch(source, /\.from\(['"]watch_records['"]\)/);
  assert.doesNotMatch(source, /\.(?:insert|upsert|update|delete)\s*\(/);
  assert.match(source, /query = query\.eq\('has_complete_identity', true\)/);
  assert.match(source, /query = query\.neq\('verification_status', 'QUARANTINED_SOURCE_CONFLICT'\)/);
  assert.match(source, /order\('has_exact_source_image', \{ ascending: false \}\)[\s\S]*order\('has_verified_usd_price', \{ ascending: false \}\)[\s\S]*order\('verified_price_usd', \{ ascending: false, nullsFirst: false \}\)[\s\S]*order\('posting_date', \{ ascending: false, nullsFirst: false \}\)[\s\S]*order\('id', \{ ascending: true \}\)/);
  assert.doesNotMatch(source, /order\('has_complete_identity'/);
  assert.doesNotMatch(source, /order\('workbook_price_usd'/);
  assert.doesNotMatch(source, /catalog_image_url|final_image_url|display_image_url/);
});

test('service-only evidence view keeps strict identity while reusing v1 indexes', () => {
  assert.match(migration, /CREATE OR REPLACE VIEW public\.reviewed_workbook_market_source[\s\S]*security_invoker = true/);
  assert.match(migration, /REVOKE ALL ON public\.reviewed_workbook_market_source[\s\S]*PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT SELECT ON public\.reviewed_workbook_market_source TO service_role/);
  assert.match(migration, /reviewed_workbook_reference_is_price_token_v2[\s\S]*USD\|USDT\|HKD/);
  assert.match(migration, /reviewed_workbook_identity_complete_v2[\s\S]*p_brand[\s\S]*p_model[\s\S]*p_reference[\s\S]*p_dial/);
  assert.match(migration, /reference_search_key[\s\S]*public_reference[\s\S]*reference_is_price_token[\s\S]*has_complete_identity/);
  assert.match(migration, /regexp_replace\([\s\S]*upper\(COALESCE\(inventory\.normalized_reference, ''\)\)[\s\S]*AS reference_search_key/);
  assert.doesNotMatch(migration, /CREATE INDEX CONCURRENTLY/);
  assert.match(migration, /DROP INDEX CONCURRENTLY IF EXISTS public\.idx_reviewed_workbook_market_evidence_order_v2;/);
  assert.match(migration, /DROP INDEX CONCURRENTLY IF EXISTS public\.idx_reviewed_workbook_market_reference_evidence_order_v2;/);
  assert.doesNotMatch(migration, /DROP INDEX CONCURRENTLY IF EXISTS public\.idx_reviewed_workbook_market_evidence_order;/);
  assert.match(migration, /price_evidence_status = 'SOURCE_EXPLICIT_USD_MATCH'[\s\S]*workbook_price_usd > 0/);
  assert.doesNotMatch(migration, /\bBEGIN\b|\bCOMMIT\b/i);
  assert.match(workflow, /20260731180000_reviewed_workbook_evidence_order\.sql/);
  assert.match(workflow, /idx_reviewed_workbook_market_reference_evidence_order'/);
  assert.doesNotMatch(workflow, /idx_reviewed_workbook_market_reference_evidence_order_v2/);
  assert.match(workflow, /timeout-minutes: 30/);
  assert.match(workflow, /to_regprocedure\('public\.reviewed_workbook_identity_complete_v2\(text,text,text,text,numeric,text\)'\)/);
  assert.match(workflow, /to_regclass\('public\.reviewed_workbook_market_source'\)/);
});

test('standalone listing type is indexed while condition remains narrowly guarded', () => {
  assert.match(source, /if \(listingType && !\['WTS', 'WTB', 'OTHER'\]\.includes\(listingType\)\)/);
  assert.match(source, /if \(condition && !\(requestedBrand && reference\)\)/);
  assert.doesNotMatch(source, /if \(\(listingType \|\| condition\)/);
});

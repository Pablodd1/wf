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
  assert.equal(mapped.dial_color, 'Owner-reviewed White');
  assert.equal(mapped.price_usd, 30000);
  assert.equal(mapped.price_raw, 30000);
  assert.equal(mapped.currency, 'USD');
  assert.equal(mapped.seller_name, 'Dealer One');
  assert.equal(mapped.seller_phone, '+15550100');
  assert.equal(mapped.has_images, true);
  assert.equal(mapped.thumbnail_url, 'https://images.example.test/original.jpg');
  assert.deepEqual(mapped.image_urls, ['https://images.example.test/original.jpg']);
});

test('removes the entire image contract when no exact supplied image exists', () => {
  const mapped = api.mapReviewedRecord(record({
    user_image_url: null,
    catalog_image_url: 'https://catalog.example.test/reference.jpg',
    display_image_url: 'https://catalog.example.test/reference.jpg',
  }));
  assert.equal(mapped.has_images, false);
  assert.equal(mapped.thumbnail_url, null);
  assert.deepEqual(mapped.image_urls, []);
  assert.equal(mapped.image_evidence_type, 'NO_IMAGE');
  assert.doesNotMatch(JSON.stringify(mapped), /catalog\.example\.test/);
});

test('never promotes unresolved workbook USD values into verified USD price', () => {
  const mapped = api.mapReviewedRecord(record({
    workbook_price_usd: '38461',
    source_price_amount: '300000',
    source_price_text: 'HKD 300,000',
    source_currency: 'HKD',
    price_evidence_status: 'DATED_FX_PROVENANCE_REQUIRED',
  }));
  assert.equal(mapped.price_usd, null);
  assert.equal(mapped.price_raw, 300000);
  assert.equal(mapped.currency, 'HKD');
  assert.equal(mapped.workbook_price_usd, 38461);
  assert.equal(mapped.price_research_eligible, false);
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
  assert.match(source, /const requestedBrand = cleanExactText\(req\.query\?\.brand, 80\)/);
  assert.match(source, /item\.brand\?\.toLocaleLowerCase\(\) === requestedBrand\.toLocaleLowerCase\(\)/);
  assert.match(source, /const preciseCount = Boolean\(reference\)/);
  assert.match(source, /count: preciseCount \? 'exact' : scopedFilter \? 'estimated' : undefined/);
});

test('endpoint is read-only and orders exact images before descending workbook price', () => {
  assert.match(source, /\.from\('reviewed_workbook_inventory'\)/);
  assert.doesNotMatch(source, /\.from\(['"]watch_records['"]\)/);
  assert.doesNotMatch(source, /\.(?:insert|upsert|update|delete)\s*\(/);
  assert.match(source, /order\('has_image', \{ ascending: false \}\)[\s\S]*order\('workbook_price_usd', \{ ascending: false, nullsFirst: false \}\)[\s\S]*order\('id', \{ ascending: true \}\)/);
  assert.doesNotMatch(source, /catalog_image_url|final_image_url|display_image_url/);
});

test('standalone listing type is indexed while condition remains narrowly guarded', () => {
  assert.match(source, /if \(listingType && !\['WTS', 'WTB', 'OTHER'\]\.includes\(listingType\)\)/);
  assert.match(source, /if \(condition && !\(brand && reference\)\)/);
  assert.doesNotMatch(source, /if \(\(listingType \|\| condition\)/);
});

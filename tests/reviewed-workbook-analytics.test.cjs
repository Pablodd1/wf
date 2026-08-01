'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  mapWorkbookAnalyticsRow,
} = require('../api/_lib/reviewed-workbook-analytics.cjs');

test('maps only supplied reviewed-workbook evidence into the analytics contract', () => {
  const row = mapWorkbookAnalyticsRow({
    id: 'row-1',
    source_file: 'reviewed.xlsx',
    source_row_number: 42,
    source_record_id: 'source-42',
    posting_date: '2026-07-01',
    raw_message: 'Patek 5712/1A blue USD 120000',
    listing_type: 'WTS',
    brand_scope: 'Patek Philippe',
    supplied_brand: 'Patek Philippe',
    model: 'Nautilus',
    normalized_reference: '5712/1A',
    dial_color: 'Blue',
    source_price_amount: 120000,
    source_currency: 'USD',
    verified_price_usd: 120000,
    has_exact_source_image: true,
    user_image_url: 'https://example.test/source.jpg',
  });

  assert.equal(row.brand, 'Patek Philippe');
  assert.equal(row.model, 'Nautilus');
  assert.equal(row.reference, '5712/1A');
  assert.equal(row.dial_color, 'Blue');
  assert.equal(row.price_usd, 120000);
  assert.equal(row.analytics_currency_status, 'VERIFIED');
  assert.equal(row.owner_reviewed_identity, true);
  assert.deepEqual(row.image_urls, ['https://example.test/source.jpg']);
});

test('Price Research prefers verified reviewed-workbook cohorts and keeps legacy fallback', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'price-research.js'), 'utf8');
  assert.match(source, /loadReviewedWorkbookAnalyticsRows/);
  assert.match(source, /const usingReviewedWorkbook = reviewedWorkbookRows\.length > 0/);
  assert.match(source, /if \(usingReviewedWorkbook\) rows = reviewedWorkbookRows/);
  assert.match(source, /reviewed workbook analytics unavailable; using legacy cohort/);
  assert.match(source, /analytics_source: usingReviewedWorkbook/);
});

test('reviewed workbook loader requires complete identity and explicit verified USD', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'api', '_lib', 'reviewed-workbook-analytics.cjs'),
    'utf8',
  );
  assert.match(source, /eq\('has_complete_identity', true\)/);
  assert.match(source, /eq\('has_verified_usd_price', true\)/);
  assert.match(source, /eq\('listing_type', 'WTS'\)/);
  assert.doesNotMatch(source, /workbook_price_usd/);
});

test('Price Research listing detail supports the same reviewed workbook evidence', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'price-research-listing.js'), 'utf8');
  assert.match(source, /loadReviewedWorkbookListing/);
  assert.match(source, /price_evidence_status: 'SOURCE_EXPLICIT_USD_MATCH'/);
  assert.match(source, /image_provenance: workbookListing\.has_images \? 'source_supplied' : 'none'/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-key';

const {
  isMultiListing,
  mapReviewedRecord,
  safeSearchTerm,
} = require('../api/reviewed-market-inventory.js');
const { approvedPhone } = require('../api/reviewed-seller-summary.js');

function reviewedRow(overrides = {}) {
  return {
    id: `workbook_${'a'.repeat(64)}`,
    source_file: 'inventory.xlsx',
    raw_message: 'WTS Rolex 126710 Blue USD 10,000',
    supplied_brand: 'Rolex',
    model: 'GMT-Master II',
    raw_reference: '126710',
    normalized_reference: '126710',
    dial_color: 'Blue',
    listing_type: 'WTS',
    source_price_amount: 10_000,
    source_currency: 'USD',
    has_verified_usd_price: true,
    verified_price_usd: 10_000,
    price_evidence_status: 'SOURCE_EXPLICIT_USD_MATCH',
    has_exact_source_image: true,
    user_image_url: 'https://example.com/watch.jpg',
    contact_publication_approved: false,
    ...overrides,
  };
}

test('case-insensitive marketplace search input is bounded and PostgREST-safe', () => {
  assert.equal(safeSearchTerm('  Patek, Philippe (5990/1R)*  '), 'Patek Philippe 5990/1R');
  assert.equal(safeSearchTerm('x'.repeat(200)).length, 120);
});

test('a normalized single-watch summary keeps its exact source image', () => {
  const record = mapReviewedRecord(reviewedRow());
  assert.equal(record.multi_listing, false);
  assert.equal(record.thumbnail_url, 'https://example.com/watch.jpg');
});

test('multi-item parents never publish a shared image as one watch', () => {
  const row = reviewedRow({ model: 'Multiple' });
  assert.equal(isMultiListing(row), true);
  const record = mapReviewedRecord(row);
  assert.equal(record.multi_listing, true);
  assert.equal(record.has_images, false);
  assert.equal(record.thumbnail_url, null);
  assert.deepEqual(record.image_urls, []);
  assert.equal(record.evidence_coverage.image.available, false);
});

test('unbundled children never inherit the shared parent image', () => {
  const record = mapReviewedRecord(reviewedRow({
    parent_id: 'bundle-parent-1',
    model: 'Submariner',
    user_image_url: 'https://example.com/multi-watch-parent.jpg',
    has_exact_source_image: true,
  }));
  assert.equal(record.multi_listing, false);
  assert.equal(record.is_unbundled_child, true);
  assert.equal(record.has_images, false);
  assert.equal(record.thumbnail_url, null);
  assert.deepEqual(record.image_urls, []);
  assert.equal(record.evidence_coverage.image.available, false);
});

test('seller phone remains public when supplied by the source listing', () => {
  assert.equal(approvedPhone({ phone_number: '+1 312 555 0100', contact_publication_approved: false }), '+1 312 555 0100');
  assert.equal(approvedPhone({ phone_number: '+1 312 555 0100', contact_publication_approved: true }), '+1 312 555 0100');
});

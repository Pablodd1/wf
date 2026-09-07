'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const inventory = require('../api/reviewed-market-inventory.js');

function reviewedRow(overrides = {}) {
  return {
    id: 'listing-1',
    supplied_brand: 'Cartier',
    canonical_brand: 'Cartier',
    model: 'Santos',
    normalized_reference: 'WGBA0019',
    raw_reference: 'WGBA0019',
    dial_color: 'White',
    seller_name: 'Jaztime Watches',
    seller_phone: '17147340511',
    contact_publication_approved: true,
    listing_type: 'WTS',
    raw_message: 'WTS Cartier WGBA0019',
    item_category: 'WATCH',
    ...overrides,
  };
}

test('Cartier source phone alone cannot promote static feedback into an approved rating', () => {
  const record = inventory.mapReviewedRecord(reviewedRow());
  assert.equal(record.seller_rating, null);
  assert.equal(record.seller_review_count, 0);
  assert.equal(record.seller_rating_evidence_status, 'UNAVAILABLE');
  assert.equal(inventory.ratingMatches(record, 'rated'), false);
  assert.equal(inventory.ratingMatches(record, 'unrated'), true);
});

test('Richard Mille without exact rating evidence stays visibly unrated', () => {
  const record = inventory.mapReviewedRecord(reviewedRow({
    id: 'listing-rm',
    supplied_brand: 'Richard Mille',
    canonical_brand: 'Richard Mille',
    model: 'RM 11-03',
    normalized_reference: 'RM11-03',
    raw_reference: 'RM11-03',
    seller_name: 'Kc Jewelry and Watches in Los Angeles',
    seller_phone: '13107705126',
    raw_message: 'WTS Richard Mille RM11-03',
  }));
  assert.equal(record.seller_rating, null);
  assert.equal(record.seller_review_count, 0);
  assert.equal(record.seller_rating_evidence_status, 'UNAVAILABLE');
  assert.equal(inventory.ratingMatches(record, 'rated'), false);
  assert.equal(inventory.ratingMatches(record, 'unrated'), true);
});

test('later-brand fallback preserves rating filter and card disclosure contract', () => {
  const api = fs.readFileSync(path.join(__dirname, '..', 'api', 'reviewed-market-inventory.js'), 'utf8');
  const floor = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'TradingFloor.tsx'), 'utf8');
  const dealerEvidence = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ListingDealerEvidence.tsx'), 'utf8');
  const fallback = api.slice(api.indexOf('if (laterReviewedBrand && qnsaBroadPage && records.length === 0'));
  assert.match(fallback, /\.filter\(record => ratingMatches\(record, rating\)\)/);
  assert.match(floor, /<DealerRatingBadge/);
  assert.match(dealerEvidence, /ratingEvidenceStatus === 'SOURCE_FEEDBACK_COUNT'/);
  assert.match(dealerEvidence, />Not rated<\/span>/);
  assert.match(dealerEvidence, /reviewCount > 0/);
});

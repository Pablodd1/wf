'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const inventory = require('../api/reviewed-market-inventory.js');
const { isHumanReviewAnalyticsCandidate } = require('../api/_lib/price-research-eligibility.cjs');
const { validateDecisionBody } = require('../api/identity-review-decision.js');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Audemars Piguet pending-review singles use the same safe Trading Floor lane', () => {
  const row = {
    item_category: 'WATCH',
    canonical_brand: 'Audemars Piguet',
    listing_type: 'WTS',
    trading_floor_status: 'published_pending_verification',
    publication_lane: 'QNSA_NORMALIZED_STAGING_V1',
    normalization_run_complete: true,
    raw_lineage_verified: true,
    publication_state: 'PENDING_VERIFICATION',
  };
  assert.equal(inventory.isPriorityHumanReviewBrand('Audemars Piguet'), true);
  assert.equal(inventory.isTradingFloorSourceRow(row), true);
  assert.equal(inventory.isTradingFloorSourceRow({ ...row, is_bundle: true }), false);
  assert.equal(inventory.isTradingFloorSourceRow({ ...row, raw_lineage_verified: false }), false);
});

test('Audemars Piguet human-review WTS reaches Price Research only as an evidence candidate', () => {
  const candidate = {
    brand: 'Audemars Piguet',
    verdict: 'NEEDS_REVIEW',
    listing_type: 'WTS',
    trading_floor_status: 'PUBLISHED_PENDING_VERIFICATION',
  };
  assert.equal(isHumanReviewAnalyticsCandidate(candidate), true);
  assert.equal(isHumanReviewAnalyticsCandidate({ ...candidate, listing_type: 'WTB' }), false);
  assert.equal(isHumanReviewAnalyticsCandidate({ ...candidate, trading_floor_status: 'SUPPRESSED_EXACT_DUPLICATE' }), false);
  assert.equal(isHumanReviewAnalyticsCandidate({ ...candidate, trading_floor_status: 'BUNDLE_PENDING_SEPARATION' }), false);
});

test('reviewer can approve complete catalog-backed Audemars Piguet identity', () => {
  const result = validateDecisionBody({
    recordId: 'ap-record-1',
    decision: 'APPROVE',
    reason: 'Exact reference and blue dial are visible in the raw listing.',
    canonical: {
      brand: 'Audemars Piguet',
      model: 'Royal Oak',
      reference: '15500ST',
      dial_color: 'Blue',
    },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.value.canonical.brand, 'Audemars Piguet');
});

test('three-brand UI and summary include Audemars Piguet without removing Rolex or Patek', () => {
  const floor = read('src/pages/TradingFloor.tsx');
  const research = read('src/pages/PriceResearch.tsx');
  const summary = read('api/live-release-summary.js');
  const reviewQueue = read('src/pages/ReviewQueue.tsx');

  assert.match(floor, /\['Rolex', 'Patek Philippe', 'Audemars Piguet'\]/);
  assert.match(research, /POPULAR_BRANDS = \['Rolex', 'Patek Philippe', 'Audemars Piguet'/);
  assert.match(summary, /\['Rolex', 'Patek Philippe', 'Audemars Piguet'\]\.map/);
  assert.match(reviewQueue, /Rolex, Patek Philippe, and Audemars Piguet identity review/);
});

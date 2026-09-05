'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isApprovedInventoryRecord,
  isTradingFloorSourceRow,
  normalizeItemCategory,
  effectiveItemCategory,
} = require('../api/reviewed-market-inventory.js');
const {
  isReleaseListingEligible,
} = require('../api/_lib/publication-references.cjs');

test('Trading Floor approval accepts both legacy percent and pipeline probability confidence', () => {
  assert.equal(isApprovedInventoryRecord({ verdict: 'APPROVED', confidence: 90 }), true);
  assert.equal(isApprovedInventoryRecord({ verdict: 'approved', confidence: 0.9 }), true);
  assert.equal(isApprovedInventoryRecord({ verdict: 'approved', confidence: 0.89 }), false);
});

test('legacy OTHER rows recover WATCH only from exclusive brand and reference evidence', () => {
  assert.equal(effectiveItemCategory({ item_category: 'OTHER', brand_scope: 'Rolex', normalized_reference: '116500LN' }), 'WATCH');
  assert.equal(effectiveItemCategory({ item_category: 'OTHER', brand_scope: 'Patek Philippe', raw_reference: '5712/1A' }), 'WATCH');
  assert.equal(effectiveItemCategory({ item_category: 'OTHER', brand_scope: 'Cartier', raw_reference: 'LOVE' }), 'OTHER');
  assert.equal(effectiveItemCategory({ item_category: 'OTHER', brand_scope: 'Rolex' }), 'OTHER');
  assert.equal(effectiveItemCategory({ item_category: 'HANDBAG', brand_scope: 'Rolex', raw_reference: '116500LN' }), 'HANDBAG');
});

test('recovered legacy watches enter their evidence lane while uncategorized luxury stays withheld', () => {
  const pending = {
    item_category: 'OTHER', canonical_brand: 'Rolex', normalized_reference: '116500LN',
    listing_type: 'WTS', trading_floor_status: 'published_pending_verification',
    publication_lane: 'QNSA_NORMALIZED_STAGING_V1', normalization_run_complete: true,
    raw_lineage_verified: true, publication_state: 'PENDING_VERIFICATION',
  };
  assert.equal(isTradingFloorSourceRow(pending), true);
  assert.equal(isTradingFloorSourceRow({
    ...pending, canonical_brand: 'Cartier', normalized_reference: 'LOVE',
  }), false);
});

test('Trading Floor excludes quarantined bundles without requiring a supplied price', () => {
  assert.equal(isApprovedInventoryRecord({ verdict: 'approved', confidence: 0.95, price_usd: null }), true);
  assert.equal(isApprovedInventoryRecord({
    verdict: 'approved', confidence: 0.95, listing_status: 'bundle_child_pending_review',
  }), false);
});

test('Trading Floor admits completed QNSA pending singles without requiring a price', () => {
  const pending = {
    item_category: 'WATCH', canonical_brand: 'Rolex', listing_type: 'WTS', verdict: 'pending', confidence: null,
    trading_floor_status: 'published_pending_verification',
    publication_lane: 'QNSA_NORMALIZED_STAGING_V1',
    normalization_run_complete: true, raw_lineage_verified: true,
    publication_state: 'PENDING_VERIFICATION', price_usd: null,
  };
  assert.equal(isTradingFloorSourceRow(pending), true);
  assert.equal(isTradingFloorSourceRow({ ...pending, listing_type: 'WTB' }), true);
  assert.equal(isTradingFloorSourceRow({ ...pending, item_category: 'HANDBAG' }), true);
  assert.equal(isTradingFloorSourceRow({ ...pending, item_category: 'JEWELRY' }), true);
  assert.equal(isTradingFloorSourceRow({ ...pending, normalization_run_complete: false }), false);
  assert.equal(isTradingFloorSourceRow({ ...pending, raw_lineage_verified: false }), false);
  assert.equal(isTradingFloorSourceRow({ ...pending, publication_lane: 'REVIEWED_LEGACY' }), false);
});

test('Trading Floor pending lane rejects bundles and unsupported categories', () => {
  const pending = {
    item_category: 'ACCESSORY', listing_type: 'WTS', verdict: 'pending',
    trading_floor_status: 'published_pending_verification',
    publication_lane: 'QNSA_NORMALIZED_STAGING_V1',
    normalization_run_complete: true, raw_lineage_verified: true,
    publication_state: 'PENDING_VERIFICATION',
  };
  assert.equal(isTradingFloorSourceRow(pending), true);
  assert.equal(isTradingFloorSourceRow({ ...pending, parent_id: 'parent-1' }), false);
  assert.equal(isTradingFloorSourceRow({ ...pending, is_bundle: true }), false);
  assert.equal(isTradingFloorSourceRow({ ...pending, item_category: 'OTHER' }), false);
  assert.equal(normalizeItemCategory('jewelry'), 'JEWELRY');
  assert.equal(normalizeItemCategory('unknown-category'), 'OTHER');
});

test('shared release gate normalizes pipeline confidence scale', () => {
  const record = {
    brand: 'Rolex', reference: '116610LN', verdict: 'approved', confidence: 0.9,
  };
  assert.equal(isReleaseListingEligible(record, 'Rolex::116610LN'), true);
  assert.equal(isReleaseListingEligible({ ...record, confidence: 0.89 }, 'Rolex::116610LN'), false);
});

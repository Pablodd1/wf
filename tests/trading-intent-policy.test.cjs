'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  databaseTradingIntentFilter,
  explicitRawIntent,
  resolveTradingIntent,
} = require('../api/_lib/trading-intent.cjs');
const {
  isTradingFloorSourceRow,
  mapReviewedRecord,
} = require('../api/reviewed-market-inventory.js');
const { loadRolexPatekOverlayRows } = require('../api/_lib/rolex-patek-reviewed-overlay.cjs');

test('explicit raw WTS/WTB wins over conflicting structured intent and records provenance', () => {
  const sell = resolveTradingIntent({
    rawMessage: 'WTS Rolex 126500LN USD 31,000',
    structuredIntent: 'WTB',
    hasSourcePrice: true,
    eligibleSingleWatch: true,
  });
  assert.equal(sell.intent, 'WTS');
  assert.equal(sell.provenance, 'SOURCE_RAW_EXPLICIT_INTENT');
  assert.equal(sell.review_reason, 'RAW_INTENT_OVERRIDES_STRUCTURED_INTENT');
  assert.equal(sell.inferred, false);

  const buy = resolveTradingIntent({
    rawMessage: 'Looking to buy Patek 5712/1A',
    structuredIntent: 'OTHER',
    hasSourcePrice: false,
    eligibleSingleWatch: true,
  });
  assert.equal(buy.intent, 'WTB');
  assert.equal(buy.provenance, 'SOURCE_RAW_EXPLICIT_INTENT');
});

test('owner sell and buy aliases remain source-derived rather than price-inferred', () => {
  for (const rawMessage of ['LTS Rolex 126500LN', 'FS Rolex 126500LN', 'Rolex 126500LN available']) {
    assert.equal(explicitRawIntent(rawMessage).intent, 'WTS');
  }
  for (const rawMessage of ['ISO Rolex 126500LN', 'Need Rolex 126500LN', 'LTB Rolex 126500LN', 'Looking for Rolex 126500LN']) {
    assert.equal(explicitRawIntent(rawMessage).intent, 'WTB');
  }
});

test('only missing-intent single watches use the owner price-presence fallback', () => {
  const priced = resolveTradingIntent({
    rawMessage: 'Rolex 126500LN white dial USD 31,000',
    structuredIntent: 'OTHER',
    hasSourcePrice: true,
    eligibleSingleWatch: true,
  });
  assert.deepEqual(
    [priced.intent, priced.provenance, priced.inferred, priced.review_reason],
    ['WTS', 'OWNER_MISSING_INTENT_FALLBACK_V1', true, 'MISSING_INTENT_PRICE_PRESENT_ASSUMED_WTS'],
  );

  const unpriced = resolveTradingIntent({
    rawMessage: 'Rolex 126500LN white dial full set',
    structuredIntent: null,
    hasSourcePrice: false,
    eligibleSingleWatch: true,
  });
  assert.deepEqual(
    [unpriced.intent, unpriced.provenance, unpriced.inferred, unpriced.review_reason],
    ['WTB', 'OWNER_MISSING_INTENT_FALLBACK_V1', true, 'MISSING_INTENT_UNPRICED_ASSUMED_WTB'],
  );
});

test('raw conflicts, multi-item records, and non-watch records are never owner-inferred', () => {
  assert.deepEqual(explicitRawIntent('WTB 126500LN / WTS 116500LN'), {
    intent: null,
    status: 'CONFLICT',
  });
  const conflict = resolveTradingIntent({
    rawMessage: 'WTB 126500LN / WTS 116500LN',
    structuredIntent: null,
    hasSourcePrice: true,
    eligibleSingleWatch: true,
  });
  assert.equal(conflict.intent, 'OTHER');
  assert.equal(conflict.provenance, 'SOURCE_RAW_INTENT_CONFLICT');
  assert.equal(conflict.inferred, false);

  for (const eligibleSingleWatch of [false]) {
    const unresolved = resolveTradingIntent({
      rawMessage: 'Cartier bracelet 10,000',
      structuredIntent: 'OTHER',
      hasSourcePrice: true,
      eligibleSingleWatch,
    });
    assert.equal(unresolved.intent, 'OTHER');
    assert.equal(unresolved.provenance, 'UNRESOLVED_INTENT');
  }
});

test('WTS/WTB database predicates remain broad so post-map fallback cannot skip rows', () => {
  assert.equal(databaseTradingIntentFilter('WTS'), null);
  assert.equal(databaseTradingIntentFilter('WTB'), null);
  assert.equal(databaseTradingIntentFilter('MULTI'), 'MULTI');
  assert.equal(databaseTradingIntentFilter('OTHER'), 'OTHER');
});

test('reviewed overlay can include a null stored intent without relaxing its verification tier', async () => {
  const calls = [];
  const query = {
    select() { return this; },
    eq(column, value) { calls.push(['eq', column, value]); return this; },
    not(column, operator, value) { calls.push(['not', column, operator, value]); return this; },
    or(value) { calls.push(['or', value]); return this; },
    in(column, values) { calls.push(['in', column, values]); return this; },
    order() { return this; },
    range() { return Promise.resolve({ data: [], error: null, count: 0 }); },
  };
  const client = { from(table) { calls.push(['from', table]); return query; } };
  await loadRolexPatekOverlayRows(client, {
    brand: 'Rolex',
    listingTypes: ['WTS', 'WTB', 'OTHER', 'UNKNOWN'],
    includeMissingIntent: true,
  });
  assert.ok(calls.some(call => call[0] === 'eq'
    && call[1] === 'verification_status' && call[2] === 'APPROVED_SINGLE_CANDIDATE'));
  assert.ok(calls.some(call => call[0] === 'eq' && call[1] === 'confidence' && call[2] === 100));
  assert.ok(calls.some(call => call[0] === 'or' && call[1].includes('listing_type.is.null')));
});

function approvedWatch(overrides = {}) {
  return {
    id: 'watch-1',
    item_category: 'WATCH',
    canonical_brand: 'Rolex',
    model: 'Cosmograph Daytona',
    normalized_reference: '126500LN',
    dial_color: 'White',
    raw_message: 'Rolex 126500LN white dial USD 31,000',
    listing_type: 'OTHER',
    source_price_amount: 31000,
    source_currency: 'USD',
    confidence: 100,
    verdict: 'APPROVED',
    trading_floor_status: 'APPROVED',
    publication_state: 'APPROVED',
    publication_lane: 'QNSA_GENERAL_MARKET_FEED_V1',
    normalization_run_complete: true,
    raw_lineage_verified: true,
    ...overrides,
  };
}

test('approved single watch with missing intent is customer eligible without weakening release gates', () => {
  assert.equal(isTradingFloorSourceRow(approvedWatch()), true);
  assert.equal(isTradingFloorSourceRow(approvedWatch({ verdict: 'REJECTED' })), false);
  assert.equal(isTradingFloorSourceRow(approvedWatch({
    raw_message: 'WTB Rolex 126500LN\nWTS Rolex 116500LN USD 25,000',
  })), false);
});

test('an exact reviewed unbundled child is included as a compact no-image card', () => {
  const child = approvedWatch({
    id: 'child-1',
    parent_id: 'parent-1',
    user_image_url: 'https://example.test/parent-image.jpg',
    has_exact_source_image: true,
    has_verified_usd_price: true,
    verified_price_usd: 31000,
    phone_number: '+1 212 555 0100',
    contact_publication_approved: false,
  });
  assert.equal(isTradingFloorSourceRow(child), true);
  const record = mapReviewedRecord(child);
  assert.equal(record.listing_type, 'WTS');
  assert.equal(record.listing_type_provenance, 'OWNER_MISSING_INTENT_FALLBACK_V1');
  assert.equal(record.is_unbundled_child, true);
  assert.equal(record.has_images, false);
  assert.equal(record.thumbnail_url, null);
  assert.deepEqual(record.image_urls, []);
  assert.equal(record.seller_phone, null);
});

test('unreviewed child lineage and unseparated multi messages remain withheld', () => {
  assert.equal(isTradingFloorSourceRow(approvedWatch({
    parent_id: 'parent-1',
    raw_lineage_verified: false,
  })), false);
  assert.equal(isTradingFloorSourceRow(approvedWatch({
    raw_message: 'Rolex 126500LN USD 31,000\nRolex 116500LN USD 25,000',
  })), false);
});

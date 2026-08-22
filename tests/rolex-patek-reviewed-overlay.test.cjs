'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  ROLEX_PATEK_DELTA_TIER,
  ROLEX_PATEK_MULTI_PARENT_ID,
  ROLEX_PATEK_MULTI_PARENT_STATUS,
  MULTI_PARENT_PUBLICATION_LANE,
  isExactRolexPatekMultiParent,
  mergeByExactLineage,
  overlayExactKeys,
  prepareOverlayRow,
} = require('../api/_lib/rolex-patek-reviewed-overlay.cjs');
const { redactPublicSource } = require('../api/_lib/source-redaction.cjs');
const { mapWorkbookAnalyticsRow } = require('../api/_lib/reviewed-workbook-analytics.cjs');
const priceResearchHandler = require('../api/price-research.js');
const priceResearchListingHandler = require('../api/price-research-listing.js');
const tradingFloorApi = require('../api/reviewed-market-inventory.js');

test('public raw evidence redacts contact PII and labeled handles without erasing reference or price evidence', () => {
  const raw = 'Rolex 126500LN USD 31,500 WhatsApp: +1 (305) 555-1212 Telegram @daytona_dealer john@example.com https://wa.me/13055551212';
  const redacted = redactPublicSource(raw);
  assert.match(redacted, /Rolex 126500LN USD 31,500/);
  assert.doesNotMatch(redacted, /305|john@example|wa\.me/);
  assert.match(redacted, /\[phone redacted\]/);
  assert.match(redacted, /\[email redacted\]/);
  assert.match(redacted, /\[contact link redacted\]/);
  assert.doesNotMatch(redacted, /@daytona_dealer/);
  assert.match(redacted, /Telegram \[handle redacted\]/);
});

test('exact structured multi-offer parent is Trading-Floor-only and excluded from analytics', () => {
  const parent = prepareOverlayRow({
    id: ROLEX_PATEK_MULTI_PARENT_ID,
    verification_tier: ROLEX_PATEK_DELTA_TIER,
    verification_status: ROLEX_PATEK_MULTI_PARENT_STATUS,
    source_message_id: 'source-message',
    source_payload_sha256: 'e'.repeat(64),
    canonical_brand: 'Rolex',
    listing_type: 'MULTI',
    raw_message: 'Rolex 134300 $11,100 USD\nRolex 134300 $10,600 USD',
    price_evidence_status: 'MULTI_PARENT_PRICE_WITHHELD',
    workbook_price_usd: null,
    normalized_reference: null,
    raw_reference: null,
    image_evidence_type: null,
    user_image_url: null,
  });
  assert.equal(isExactRolexPatekMultiParent(parent), true);
  assert.equal(parent.publication_lane, MULTI_PARENT_PUBLICATION_LANE);
  assert.equal(parent.trading_floor_status, 'PUBLISHED_MULTI_LISTING');
  assert.equal(parent.has_verified_usd_price, false);
  assert.equal(parent.verified_price_usd, null);
  assert.equal(parent.has_exact_source_image, false);
  const publicParent = tradingFloorApi.mapReviewedRecord(parent);
  assert.equal(publicParent.listing_type, 'MULTI');
  assert.equal(publicParent.listing_type_provenance, 'REVIEWED_EXACT_MULTI_PARENT');
  assert.equal(publicParent.multi_listing, true);
  assert.equal(publicParent.multi_listing_release_approved, true);
  assert.equal(priceResearchListingHandler.isTradingFloorOnlyReviewedListingId(parent.id), true);
  assert.equal(priceResearchListingHandler.isTradingFloorOnlyReviewedListingId(`rpdelta_${'f'.repeat(64)}`), false);
  assert.equal(mapWorkbookAnalyticsRow(parent).price_usd, null);

  assert.equal(isExactRolexPatekMultiParent({ ...parent, id: `rpdelta_${'f'.repeat(64)}` }), false);
  assert.equal(isExactRolexPatekMultiParent({ ...parent, normalized_reference: '134300' }), false);
  assert.equal(isExactRolexPatekMultiParent({ ...parent, user_image_url: 'https://example.test/ambiguous.jpg' }), false);
});

test('Price Research rejects the exact multi parent before any database lookup', async () => {
  const response = {
    statusCode: null,
    payload: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  await priceResearchListingHandler({
    method: 'GET',
    query: { id: ROLEX_PATEK_MULTI_PARENT_ID },
  }, response);
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.payload, { error: 'Listing is Trading Floor only' });
});

test('overlay admits an exact image only and prices only qualified WTS USD evidence', () => {
  const row = prepareOverlayRow({
    id: `rpdelta_${'a'.repeat(64)}`,
    source_message_id: 'msg-1',
    source_payload_sha256: 'b'.repeat(64),
    canonical_brand: 'Rolex',
    normalized_reference: '126500LN',
    listing_type: 'WTS',
    price_evidence_status: 'SOURCE_EXPLICIT_USD_MATCH',
    workbook_price_usd: 31500,
    image_evidence_type: 'SELLER_LISTING_IMAGE',
    user_image_url: 'https://images.example/exact.jpg',
  });
  assert.equal(row.publication_lane, ROLEX_PATEK_DELTA_TIER);
  assert.equal(row.raw_lineage_verified, true);
  assert.equal(row.has_exact_source_image, true);
  assert.equal(row.image_evidence_type, 'SELLER_LISTING_IMAGE');
  assert.equal(row.verified_price_usd, 31500);
  assert.equal(mapWorkbookAnalyticsRow(row).image_evidence_type, 'SELLER_LISTING_IMAGE');

  const wtb = prepareOverlayRow({ ...row, listing_type: 'WTB', workbook_price_usd: 31500 });
  assert.equal(wtb.has_verified_usd_price, false);
  assert.equal(wtb.verified_price_usd, null);
  assert.equal(mapWorkbookAnalyticsRow(wtb).price_usd, null);

  for (const priceEvidenceStatus of ['OWNER_DOLLAR_USD_POLICY', 'OWNER_K_USD_POLICY']) {
    const ownerApproved = prepareOverlayRow({
      ...row,
      price_evidence_status: priceEvidenceStatus,
      workbook_price_usd: 31500,
    });
    const analyticsRow = mapWorkbookAnalyticsRow(ownerApproved);
    assert.equal(ownerApproved.has_verified_usd_price, false);
    assert.equal(ownerApproved.verified_price_usd, null);
    assert.equal(ownerApproved.display_price_usd, 31500);
    assert.equal(ownerApproved.analytics_currency_status, 'OWNER_ASSUMED_USD');
    assert.equal(analyticsRow.price_usd, 31500);
    assert.equal(analyticsRow.analytics_currency_status, 'OWNER_ASSUMED_USD');
    assert.equal(analyticsRow.price_evidence_status, priceEvidenceStatus);
    assert.notEqual(analyticsRow.price_evidence_status, 'SOURCE_EXPLICIT_USD_MATCH');
  }

  for (const priceEvidenceStatus of ['NAMED_FOREIGN_CURRENCY_REQUIRES_DATED_FX', 'CURRENCY_AMBIGUOUS_OR_MISSING']) {
    const held = prepareOverlayRow({
      ...row,
      price_evidence_status: priceEvidenceStatus,
      workbook_price_usd: 31500,
    });
    assert.equal(held.has_verified_usd_price, false);
    assert.equal(mapWorkbookAnalyticsRow(held).price_usd, null);
  }

  const referenceImage = prepareOverlayRow({
    ...row,
    image_evidence_type: 'REFERENCE_IMAGE',
  });
  assert.equal(referenceImage.user_image_url, null);
  assert.equal(referenceImage.has_exact_source_image, false);
});

test('overlay deduplicates only exact id or source lineage and preserves same-reference dealer offers', () => {
  const base = [{
    id: 'base-1',
    source_record_id: 'source-1',
    brand: 'Rolex',
    reference: '126500LN',
    seller_name: 'Dealer A',
  }];
  const overlay = [
    { id: 'rpdelta-duplicate', source_record_id: 'source-1', brand: 'Rolex', reference: '126500LN' },
    { id: 'rpdelta-distinct', source_record_id: 'source-2', brand: 'Rolex', reference: '126500LN', seller_name: 'Dealer B' },
  ];
  const merged = mergeByExactLineage(base, overlay);
  assert.deepEqual(merged.rows.map(row => row.id), ['base-1', 'rpdelta-distinct']);
  assert.equal(merged.overlay_added_count, 1);
  assert.equal(merged.overlay_duplicate_count, 1);
  assert.deepEqual(overlayExactKeys(overlay[1]), ['id:rpdelta-distinct', 'record:source-2']);
});

test('Trading Floor and Price Research keep the reviewed delta additive', () => {
  const repo = path.join(__dirname, '..');
  const tradingApi = fs.readFileSync(path.join(repo, 'api', 'reviewed-market-inventory.js'), 'utf8');
  const tradingUi = fs.readFileSync(path.join(repo, 'src', 'pages', 'TradingFloor.tsx'), 'utf8');
  const priceApi = fs.readFileSync(path.join(repo, 'api', 'price-research.js'), 'utf8');
  assert.match(tradingApi, /reviewedOverlayRecords/);
  assert.match(tradingApi, /includeMultiParents: true/);
  assert.match(tradingApi, /const overlayListingTypes = listingType === 'MULTI'/);
  assert.match(tradingApi, /!listingType \|\| String\(record\.listing_type \|\| ''\)\.toUpperCase\(\) === listingType/);
  assert.match(tradingApi, /boundReviewedOverlayPage/);
  assert.match(tradingApi, /mergeByExactLineage\(\[\], filteredOverlay\)/);
  assert.match(tradingUi, /\[\.\.\.data\.records, \.\.\.overlay\]/);
  assert.match(priceApi, /mergeByExactLineage\(rows \|\| \[\], overlayWtsRows\)/);
  assert.match(priceApi, /SOURCE_EXPLICIT_USD_MATCH|loadRolexPatekOverlayEvidenceRows/);
  const analyticsLib = fs.readFileSync(path.join(repo, 'api', '_lib', 'reviewed-workbook-analytics.cjs'), 'utf8');
  assert.doesNotMatch(analyticsLib, /includeMultiParents:\s*true/);
});

test('combined Trading Floor pages are bounded, overlay-first, and totals label singles versus parent', () => {
  const base = Array.from({ length: 20 }, (_, index) => ({ id: `base-${index}` }));
  const overlay = Array.from({ length: 10 }, (_, index) => ({ id: `overlay-${index}` }));
  const bounded = tradingFloorApi.boundReviewedOverlayPage(base, overlay, 24);
  assert.equal(bounded.length, 4);
  assert.equal(base.length + bounded.length, 24);
  assert.equal(tradingFloorApi.combineInventoryTotal(562092, 813, false), 562905);
  assert.equal(tradingFloorApi.combineInventoryTotal(null, 813, false), null);
  const tradingUi = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'TradingFloor.tsx'), 'utf8');
  assert.match(tradingUi, /data\.status === 'ok' && Array\.isArray\(data\.records\)/);
  const tradingApiSource = fs.readFileSync(path.join(__dirname, '..', 'api', 'reviewed-market-inventory.js'), 'utf8');
  assert.match(tradingApiSource, /const overlayCapacity = reviewedOverlayLaneActive \? pageSize : 0/);
  assert.match(tradingApiSource, /offset: reviewedOverlayLaneActive \? requestedOffset : nextOffset/);
  assert.match(tradingApiSource, /const publicBaseRecords = reviewedOverlayLaneActive \? \[\] : records/);
  assert.match(tradingApiSource, /loadRolexPatekOverlayExactKeys/);
  assert.match(tradingApiSource, /reviewed_single_total/);
  assert.match(tradingApiSource, /structured_multi_parent_total/);
});

test('final and filtered overlay pages keep the canonical base cursor reachable', () => {
  const finalOverlayPage = tradingFloorApi.reviewedOverlayCursorState({
    requestedDeltaOffset: 800,
    reviewedOverlayTotal: 813,
    reviewedOverlayConsumed: 13,
    canonicalBaseHasMore: false,
    canonicalBaseRecordCount: 7,
  });
  assert.deepEqual(finalOverlayPage, {
    laneActive: true,
    overlayHasMore: false,
    hasMore: true,
  });

  const filteredToZeroButConsumed = tradingFloorApi.reviewedOverlayCursorState({
    requestedDeltaOffset: 100,
    reviewedOverlayTotal: 813,
    reviewedOverlayConsumed: 12,
    canonicalBaseHasMore: false,
    canonicalBaseRecordCount: 1,
  });
  assert.equal(filteredToZeroButConsumed.laneActive, true);
  assert.equal(filteredToZeroButConsumed.overlayHasMore, true);
  assert.equal(filteredToZeroButConsumed.hasMore, true);

  const baseLane = tradingFloorApi.reviewedOverlayCursorState({
    requestedDeltaOffset: 813,
    reviewedOverlayTotal: 813,
    reviewedOverlayConsumed: 0,
    canonicalBaseHasMore: false,
    canonicalBaseRecordCount: 7,
  });
  assert.deepEqual(baseLane, {
    laneActive: false,
    overlayHasMore: false,
    hasMore: false,
  });
});

test('later canonical pages remove exact reviewed lineage without collapsing same-reference offers', () => {
  const reviewedKeys = new Set(['message:message-1', `file-row:${'a'.repeat(64)}:42`]);
  const laterBasePage = [
    { id: 'base-duplicate', reference: '126500LN' },
    { id: 'base-distinct', reference: '126500LN' },
  ];
  const privateKeysById = new Map([
    ['base-duplicate', ['message:message-1', `file-row:${'a'.repeat(64)}:42`]],
    ['base-distinct', ['message:message-2', `file-row:${'b'.repeat(64)}:43`]],
  ]);
  assert.deepEqual(
    tradingFloorApi.excludeReviewedOverlayExactLineage(
      laterBasePage,
      reviewedKeys,
      privateKeysById,
    ).map(row => row.id),
    ['base-distinct'],
  );
});

test('overlay-first publication keeps the reviewed copy when the hidden base page overlaps', () => {
  const hiddenBase = [{ id: 'base-1', source_record_id: 'source-1' }];
  const reviewed = [{ id: 'rpdelta-1', source_record_id: 'source-1' }];
  const overlayFirst = mergeByExactLineage([], reviewed);
  assert.deepEqual(overlayFirst.rows.map(row => row.id), ['rpdelta-1']);
  assert.deepEqual(
    tradingFloorApi.excludeReviewedOverlayExactLineage(
      hiddenBase,
      new Set(overlayExactKeys(reviewed[0])),
    ),
    [],
  );
});

test('runtime handlers load and public mapping never emits private source message ids', async () => {
  assert.doesNotThrow(() => priceResearchHandler.normalizeAnalyticsPriceRow({
    id: 'row-1',
    listing_type: 'WTS',
    price_usd: null,
    raw_message: 'Rolex 126500LN',
  }, { usingQnsaReviewedSource: true, referenceVariants: ['126500LN'] }));

  const response = {
    statusCode: null,
    payload: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  await priceResearchHandler({ method: 'GET', query: {} }, response);
  assert.equal(response.statusCode, 400);

  const publicRecord = tradingFloorApi.mapReviewedRecord(prepareOverlayRow({
    id: `rpdelta_${'c'.repeat(64)}`,
    source_message_id: '+13055551212',
    source_payload_sha256: 'd'.repeat(64),
    canonical_brand: 'Rolex',
    model: 'Cosmograph Daytona',
    normalized_reference: '126500LN',
    dial_color: 'White',
    listing_type: 'WTS',
    raw_message: 'Rolex 126500LN WhatsApp +1 305 555 1212',
    image_evidence_type: 'SELLER_LISTING_IMAGE',
    user_image_url: 'https://images.example/overlay.jpg',
    confidence: 100,
  }));
  assert.equal(Object.hasOwn(publicRecord, 'source_message_id'), false);
  assert.doesNotMatch(publicRecord.raw_message, /305|555|1212/);
  assert.equal(publicRecord.image_evidence_type, 'SELLER_LISTING_IMAGE');
});

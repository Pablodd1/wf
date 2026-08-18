'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  ROLEX_PATEK_DELTA_TIER,
  mergeByExactLineage,
  overlayExactKeys,
  prepareOverlayRow,
} = require('../api/_lib/rolex-patek-reviewed-overlay.cjs');
const { redactPublicSource } = require('../api/_lib/source-redaction.cjs');
const { mapWorkbookAnalyticsRow } = require('../api/_lib/reviewed-workbook-analytics.cjs');
const priceResearchHandler = require('../api/price-research.js');
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
    assert.equal(analyticsRow.price_usd, 31500);
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
  assert.match(tradingApi, /mergeByExactLineage\(records, filteredOverlay\)/);
  assert.match(tradingUi, /\.\.\.\(data\.records \|\| \[\]\), \.\.\.\(data\.reviewedOverlayRecords \|\| \[\]\)/);
  assert.match(priceApi, /mergeByExactLineage\(rows \|\| \[\], overlayWtsRows\)/);
  assert.match(priceApi, /SOURCE_EXPLICIT_USD_MATCH|loadRolexPatekOverlayEvidenceRows/);
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

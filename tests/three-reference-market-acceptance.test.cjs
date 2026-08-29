'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-key';

const {
  compareInventoryForDisplay,
  isApprovedInventoryRecord,
  mapReviewedRecord,
} = require('../api/reviewed-market-inventory.js');
const {
  isPublicationReferenceAllowed,
} = require('../api/_lib/publication-references.cjs');
const {
  classifyResearchEligibility,
} = require('../api/_lib/price-research-eligibility.cjs');
const {
  deduplicateReposts,
} = require('../api/_lib/repost-deduplication.cjs');
const {
  legacyProfilePayload,
  ratedProfilePayload,
  sourceProfilePayload,
} = require('../api/_lib/dealer-directory-source.cjs');
const {
  summarizePrices,
} = require('../api/_lib/market-stats.cjs');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const CONTROLLED_REFERENCES = Object.freeze([
  { brand: 'Rolex', reference: '116500LN', model: 'Daytona', dial: 'White' },
  { brand: 'Patek Philippe', reference: '5712/1A-001', model: 'Nautilus', dial: 'Blue' },
  { brand: 'Audemars Piguet', reference: '26240ST', model: 'Royal Oak Chronograph', dial: 'Blue' },
]);

function reviewedRow(target, overrides = {}) {
  return {
    id: `${target.reference.replace(/[^a-z0-9]/gi, '_')}_${overrides.suffix || 'base'}`,
    source_file: 'three-reference-acceptance.xlsx',
    source_record_id: `source_${target.reference}`,
    raw_message: `WTS ${target.brand} ${target.reference} ${target.dial} USD 25,000`,
    supplied_brand: target.brand,
    model: target.model,
    raw_reference: target.reference,
    normalized_reference: target.reference,
    dial_color: target.dial,
    condition: 'Used',
    listing_type: 'WTS',
    source_price_amount: 25_000,
    source_currency: 'USD',
    has_verified_usd_price: true,
    verified_price_usd: 25_000,
    price_evidence_status: 'SOURCE_EXPLICIT_USD_MATCH',
    has_exact_source_image: true,
    user_image_url: `https://images.example/${target.reference.replace(/[^a-z0-9]/gi, '-')}.jpg`,
    contact_publication_approved: true,
    seller_name: 'Source Dealer',
    seller_phone: '+1 212 555 0100',
    dealer_rating: 4.8,
    review_count: 17,
    confidence: 95,
    verdict: 'APPROVED',
    ...overrides,
  };
}

test('the controlled Rolex, Patek exact/family, and AP references are admitted by the reviewed-brand release', () => {
  for (const target of CONTROLLED_REFERENCES) {
    assert.equal(
      isPublicationReferenceAllowed(target.brand, target.reference, 'ALL_REVIEWED'),
      true,
      `${target.brand} ${target.reference} must be available to both customer workflows`,
    );
  }
  assert.equal(isPublicationReferenceAllowed('Patek Philippe', '5712', 'ALL_REVIEWED'), true);
  assert.equal(isPublicationReferenceAllowed('Patek Philippe', '5712/1A', 'ALL_REVIEWED'), true);
});

test('all three Trading Floor records preserve source, seller, contact, rating, and exact image evidence', () => {
  for (const target of CONTROLLED_REFERENCES) {
    const record = mapReviewedRecord(reviewedRow(target));
    assert.equal(record.brand, target.brand);
    assert.equal(record.reference, target.reference);
    assert.match(record.raw_message, new RegExp(target.reference.replace('/', '\\/')));
    assert.equal(record.seller_name, 'Source Dealer');
    assert.equal(record.seller_phone, '+1 212 555 0100');
    assert.equal(record.seller_rating, 4.8);
    assert.equal(record.seller_review_count, 17);
    assert.equal(record.seller_rating_evidence_status, 'SOURCE_SUPPLIED');
    assert.equal(record.has_images, true);
    assert.equal(record.image_evidence_type, 'SOURCE_LISTING_IMAGE');
    assert.equal(record.multi_listing, false);
    assert.equal(record.is_unbundled_child, false);
  }
});

test('missing dealer reputation stays unknown and bundle children never inherit parent media', () => {
  const target = CONTROLLED_REFERENCES[0];
  const unrated = mapReviewedRecord(reviewedRow(target, {
    dealer_rating: null,
    review_count: null,
  }));
  assert.equal(unrated.seller_rating, null);
  assert.equal(unrated.seller_review_count, 0);
  assert.equal(unrated.seller_rating_evidence_status, 'UNAVAILABLE');

  const child = mapReviewedRecord(reviewedRow(target, {
    parent_id: 'bundle-parent',
    user_image_url: 'https://images.example/shared-bundle.jpg',
  }));
  assert.equal(child.is_unbundled_child, true);
  assert.equal(child.has_images, false);
  assert.equal(child.thumbnail_url, null);
  assert.deepEqual(child.image_urls, []);
});

test('Trading Floor bounded-page presentation order is image first, then verified price and recency', () => {
  const target = CONTROLLED_REFERENCES[0];
  const records = [
    mapReviewedRecord(reviewedRow(target, {
      suffix: 'no_image_no_price',
      has_exact_source_image: false,
      user_image_url: null,
      source_price_amount: null,
      has_verified_usd_price: false,
      verified_price_usd: null,
      posting_date: '2026-08-13T04:00:00Z',
    })),
    mapReviewedRecord(reviewedRow(target, {
      suffix: 'image_no_price',
      source_price_amount: null,
      has_verified_usd_price: false,
      verified_price_usd: null,
      posting_date: '2026-08-13T03:00:00Z',
    })),
    mapReviewedRecord(reviewedRow(target, {
      suffix: 'no_image_price',
      has_exact_source_image: false,
      user_image_url: null,
      posting_date: '2026-08-13T02:00:00Z',
    })),
    mapReviewedRecord(reviewedRow(target, {
      suffix: 'image_price',
      posting_date: '2026-08-13T01:00:00Z',
    })),
  ].sort(compareInventoryForDisplay);

  assert.deepEqual(records.map(record => [record.has_images, Boolean(record.source_price_amount)]), [
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ]);

  const floor = read('src/pages/TradingFloor.tsx');
  assert.doesNotMatch(floor, /function compareListingsForDisplay/,
    'the browser must preserve the bounded server page instead of claiming a global client order');
  assert.match(floor, /const visibleListings = listings/);
  assert.match(floor, /const nextListings = data\.records \|\| \[\]/);
});

test('Price Research admits priced WTS only, removes same-seller reposts, and applies 3.0x IQR', () => {
  const target = CONTROLLED_REFERENCES[1];
  const catalog = { found: true, model: target.model, dialColors: [target.dial] };
  const base = {
    id: 'sale-1',
    brand: target.brand,
    reference: target.reference,
    model: target.model,
    dial_color: target.dial,
    condition: 'Used',
    listing_type: 'WTS',
    price_usd: 100_000,
    analytics_currency_status: 'VERIFIED',
    dealer_id: 'dealer-1',
    raw_message: 'WTS Patek 5712/1A-001 Blue USD 100000',
  };
  assert.equal(classifyResearchEligibility(base, catalog), null);
  assert.equal(classifyResearchEligibility({ ...base, id: 'demand', listing_type: 'WTB' }, catalog), 'NOT_WTS_SALE');
  assert.equal(classifyResearchEligibility({ ...base, id: 'unpriced', price_usd: null }, catalog), 'MISSING_PRICE');
  assert.equal(classifyResearchEligibility({ ...base, id: 'bundle', bundle_candidate_count: 2 }, catalog), 'BUNDLE_SOURCE_UNSPLIT');
  assert.equal(classifyResearchEligibility({ ...base, id: 'suppressed', listing_status: 'SUPPRESSED_EXACT_DUPLICATE' }, catalog), null);
  assert.equal(isApprovedInventoryRecord({
    ...base,
    verdict: 'APPROVED',
    confidence: 95,
    listing_status: 'SUPPRESSED_EXACT_DUPLICATE',
  }), false);

  const { uniqueRows, repostRows } = deduplicateReposts([
    base,
    { ...base, id: 'sale-1-repost', created_at: '2026-08-12T00:00:00Z' },
    { ...base, id: 'sale-2', dealer_id: 'dealer-2' },
  ]);
  assert.equal(uniqueRows.length, 2);
  assert.equal(repostRows.length, 1);

  const summary = summarizePrices([95_000, 100_000, 101_000, 105_000, 1_000_000]);
  assert.equal(summary.stats.iqr_multiplier, 3);
  assert.equal(summary.outliers.includes(1_000_000), true);
});

test('Price Research response and UI retain liquidity, demand ratio, outliers, dial chart, and outlook contracts', () => {
  const api = read('api/price-research.js');
  const ui = read('src/pages/PriceResearch.tsx');

  assert.match(api, /wtb_demand_count: wtbDemandCount/);
  assert.match(api, /method: 'PLAUSIBILITY_FLOOR_THEN_IQR_3_0'/);
  assert.match(api, /iqr_multiplier: 3\.0/);
  assert.match(api, /dial_analysis,/);
  assert.match(api, /dial_trends,/);
  assert.match(api, /liquidity,/);
  assert.match(api, /monthly, prices, forecast/);
  assert.match(api, /raw_message: r\.raw_message \|\| null/);
  assert.match(api, /seller_name: r\.seller_name \|\| null/);
  assert.match(api, /seller_phone: consentApprovedPhone\(r\)/);
  assert.match(api, /loadAnalyticsSuppressedIds/);

  assert.match(ui, /WTB \/ WTS ratio/);
  assert.match(ui, /Statistical outliers/);
  assert.match(ui, /Dial Price History &amp; 3-Month Outlook/);
  assert.match(ui, /<ComposedChart data=\{displayDialAnalysis\}/);
  assert.match(ui, /data\.dial_trends\.map\(trend => <Line/);
  assert.doesNotMatch(ui, />No image</);
});

test('public dealer workflows keep third-party URLs private and render extracted evidence internally', () => {
  for (const payload of [
    sourceProfilePayload('watchfacts-source-3435'),
    ratedProfilePayload('watchfacts-source-916'),
    legacyProfilePayload('watchfacts-legacy-1295'),
  ]) {
    assert.equal(payload?.success, true);
    assert.equal(payload?.source_links, undefined);
    assert.equal(payload?.dealer?.source_url, undefined);
    assert.equal(payload?.source_provenance?.source_url, undefined);
    assert.doesNotMatch(JSON.stringify(payload), /https:\/\/(?:www\.)?watchfacts\.com\//i);
  }

  const sourcePayload = sourceProfilePayload('watchfacts-source-3435');
  assert.ok(sourcePayload.listings.length > 0);
  assert.ok(sourcePayload.listings.some(row => row.raw_message));
  assert.ok(sourcePayload.reviews.length > 0);

  const legacyPayload = legacyProfilePayload('watchfacts-legacy-1295');
  assert.ok(legacyPayload.listings.length > 0);
  assert.equal(legacyPayload.stats.captured_inventory_count, legacyPayload.listings.length);
  assert.ok(legacyPayload.listings.some(row => row.reference || row.brand || row.raw_message));

  const directoryUi = read('src/pages/DealerDirectory.tsx');
  const profileUi = read('src/pages/DealerProfile.tsx');
  assert.doesNotMatch(directoryUi, /Source profile/);
  assert.doesNotMatch(profileUi, /Open source listing|All source listings|Source WTS|Source WTB|Contact through public source/);
});

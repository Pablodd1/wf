'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  catalogIdentityIssue,
  deriveItemCategory,
  isCustomerIdentitySafe,
  isLikelyYearAsPrice,
  isPriceLike,
  isReferencePriceCollision,
  sanitizeTradingRecord,
} = require('../api/_lib/trading-record-safety.cjs');

test('derives luxury category only from source-backed record evidence', () => {
  assert.equal(deriveItemCategory({ listing_type: 'WTS', source_type: 'jewelry_archive' }), 'JEWELRY');
  assert.equal(deriveItemCategory({ listing_type: 'OTHER', source_type: 'jewelry_archive' }), 'JEWELRY');
  assert.equal(deriveItemCategory({ listing_type: 'OTHER', source_type: 'handbag_archive' }), 'HANDBAG');
  assert.equal(deriveItemCategory({ listing_type: 'OTHER', source_type: 'accessory_archive' }), 'ACCESSORY');
  assert.equal(deriveItemCategory({ listing_type: 'OTHER', source_type: 'unknown_archive' }), 'OTHER');
});

test('recognizes numeric and currency amounts as price-like values', () => {
  assert.equal(isPriceLike('9000.00'), true);
  assert.equal(isPriceLike('HKD 250K'), true);
  assert.equal(isPriceLike('$1,250,000'), true);
  assert.equal(isPriceLike('Ice Blue'), false);
  assert.equal(isPriceLike('.'), false);
});

test('withholds contaminated customer fields without dropping the listing', () => {
  const result = sanitizeTradingRecord({
    id: 'listing-1',
    brand: 'Rolex',
    reference: 'Rolex',
    dial_color: '9000.00',
    condition: 'Used',
    year: 2024,
    price_usd: 16610,
  });

  assert.equal(result.id, 'listing-1');
  assert.equal(result.reference, null);
  assert.equal(result.dial_color, null);
  assert.equal(result.condition, 'Used');
  assert.equal(result.price_usd, 16610);
  assert.equal(result.data_quality_review_required, true);
  assert.deepEqual(result.data_quality_issues, ['REFERENCE_EQUALS_BRAND', 'DIAL_PRICE_CONTAMINATION']);
});

test('keeps plausible normalized watch data unchanged', () => {
  const result = sanitizeTradingRecord({
    brand: 'Patek Philippe',
    reference: '5712/1A',
    dial_color: 'Blue',
    condition: 'Used',
    year: 2022,
    price_usd: 118000,
  });

  assert.equal(result.reference, '5712/1A');
  assert.equal(result.dial_color, 'Blue');
  assert.equal(result.data_quality_review_required, false);
  assert.deepEqual(result.data_quality_issues, []);
});

test('preserves a numeric watch reference', () => {
  const result = sanitizeTradingRecord({
    brand: 'Rolex',
    reference: '126334',
    dial_color: 'Blue',
    condition: 'New',
    price_raw: 14200,
    price_usd: 14200,
  });

  assert.equal(result.reference, '126334');
  assert.equal(result.price_usd, 14200);
  assert.deepEqual(result.data_quality_issues, []);
});

test('withholds a price copied from a numeric reference without erasing the reference', () => {
  const record = {
    brand: 'Rolex',
    reference: '16610',
    price_raw: 16610,
    price_usd: 16610,
    currency: 'USD',
  };
  const result = sanitizeTradingRecord(record);

  assert.equal(isReferencePriceCollision(record), true);
  assert.equal(result.reference, '16610');
  assert.equal(result.price_raw, null);
  assert.equal(result.price_usd, null);
  assert.deepEqual(result.data_quality_issues, ['REFERENCE_TOKEN_AS_PRICE']);
});

test('does not confuse an alphanumeric reference numeric core with a price', () => {
  assert.equal(isReferencePriceCollision({ reference: '116500LN', price_usd: 116500 }), false);
});

test('does not quarantine an explicit converted price when raw and USD values differ', () => {
  assert.equal(isReferencePriceCollision({ reference: '16610', price_raw: 16610, price_usd: 2129 }), false);
});

test('withholds punctuation-only fields and a deterministic year-as-price artifact', () => {
  const punctuation = sanitizeTradingRecord({ brand: 'Patek Philippe', reference: '.', dial_color: '.', condition: '-', price_usd: null });
  assert.equal(punctuation.reference, null);
  assert.equal(punctuation.dial_color, null);
  assert.equal(punctuation.condition, null);
  assert.deepEqual(punctuation.data_quality_issues, ['REFERENCE_PUNCTUATION_ONLY', 'DIAL_PUNCTUATION_ONLY', 'CONDITION_PUNCTUATION_ONLY']);

  const record = { brand: 'Rolex', reference: null, price_raw: null, price_usd: 2023, year: null, condition: null };
  assert.equal(isLikelyYearAsPrice(record), true);
  const result = sanitizeTradingRecord(record);
  assert.equal(result.price_usd, null);
  assert.deepEqual(result.data_quality_issues, ['YEAR_TOKEN_AS_PRICE']);
});

test('withholds a year-like stored price even when the listing identity is complete', () => {
  const result = sanitizeTradingRecord({
    brand: 'Patek Philippe', reference: '7118/1200A', price_raw: 2025, price_usd: 2025,
    year: 2025, condition: 'Unknown',
  });
  assert.equal(result.price_raw, null);
  assert.equal(result.price_usd, null);
  assert.deepEqual(result.data_quality_issues, ['YEAR_TOKEN_AS_PRICE']);
});

test('withholds sub-thousand reference prices from the customer Trading Floor', () => {
  const result = sanitizeTradingRecord({
    brand: 'Rolex', reference: '11375', price_raw: 143, price_usd: 132, currency: 'EUR',
  });
  assert.equal(result.price_raw, null);
  assert.equal(result.price_usd, null);
  assert.deepEqual(result.data_quality_issues, ['PRICE_BELOW_PLAUSIBILITY_FLOOR']);
});

test('quarantines cross-brand catalog contradictions', () => {
  const conflict = { brand: 'Audemars Piguet', reference: 'RM 17-01', dial_color: 'Skeleton' };
  assert.equal(catalogIdentityIssue(conflict), 'CATALOG_BRAND_CONFLICT');
  assert.equal(isCustomerIdentitySafe(conflict), false);
  assert.equal(isCustomerIdentitySafe({ brand: 'Richard Mille', reference: 'RM 17-01', dial_color: 'Skeleton' }), true);
});

test('suppresses listing images until visual identity is durably verified', () => {
  const result = sanitizeTradingRecord({
    brand: 'Patek Philippe',
    reference: '5712/1A',
    dial_color: 'Blue',
    has_images: true,
    thumbnail_url: 'https://example.com/wrong-watch.jpg',
    image_urls: ['https://example.com/wrong-watch.jpg'],
  });
  assert.equal(result.has_images, false);
  assert.equal(result.thumbnail_url, null);
  assert.deepEqual(result.image_urls, []);
  assert.match(result.data_quality_issues.join(','), /IMAGE_VISUAL_VERIFICATION_REQUIRED/);
});

test('preserves only image media explicitly loaded through the verified publication view', () => {
  const result = sanitizeTradingRecord({
    brand: 'Rolex',
    reference: '126610LN',
    dial_color: 'Black',
    has_images: true,
    thumbnail_url: 'https://cdn.example.com/verified.jpg',
    image_urls: ['https://cdn.example.com/verified.jpg'],
  }, { verifiedImages: true });

  assert.equal(result.has_images, true);
  assert.equal(result.thumbnail_url, 'https://cdn.example.com/verified.jpg');
  assert.deepEqual(result.image_urls, ['https://cdn.example.com/verified.jpg']);
  assert.doesNotMatch(result.data_quality_issues.join(','), /IMAGE_VISUAL_VERIFICATION_REQUIRED/);
});

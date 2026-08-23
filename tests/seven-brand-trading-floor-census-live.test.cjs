'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  hasDealerRating,
  hasImage,
  publicDuplicateSignature,
  referenceKey,
  summarizeRows,
} = require('../tools/audit/seven-brand-trading-floor-census-live.cjs');

test('normalizes brand/reference keys without expanding partial references', () => {
  assert.equal(referenceKey('Patek Philippe', '5724R-001'), 'PATEK PHILIPPE|5724R001');
  assert.notEqual(referenceKey('Patek Philippe', '5724R'), referenceKey('Patek Philippe', '5724R-001'));
});

test('recognizes only public card image and rating evidence', () => {
  assert.equal(hasImage({ image_urls: ['', 'https://example.test/exact.jpg'] }), true);
  assert.equal(hasImage({ thumbnail_url: '' }), false);
  assert.equal(hasDealerRating({ dealer_rating: 4.8 }), true);
  assert.equal(hasDealerRating({ seller_rating_evidence_status: 'SOURCE_FEEDBACK_COUNT' }), true);
  assert.equal(hasDealerRating({ seller_rating_evidence_status: 'RATING_UNAVAILABLE' }), false);
});

test('summarizes missing fields, catalog parity and duplicate candidates without raw messages', () => {
  const rows = [
    {
      id: 'listing-1', brand: 'Rolex', reference: '126000', listing_type: 'WTS',
      price_usd: 7_100, source_price_currency: 'USD', thumbnail_url: 'https://example.test/a.jpg',
      seller_name: 'Dealer A', dealer_rating: 4.5, source_record_id: 'source-1', raw_message: 'private evidence',
    },
    {
      id: 'listing-2', brand: 'Rolex', reference: '126000', listing_type: 'WTS',
      price_usd: 7_100, source_price_currency: 'USD', thumbnail_url: 'https://example.test/a.jpg',
      seller_name: 'Dealer A', dealer_rating: 4.5, source_record_id: 'source-1', raw_message: 'private evidence',
    },
    { id: 'listing-3', brand: 'Rolex', reference: '124060', listing_type: 'WTS' },
  ];
  const summary = summarizeRows('Rolex', rows, new Set(['ROLEX|126000', 'ROLEX|124060', 'ROLEX|116500LN']));

  assert.equal(summary.released_listings, 3);
  assert.equal(summary.unique_references, 2);
  assert.equal(summary.catalog_references_without_released_listing, 1);
  assert.equal(summary.missing_price, 1);
  assert.equal(summary.missing_image, 1);
  assert.equal(summary.missing_dealer_or_seller, 1);
  assert.equal(summary.missing_dealer_rating, 1);
  assert.equal(summary.repeated_source_id_groups.length, 1);
  assert.equal(summary.repeated_public_signature_groups.length, 1);
  assert.equal(JSON.stringify(summary).includes('private evidence'), false);
});

test('duplicate signature changes when exact source identity changes', () => {
  const base = { brand: 'Omega', reference: '310.30', listing_type: 'WTS', price_usd: 6_200 };
  assert.notEqual(
    publicDuplicateSignature({ ...base, source_record_id: 'one' }),
    publicDuplicateSignature({ ...base, source_record_id: 'two' }),
  );
});

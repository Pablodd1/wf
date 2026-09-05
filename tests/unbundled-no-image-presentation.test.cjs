'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const inventoryApi = require('../api/reviewed-market-inventory.js');
const researchApi = require('../api/price-research.js');
const batchApi = require('../api/price-research-batch-summary.js');
const floorSource = fs.readFileSync(path.join(root, 'src', 'pages', 'TradingFloor.tsx'), 'utf8');
const researchSource = fs.readFileSync(path.join(root, 'src', 'pages', 'PriceResearch.tsx'), 'utf8');

function image(id, intent) {
  return {
    id, listing_type: intent, has_images: true,
    thumbnail_url: `https://images.example/${id}.jpg`,
    image_urls: [`https://images.example/${id}.jpg`],
    image_evidence_type: 'SOURCE_LISTING_IMAGE',
  };
}

test('Trading Floor ranks image-backed first, then WTS before WTB in each media lane', () => {
  const records = [
    { id: 'no-image-wtb', listing_type: 'WTB', has_images: false },
    { id: 'no-image-wts', listing_type: 'WTS', has_images: false },
    image('image-wtb', 'WTB'),
    image('image-wts', 'WTS'),
  ];
  assert.deepEqual(records.sort(inventoryApi.compareInventoryForDisplay).map(row => row.id), [
    'image-wts', 'image-wtb', 'no-image-wts', 'no-image-wtb',
  ]);
});

test('unbundled children cannot provide representative images but exact source listings can', () => {
  assert.equal(batchApi.exactRepresentativeImage({
    ...image('child', 'WTS'), is_unbundled_child: true,
  }), null);
  assert.equal(batchApi.exactRepresentativeImage({
    ...image('bundle', 'WTS'), multi_listing: true,
  }), null);
  assert.equal(batchApi.exactRepresentativeImage({
    ...image('reference', 'WTS'), image_evidence_type: 'REFERENCE_IMAGE',
  }), null);
  assert.equal(batchApi.exactRepresentativeImage(image('exact', 'WTS')), 'https://images.example/exact.jpg');
});

test('Price Research customer sale evidence requires a positive normalized USD price', () => {
  assert.equal(researchApi.isCustomerPricedSaleEvidence({ price_usd: null }), false);
  assert.equal(researchApi.isCustomerPricedSaleEvidence({ price_usd: 0 }), false);
  assert.equal(researchApi.isCustomerPricedSaleEvidence({ price_usd: 'not-a-price' }), false);
  assert.equal(researchApi.isCustomerPricedSaleEvidence({
    listing_type: 'WTS', brand: 'Rolex', reference: '126500LN', dial_color: 'White',
    price_usd: 12_500, source_currency: 'USD', analytics_currency_status: 'VERIFIED',
  }), true);
});

test('both pages retain compact/raw evidence behavior without fake image frames', () => {
  assert.match(floorSource, /listing\.is_unbundled_child === true\) return null/);
  assert.match(floorSource, /cardHasImage \? 'min-h-\[620px\]' : 'min-h-\[320px\]'/);
  assert.match(floorSource, /\{cardHasImage && \(/);
  assert.match(floorSource, /Original raw message/);
  assert.match(floorSource, /Price rating: \{cardPriceRatingLabel\}/);
  assert.match(floorSource, /Dealer:/);
  assert.match(researchSource, /function exactSourceImageUrl/);
  assert.match(researchSource, /record\.is_unbundled_child === true/);
  assert.match(researchSource, /\.filter\(row => Number\.isFinite\(Number\(row\.price_usd\)\)/);
  assert.match(researchSource, /Unpriced WTS stays on the Trading Floor/);
  assert.doesNotMatch(researchSource, /No image|Source listing image unavailable/);
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const shadow = require('../api/_lib/curated-luxury-shadow.cjs');

test('production selectors are isolated to Rolex and Patek', () => {
  assert.equal(shadow.MARKET_SELECTOR, 'curated_luxury_current_shadow_v1');
  assert.equal(shadow.PRICE_SELECTOR, 'curated_luxury_price_research_shadow_v1');
  assert.equal(shadow.isShadowBrand('Rolex'), true);
  assert.equal(shadow.isShadowBrand('Patek Philippe'), true);
  assert.equal(shadow.isShadowBrand('Tudor'), false);
});

test('card projection preserves availability, original currency, and evidence gates', () => {
  const card = shadow.mapCard({
    id: 'listing-1', brand: 'Rolex', reference: '116500LN', listing_type: 'WTS',
    source_price_amount: 100000, source_currency: 'HKD', price_usd: 12820,
    price_verified: true, created_at: '2026-08-01T00:00:00Z',
    current_status: 'CURRENT_LATEST_STATE', cohort_status: 'LATEST_OBSERVED',
    raw_message: 'source evidence', raw_media: [{ url: 'https://example.test/watch.jpg' }],
    has_images: true, country_code: 'HK', dealer_name: null, dealer_rating: null,
  });
  assert.equal(card.price_raw, 100000);
  assert.equal(card.currency, 'HKD');
  assert.equal(card.price_usd, 12820);
  assert.equal(card.price_evidence_status, 'DATED_VERIFIED_FX');
  assert.equal(card.current_status, 'CURRENT_LATEST_STATE');
  assert.equal(card.cohort_status, 'LATEST_OBSERVED');
  assert.equal(card.seller_name, null);
  assert.equal(card.seller_rating, null);
  assert.deepEqual(card.image_urls, ['https://example.test/watch.jpg']);
});

test('projection migration is read-only over raw/source tables and COMPLETE gated', () => {
  const sql = fs.readFileSync(path.join(root,
    'supabase/migrations/20260826163000_curated_luxury_shadow_customer_projection.sql'), 'utf8');
  assert.match(sql, /status\s*=\s*'COMPLETE'/i);
  assert.match(sql, /curated_luxury_current_listings_shadow/i);
  assert.match(sql, /curated_luxury_offer_states_shadow/i);
  assert.match(sql, /raw_message_versions/i);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO\s+|FROM\s+)?(?:public\.)?(?:raw_messages|raw_message_versions|staging\.listings)/i);
  assert.match(sql, /REVOKE ALL[\s\S]*GRANT EXECUTE[\s\S]*service_role/i);
});

test('customer APIs opt in only through the new selectors', () => {
  const market = fs.readFileSync(path.join(root, 'api/reviewed-market-inventory.js'), 'utf8');
  const price = fs.readFileSync(path.join(root, 'api/price-research.js'), 'utf8');
  assert.match(market, /CURATED_SHADOW_MARKET_SOURCE/);
  assert.match(market, /loadCuratedShadowInventory/);
  assert.match(price, /CURATED_SHADOW_PRICE_SOURCE/);
  assert.match(price, /loadCuratedShadowPriceResearch/);
});

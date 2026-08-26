'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const shadow = require('../api/_lib/curated-luxury-shadow.cjs');
const inventoryApi = require('../api/reviewed-market-inventory.js');

test('production selectors are isolated to Rolex and Patek', () => {
  assert.equal(shadow.MARKET_SELECTOR, 'curated_luxury_current_shadow_v1');
  assert.equal(shadow.PRICE_SELECTOR, 'curated_luxury_price_research_shadow_v1');
  assert.equal(shadow.isShadowBrand('Rolex'), true);
  assert.equal(shadow.isShadowBrand('Patek Philippe'), true);
  assert.equal(shadow.isShadowBrand('Tudor'), false);
  assert.deepEqual(shadow.countryCodes(['USA', 'HKG']), ['USA', 'HKG']);
  assert.deepEqual(shadow.countryCodes('__NO_MATCH__'), ['__NO_MATCH__']);
});

test('card projection preserves availability, original currency, and evidence gates', () => {
  const card = shadow.mapCard({
    id: 'listing-1', brand: 'Rolex', reference: '116500LN', listing_type: 'WTS',
    source_price_amount: 100000, source_currency: 'HKD', price_usd: 12820,
    price_verified: true, created_at: '2026-08-01T00:00:00Z',
    current_status: 'CURRENT_LATEST_STATE', cohort_status: 'LATEST_OBSERVED',
    raw_message: 'source evidence', raw_media: [{ url: 'https://unsafe-parent.test/watch.jpg' }],
    verified_child_media: ['https://example.test/watch.jpg'],
    image_state: 'VERIFIED_CHILD_IMAGE', has_images: true,
    country_code: 'HK', dealer_name: null, dealer_rating: null,
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
  assert.equal(card.image_state, 'VERIFIED_CHILD_IMAGE');
});

test('card projection never inherits raw parent media and fails closed without a bridge URL', () => {
  const card = shadow.mapCard({
    id: 'listing-2', brand: 'Patek Philippe', reference: '5712/1A', listing_type: 'WTS',
    raw_media: [{ url: 'https://unsafe-parent.test/bundle.jpg', verified_for_child_listing: false }],
    verified_child_media: [], image_state: 'NO_VERIFIED_CHILD_IMAGE', has_images: false,
  });
  assert.equal(card.has_images, false);
  assert.equal(card.thumbnail_url, null);
  assert.deepEqual(card.image_urls, []);
  assert.equal(card.image_state, 'NO_VERIFIED_CHILD_IMAGE');
  assert.equal(card.image_evidence_type, 'NO_VERIFIED_CHILD_IMAGE');
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

test('child image bridge is exact-hash, immutable to customers, and used after key selection', () => {
  const sql = fs.readFileSync(path.join(root,
    'supabase/migrations/20260826220000_curated_luxury_child_image_evidence_bridge.sql'), 'utf8');
  assert.match(sql, /source_image_key\s*=\s*encode\(extensions\.digest\(convert_to\(source_url,'UTF8'\),'sha256'\),'hex'\)/i);
  assert.match(sql, /raw_occurrence_key=c\.latest_raw_occurrence_key/i);
  assert.match(sql, /'NO_VERIFIED_CHILD_IMAGE'/);
  assert.match(sql, /verified_child_media/);
  assert.match(sql, /GRANT SELECT,INSERT[\s\S]*service_role/i);
  assert.doesNotMatch(sql, /GRANT (?:ALL|UPDATE|DELETE)[^;]*child_image/i);
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE|TRUNCATE)\s+(?:public\.)?curated_luxury_current_listings_shadow/i);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO\s+|FROM\s+)?(?:public\.)?(?:raw_messages|raw_message_versions|staging\.listings)/i);
});

test('compatibility bridge requires exact one-to-one immutable identity and single-watch scope', () => {
  const sql = fs.readFileSync(path.join(root,
    'supabase/migrations/20260826223000_curated_luxury_image_compatibility_bridge.sql'), 'utf8');
  assert.match(sql, /source_payload_sha256\s*=\s*encode\(extensions\.digest\(convert_to\(i\.raw_message,'UTF8'\),'sha256'\),'hex'\)/i);
  assert.match(sql, /pc\.production_count=1\s+AND\s+sc\.shadow_count=1/i);
  assert.match(sql, /s\.exact_child_text_sha256=s\.parent_raw_text_sha256/i);
  assert.match(sql, /s\.raw_is_bundle='false'/i);
  assert.match(sql, /p\.raw_message=s\.immutable_raw_text/i);
  assert.match(sql, /upper\(coalesce\(i\.image_evidence_type,''\)\)\s*=\s*'SELLER_LISTING_IMAGE'/i);
  assert.doesNotMatch(sql, /image_evidence_type,''\)\)\s+NOT LIKE/i);
  assert.doesNotMatch(sql, /\b(?:reference|model|dealer|filename|similarity)\s*=/i);
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE|TRUNCATE)\s+(?:public\.)?curated_luxury_current_listings_shadow/i);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO\s+|FROM\s+)?(?:public\.)?(?:raw_messages|raw_message_versions|staging\.listings)/i);
});

test('image-only count reconciles distinct customer listings across multi-image links', () => {
  const sql = fs.readFileSync(path.join(root,
    'supabase/migrations/20260826220000_curated_luxury_child_image_evidence_bridge.sql'), 'utf8');
  assert.match(sql, /IF p_images_only THEN[\s\S]*count\(DISTINCT c\.current_listing_key\)/i);
});

test('compatibility images reject reference, catalog, and generic media without positive seller evidence', () => {
  const sql = fs.readFileSync(path.join(root,
    'supabase/migrations/20260826223000_curated_luxury_image_compatibility_bridge.sql'), 'utf8');
  assert.match(sql, /upper\(coalesce\(i\.image_evidence_type,''\)\)\s*=\s*'SELLER_LISTING_IMAGE'/i);
  assert.doesNotMatch(sql, /image_evidence_type,''\)\)\s+(?:NOT LIKE|NOT IN|<>|!=)/i);
});

test('customer APIs opt in only through the new selectors', () => {
  const market = fs.readFileSync(path.join(root, 'api/reviewed-market-inventory.js'), 'utf8');
  const price = fs.readFileSync(path.join(root, 'api/price-research.js'), 'utf8');
  assert.match(market, /CURATED_SHADOW_MARKET_SOURCE/);
  assert.match(market, /loadCuratedShadowInventory/);
  assert.match(price, /CURATED_SHADOW_PRICE_SOURCE/);
  assert.match(price, /loadCuratedShadowPriceResearch/);
});

test('shadow inventory uses bounded key/card RPCs, exact facets, and a scoped keyset cursor', async () => {
  const calls = [];
  const client = { rpc: async (name, args) => {
    calls.push({ name, args });
    if (name === 'curated_luxury_shadow_customer_count_v2') {
      return { data: { total: 1535763, exact: true, source: 'materialized_facets' }, error: null };
    }
    if (name === 'curated_luxury_shadow_customer_cards_v3') {
      return { data: [{ id: 'a'.repeat(64), brand: 'Rolex' }], error: null };
    }
    return { data: { keys: ['a'.repeat(64)], has_more: true,
      next_timestamp: '2026-08-01T00:00:00.000Z', next_key: 'b'.repeat(64),
      next_timestamp_is_null: false }, error: null };
  } };
  const options = { brand: 'Rolex', listingType: '', countries: [], pricedOnly: false,
    imagesOnly: false, search: null, reference: null, page: 1, pageSize: 24, cursor: null };
  const first = await shadow.loadInventory(client, options);
  assert.equal(first.total, 1535763);
  assert.equal(first.totalIsEstimate, false);
  assert.equal(first.hasMore, true);
  assert.deepEqual(calls.map(call => call.name), [
    'curated_luxury_shadow_customer_page_keys_v3', 'curated_luxury_shadow_customer_count_v2',
    'curated_luxury_shadow_customer_cards_v3',
  ]);
  assert.equal(Object.hasOwn(calls[0].args, 'p_offset'), false);

  const parsed = inventoryApi.parseInventoryCursor(first.nextCursor, 24);
  assert.equal(parsed.page, 2);
  assert.equal(parsed.shadowKeyset.currentListingKey, 'b'.repeat(64));
  calls.length = 0;
  const second = await shadow.loadInventory(client, { ...options, page: 2, cursor: parsed.shadowKeyset });
  assert.equal(second.total, null);
  assert.deepEqual(calls.map(call => call.name), [
    'curated_luxury_shadow_customer_page_keys_v3', 'curated_luxury_shadow_customer_cards_v3',
  ]);
  assert.equal(calls[0].args.p_after_key, 'b'.repeat(64));
});

test('performance migration selects keys before enrichment and contains no OFFSET hot path', () => {
  const sql = fs.readFileSync(path.join(root,
    'supabase/migrations/20260826180000_curated_luxury_shadow_read_performance.sql'), 'utf8');
  assert.match(sql, /\(run_id, brand, source_timestamp DESC NULLS LAST, current_listing_key DESC\)/);
  assert.match(sql, /curated_luxury_current_shadow_reference_feed_v2_idx/);
  assert.match(sql, /curated_luxury_current_shadow_intent_feed_v2_idx/);
  assert.match(sql, /curated_luxury_current_shadow_priced_feed_v2_idx/);
  assert.match(sql, /curated_luxury_current_shadow_images_feed_v2_idx/);
  assert.match(sql, /curated_luxury_current_facets_shadow/);
  assert.match(sql, /curated_luxury_dealer_lineage_shadow/);
  assert.match(sql, /WITH candidates AS MATERIALIZED[\s\S]*LIMIT[\s\S]*selected AS MATERIALIZED[\s\S]*parent_rows AS MATERIALIZED/);
  const keyV3 = sql.slice(sql.lastIndexOf('CREATE OR REPLACE FUNCTION public.curated_luxury_shadow_customer_page_keys_v3'),
    sql.indexOf('CREATE OR REPLACE FUNCTION public.curated_luxury_shadow_customer_cards_v3'));
  const cardsV3 = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.curated_luxury_shadow_customer_cards_v3'));
  assert.match(keyV3, /EXECUTE v_sql INTO v_result/);
  assert.doesNotMatch(keyV3, /\bOFFSET\b/i);
  assert.doesNotMatch(cardsV3, /digest\s*\(/i);
  assert.match(cardsV3, /LEFT JOIN LATERAL/);
  assert.doesNotMatch(keyV3, /regexp_replace\(upper\(c\.search_text/i);
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE|TRUNCATE)\s+(?:public\.)?curated_luxury_current_listings_shadow/i);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO\s+|FROM\s+)?(?:public\.)?(?:raw_messages|raw_message_versions)/i);
});

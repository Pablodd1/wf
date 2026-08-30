// tests/authoritative-evidence-normalizer.test.cjs
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAuthoritativeRow, resolveStrictIntentFromText } = require('../tools/mariadb-live/authoritative-evidence-normalizer.cjs');

test('1. Provenance: throws if any required provenance field is missing (no synthesis)', () => {
  assert.throws(() => {
    normalizeAuthoritativeRow({
      source_id: '1',
      source_hash: 'h'.repeat(64),
      source_system: 'OceanDigital MariaDB',
      source_database: 'thecollective_inventory',
      source_table: 'auctions'
      // missing source_record_id
    });
  }, /Missing required source_record_id/);

  assert.throws(() => {
    normalizeAuthoritativeRow({
      source_id: '1',
      source_hash: 'h'.repeat(64),
      source_system: 'Benchmark Test',
      source_database: 'thecollective_inventory',
      source_table: 'auctions',
      source_record_id: 'mysql_auctions_1'
    });
  }, /Benchmark namespace violation/);
});

test('2. Missing raw_message: routes to review and holds from publication', () => {
  const norm = normalizeAuthoritativeRow({
    source_id: 'missing-msg-1',
    source_hash: 'h'.repeat(64),
    source_system: 'OceanDigital MariaDB',
    source_database: 'thecollective_inventory',
    source_table: 'auctions',
    source_record_id: 'mysql_auctions_1',
    raw_message: null
  });
  assert.equal(norm.trading_floor_eligible, false);
  assert.equal(norm.price_research_eligible, false);
  assert.ok(norm.review_flags.includes('MISSING_RAW_MESSAGE'));
  assert.equal(norm.reconciliation_category, 'REVIEW_REQUIRED');
});

test('3. Zero fallbacks to raw_payload metadata for price, currency, year, condition, intent', () => {
  const row = {
    source_id: 'no-fallbacks',
    source_hash: 'h'.repeat(64),
    source_system: 'OceanDigital MariaDB',
    source_database: 'thecollective_inventory',
    source_table: 'auctions',
    source_record_id: 'mysql_auctions_no_fallbacks',
    source_created_on: '2026-01-01T00:00:00.000Z',
    raw_message: 'Rolex Daytona 116500LN', // no price, no currency, no year, no condition, no intent keywords
    raw_payload: {
      type: 'sale',
      price: '28000',
      currency: 'USD',
      year: '2021',
      condition: 'Mint'
    }
  };

  const norm = normalizeAuthoritativeRow(row);
  assert.equal(norm.intent, null, 'Must not fallback to raw_payload.type');
  assert.equal(norm.original_price_amount, null, 'Must not fallback to raw_payload.price');
  assert.equal(norm.original_price_currency, null, 'Must not fallback to raw_payload.currency');
  assert.equal(norm.price_usd, null);
  assert.equal(norm.currency_status, 'MISSING_PRICE');
  assert.equal(norm.year, null, 'Must not fallback to raw_payload.year');
  assert.equal(norm.condition, null, 'Must not fallback to raw_payload.condition');
  assert.equal(norm.price_research_eligible, false);
});

test('4. DigitalOcean image URL rule: unreachable URL returns image_url=null and IMAGE_KEY_PRESERVED_URL_UNVERIFIED', () => {
  const row = {
    source_id: 'img-1',
    source_hash: 'h'.repeat(64),
    source_system: 'OceanDigital MariaDB',
    source_database: 'thecollective_inventory',
    source_table: 'auctions',
    source_record_id: 'mysql_auctions_img_1',
    raw_message: 'FS: Rolex Submariner 126610LN 14000 USD',
    raw_payload: {
      front_image: '677ec3e161c64_front_image.jpg'
    }
  };

  const norm = normalizeAuthoritativeRow(row);
  assert.equal(norm.image_key, '677ec3e161c64_front_image.jpg');
  assert.equal(norm.image_url, null, 'Must return null until reachability is verified');
  assert.equal(norm.image_evidence_type, 'IMAGE_KEY_PRESERVED_URL_UNVERIFIED');
  assert.notEqual(norm.image_evidence_type, 'SOURCE_LISTING_IMAGE');
});

test('5. Unknown intent handling: held from publication and price research', () => {
  const row = {
    source_id: 'unk-intent',
    source_hash: 'h'.repeat(64),
    source_system: 'OceanDigital MariaDB',
    source_database: 'thecollective_inventory',
    source_table: 'auctions',
    source_record_id: 'mysql_auctions_unk',
    raw_message: 'Rolex Submariner 126610LN 14000 USD', // no FS, WTS, WTB cues
    raw_payload: {}
  };

  const norm = normalizeAuthoritativeRow(row);
  assert.equal(norm.intent, null);
  assert.equal(norm.trading_floor_eligible, false, 'Unknown intent must be held from trading floor publication');
  assert.equal(norm.price_research_eligible, false);
  assert.ok(norm.review_flags.includes('UNKNOWN_INTENT'));
  assert.equal(norm.reconciliation_category, 'REVIEW_REQUIRED');
});

test('6. Explicit WTS, USD, USDT, HKD parsing from raw_message', () => {
  const wtsUsd = normalizeAuthoritativeRow({
    source_id: 'wts-usd',
    source_hash: 'h'.repeat(64),
    source_system: 'OceanDigital MariaDB',
    source_database: 'thecollective_inventory',
    source_table: 'auctions',
    source_record_id: 'mysql_auctions_wts_usd',
    raw_message: 'WTS: Rolex 126610LN 14000 USD'
  });
  assert.equal(wtsUsd.intent, 'WTS');
  assert.equal(wtsUsd.original_price_currency, 'USD');
  assert.equal(wtsUsd.price_usd, 14000);
  assert.equal(wtsUsd.currency_status, 'VERIFIED_EXPLICIT_USD');
  assert.equal(wtsUsd.trading_floor_eligible, true);
  assert.equal(wtsUsd.price_research_eligible, true);

  const wtsUsdt = normalizeAuthoritativeRow({
    source_id: 'wts-usdt',
    source_hash: 'h'.repeat(64),
    source_system: 'OceanDigital MariaDB',
    source_database: 'thecollective_inventory',
    source_table: 'auctions',
    source_record_id: 'mysql_auctions_wts_usdt',
    raw_message: 'For sale Rolex 126610LN 14,000 USDT'
  });
  assert.equal(wtsUsdt.intent, 'WTS');
  assert.equal(wtsUsdt.original_price_currency, 'USDT');
  assert.equal(wtsUsdt.price_usd, null, 'USDT must not receive USD parity');
  assert.equal(wtsUsdt.currency_status, 'VERIFIED_EXPLICIT_USDT_HELD_FOR_FX');
  assert.equal(wtsUsdt.price_research_eligible, false);
});

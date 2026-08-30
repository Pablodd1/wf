'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeStagedRow,
  parsePriceAndCurrency,
  parseIntent,
  parseBundleAndLineage
} = require('../tools/mariadb-live/run-normalization-canary-10k.cjs');

test('1. explicit null for missing/ambiguous price and no USD assumption for bare $', () => {
  // Bare $ test
  const bareDollar = parsePriceAndCurrency({ price: '15000', currency: '$' });
  assert.equal(bareDollar.price_amount, null);
  assert.equal(bareDollar.price_currency, null);
  assert.equal(bareDollar.currency_status, 'AMBIGUOUS_BARE_DOLLAR_HELD');

  // Missing price test
  const missingPrice = parsePriceAndCurrency({ price: '0', currency: 'USD' });
  assert.equal(missingPrice.price_amount, null);
  assert.equal(missingPrice.price_currency, null);
  assert.equal(missingPrice.currency_status, 'MISSING_PRICE');

  // Explicit USD test
  const explicitUsd = parsePriceAndCurrency({ price: '14500', currency: 'USD' });
  assert.equal(explicitUsd.price_amount, 14500);
  assert.equal(explicitUsd.price_currency, 'USD');
  assert.equal(explicitUsd.currency_status, 'VERIFIED_EXPLICIT_USD');

  // Explicit HKD test
  const explicitHkd = parsePriceAndCurrency({ price: '970000', currency: 'HKD' });
  assert.equal(explicitHkd.price_amount, 970000);
  assert.equal(explicitHkd.price_currency, 'HKD');
  assert.equal(explicitHkd.currency_status, 'VERIFIED_EXPLICIT_HKD');
});

test('2. WTS and WTB intent separation', () => {
  const wtbRow = { type: 'buy', title: 'Looking for Rolex Daytona 116500' };
  assert.equal(parseIntent(wtbRow), 'WTB');

  const wtsRow = { type: 'sale', title: 'For Sale: Patek Philippe 5711' };
  assert.equal(parseIntent(wtsRow), 'WTS');
});

test('3. bundles held out of publication', () => {
  const bundleRow = {
    is_bundle: 1,
    title: 'PP Multi-Piece Set',
    description: '7118/1R white\n5968A used\n5712R used'
  };
  const bundleInfo = parseBundleAndLineage(bundleRow);
  assert.equal(bundleInfo.is_bundle, true);
  assert.equal(bundleInfo.bundle_status, 'BUNDLE_PARENT_LINEAGE_HELD');
  assert.equal(bundleInfo.publication_eligibility, 'HELD_BUNDLE_REVIEW');
});

test('4. single listing retains contact, image, and raw evidence with exact reconciliation', () => {
  const stagedRow = {
    source_id: 'test-row-001',
    source_hash: 'a'.repeat(64),
    source_created_on: '2025-11-19T02:00:00.000Z',
    source_record_id: 'mysql_auctions_test-row-001',
    source_system: 'OceanDigital MariaDB',
    source_database: 'thecollective_inventory',
    source_table: 'auctions',
    captured_at: '2026-08-30T00:00:00.000Z',
    raw_payload: {
      brand: 'Audemars Piguet',
      model: 'Royal Oak',
      reference: '15500ST',
      price: '38000',
      currency: 'USD',
      type: 'sale',
      front_image: 'ap_15500_front.jpg',
      from_name: 'Geneva Dealer',
      from_number: '41791234567',
      phone_code: 41,
      dealer_rating: 5,
      is_bundle: 0
    }
  };

  const norm = normalizeStagedRow(stagedRow);
  assert.equal(norm.brand, 'Audemars Piguet');
  assert.equal(norm.model, 'Royal Oak');
  assert.equal(norm.reference, '15500ST');
  assert.equal(norm.intent, 'WTS');
  assert.equal(norm.price_amount, 38000);
  assert.equal(norm.price_currency, 'USD');
  assert.equal(norm.image_key, 'ap_15500_front.jpg');
  assert.equal(norm.contact_evidence.from_name, 'Geneva Dealer');
  assert.equal(norm.contact_evidence.from_number, '41791234567');
  assert.equal(norm.is_bundle, false);
  assert.equal(norm.normalization_status, 'NORMALIZED');
  assert.equal(norm.source_hash, 'a'.repeat(64));
});

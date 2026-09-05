'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  FROZEN_FIVE,
  applyConfirmedFiveWatchPublication,
} = require('../api/_lib/five-watch-publication.cjs');

const root = path.resolve(__dirname, '..');

const rawById = {
  'd7ca9584-c8d0-43a5-8e19-7cf3fc4473e2': '14657 - Zenith - 95.9000.9004/78.M9000 - Card & Box - 7,170$',
  '0a6e7949-1717-4123-994c-17377f7e9ab8': '2022 TDOR 79830RB Used condition Complete set $2900.00 USD',
  '5f11c5b4-bd08-4976-9a87-af1a9921a8a3': 'Omega 310.60.42.50.01.001 Fullset. Price usd 28k',
  'ec507bd1-9cfc-4be2-aaa4-3f0dd477af80': 'Cartier Santos WSSA0039 HKD 46,400 USD 5,900',
  'f125afdc-c21a-4450-a59b-01f3f667edb2': 'Vacheron 7900V/110A-B546 HKD 193,000. USD 24,600.',
};

test('exact five publication exposes only source-confirmed prices and preserves originals', () => {
  const expectedUsd = [null, 2900, 28000, 5900, 24600];
  const expectedOriginal = [7170, 2900, 28000, 46400, 193000];
  Object.entries(FROZEN_FIVE).forEach(([id, definition], index) => {
    const published = applyConfirmedFiveWatchPublication({
      id,
      brand: definition.brand,
      reference: definition.reference,
      raw_message: rawById[id],
      seller_rating: 5,
      seller_phone: '+10000000000',
      contact_publication_approved: true,
    });
    assert.equal(published.price_usd, expectedUsd[index]);
    assert.equal(published.original_price_amount, expectedOriginal[index]);
    assert.equal(published.confirmed_data_publication, 'EXACT_FIVE_SOURCE_CONFIRMED_V1');
    assert.equal(published.seller_rating, null);
    assert.equal(published.seller_phone, null);
    assert.equal(published.contact_publication_approved, false);
  });
});

test('exact five publication fails closed if exact identity or raw price evidence changes', () => {
  const id = 'ec507bd1-9cfc-4be2-aaa4-3f0dd477af80';
  const held = applyConfirmedFiveWatchPublication({
    id,
    brand: 'Cartier',
    reference: 'WSSA0039',
    raw_message: 'Cartier WSSA0039 price on request',
    price_usd: 5900,
  });
  assert.equal(held.price_usd, null);
  assert.equal(held.price_evidence_status, 'EXACT_SOURCE_EVIDENCE_MISMATCH_HELD');
});

test('Trading Floor renders original currency without verbose price evidence and withholds normalized summaries', () => {
  const source = fs.readFileSync(path.join(root, 'src/pages/TradingFloor.tsx'), 'utf8');
  assert.doesNotMatch(source, /priceEvidenceLabel/);
  assert.match(source, /Original: \{meta\.originalPriceLabel\}/);
  assert.match(source, /listing\.raw_message_scope === 'normalized_summary'/);
  assert.match(source, /SOURCE_EXPLICIT_USD_USDT/);
  assert.match(source, /DATED_VERIFIED_FX/);
});

test('Vacheron detail is loaded through its exact reference RPC', () => {
  const source = fs.readFileSync(path.join(root, 'api/price-research-listing.js'), 'utf8');
  assert.match(source, /loadFrozenVacheronDetail/);
  assert.match(source, /qnsa_vacheron_overseas_reference_rows/);
  assert.match(source, /applyConfirmedFiveWatchPublication\(frozenVacheronDetail\)/);
});

test('Price Research uses the same exact five confirmed-data publication contract', () => {
  const source = fs.readFileSync(path.join(root, 'api/price-research.js'), 'utf8');
  assert.match(source, /require\('\.\/_lib\/five-watch-publication\.cjs'\)/);
  assert.match(source, /return applyConfirmedFiveWatchPublication\(\{/);
});

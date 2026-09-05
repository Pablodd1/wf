'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  normalizeStagedRow,
  resolveStrictIntent,
  processStagedRowsLocally
} = require('../tools/mariadb-live/run-normalization-canary-10k.cjs');

test('1. never default unknown intent to WTS - return null / REVIEW_REQUIRED without explicit evidence', () => {
  // Explicit buy -> WTB
  assert.equal(resolveStrictIntent({ type: 'buy' }), 'WTB');
  assert.equal(resolveStrictIntent({ title: 'WTB Rolex Submariner' }), 'WTB');

  // Explicit sale -> WTS
  assert.equal(resolveStrictIntent({ type: 'sale' }), 'WTS');
  assert.equal(resolveStrictIntent({ title: 'WTS Daytona 116500' }), 'WTS');

  // Ambiguous / no cue -> null (NEVER defaulted to WTS)
  assert.equal(resolveStrictIntent({ type: '', title: 'Rolex Submariner 126610LN' }), null);
  assert.equal(resolveStrictIntent({ type: null, title: 'Just a watch reference 5711' }), null);
});

test('2. bundle detection uses raw is_bundle plus deterministic candidate splitter and holds multi-candidate rows', () => {
  // Raw is_bundle = 1
  const explicitBundle = {
    source_id: 'bundle-001',
    source_hash: '1'.repeat(64),
    source_created_on: '2025-01-10T10:00:00.000Z',
    raw_payload: {
      is_bundle: 1,
      brand: 'Patek Philippe',
      title: 'Patek Bundle',
      type: 'sale'
    }
  };
  const norm1 = normalizeStagedRow(explicitBundle);
  assert.equal(norm1.bundle_lineage.held_out_of_publication, true);
  assert.equal(norm1.publication_eligibility, 'HELD_BUNDLE_REVIEW');
  assert.equal(norm1.reconciliation_category, 'REVIEW_REQUIRED');

  // Multi-candidate text (split by existing deterministic splitter)
  const multiCandidate = {
    source_id: 'bundle-002',
    source_hash: '2'.repeat(64),
    source_created_on: '2025-01-10T10:00:00.000Z',
    raw_payload: {
      is_bundle: 0,
      type: 'sale',
      title: '116500LN Daytona\n126610LN Submariner'
    }
  };
  const norm2 = normalizeStagedRow(multiCandidate);
  assert.equal(norm2.bundle_lineage.is_multi_candidate, true);
  assert.equal(norm2.bundle_lineage.held_out_of_publication, true);
  assert.equal(norm2.publication_eligibility, 'HELD_BUNDLE_REVIEW');
});

test('3. price research eligibility requires explicit price and explicit currency evidence - bare $ is review-held', () => {
  // Bare $ -> AMBIGUOUS_BARE_DOLLAR_HELD
  const bareDollarRow = {
    source_id: 'price-001',
    source_hash: '3'.repeat(64),
    source_created_on: '2025-01-10T10:00:00.000Z',
    raw_payload: {
      type: 'sale',
      brand: 'Rolex',
      model: 'Submariner',
      reference: '126610LN',
      price: '14500',
      currency: '$'
    }
  };
  const normBare = normalizeStagedRow(bareDollarRow);
  assert.equal(normBare.currency_status, 'AMBIGUOUS_BARE_DOLLAR_HELD');
  assert.equal(normBare.price_research_eligible, false);
  assert.equal(normBare.reconciliation_category, 'REVIEW_REQUIRED');

  // Explicit USD -> VERIFIED_EXPLICIT_USD & eligible
  const explicitUsdRow = {
    source_id: 'price-002',
    source_hash: '4'.repeat(64),
    source_created_on: '2025-01-10T10:00:00.000Z',
    raw_payload: {
      type: 'sale',
      brand: 'Rolex',
      model: 'Submariner',
      reference: '126610LN',
      price: '14500',
      currency: 'USD'
    }
  };
  const normUsd = normalizeStagedRow(explicitUsdRow);
  assert.equal(normUsd.currency_status.startsWith('VERIFIED_EXPLICIT_USD'), true);
  assert.equal(normUsd.price_amount, 14500);
  assert.equal(normUsd.price_currency, 'USD');
  assert.equal(normUsd.price_research_eligible, true);
  assert.equal(normUsd.publication_eligibility, 'ELIGIBLE_NORMALIZED');
  assert.equal(normUsd.reconciliation_category, 'NORMALIZED_PROPOSAL');
});

test('4. every output proposal retains all required evidence fields', () => {
  const row = {
    source_id: 'evidence-001',
    source_hash: 'e'.repeat(64),
    source_created_on: '2025-01-15T12:00:00.000Z',
    source_system: 'OceanDigital MariaDB',
    source_database: 'thecollective_inventory',
    source_table: 'auctions',
    source_record_id: 'mysql_auctions_evidence-001',
    raw_message: 'Rolex Daytona 116500LN 28000 USD Full Set',
    raw_payload: {
      type: 'sale',
      brand: 'Rolex',
      model: 'Daytona',
      reference: '116500LN',
      price: '28000',
      currency: 'USD',
      front_image: 'daytona_front.jpg',
      from_name: 'Geneva Dealer',
      from_number: '41791234567',
      phone_code: 41,
      dealer_rating: 5,
      origin: 'WhatsApp',
      region: 'Europe',
      is_bundle: 0
    }
  };

  const p = normalizeStagedRow(row);
  assert.equal(p.source_id, 'evidence-001');
  assert.equal(p.source_hash, 'e'.repeat(64));
  assert.equal(p.source_cursor, '2025-01-15T12:00:00.000Z');
  assert.equal(p.raw_message, 'Rolex Daytona 116500LN 28000 USD Full Set');
  assert.equal(p.front_image_key, 'daytona_front.jpg');
  assert.equal(p.seller_contact_evidence.from_name, 'Geneva Dealer');
  assert.equal(p.seller_contact_evidence.from_number, '41791234567');
  assert.equal(p.bundle_lineage.held_out_of_publication, false);
  assert.equal(p.reconciliation_category, 'NORMALIZED_PROPOSAL');
});

test('5. local processing writes JSONL/CSV artifacts and proves exact reconciliation: input = proposals + review + errors', () => {
  const sampleRows = [
    {
      source_id: 'row-1',
      source_hash: '1'.repeat(64),
      source_created_on: '2025-01-10T10:00:00.000Z',
      source_system: 'OceanDigital MariaDB',
      source_database: 'thecollective_inventory',
      source_table: 'auctions',
      raw_payload: { type: 'sale', brand: 'Rolex', model: 'Submariner', reference: '126610LN', price: '14500', currency: 'USD' }
    },
    {
      source_id: 'row-2',
      source_hash: '2'.repeat(64),
      source_created_on: '2025-01-10T10:01:00.000Z',
      source_system: 'OceanDigital MariaDB',
      source_database: 'thecollective_inventory',
      source_table: 'auctions',
      raw_payload: { is_bundle: 1, type: 'sale', brand: 'Patek', title: 'Bundle' }
    },
    {
      source_id: 'row-3',
      source_hash: '3'.repeat(64),
      source_created_on: '2025-01-10T10:02:00.000Z',
      source_system: 'OceanDigital MariaDB',
      source_database: 'thecollective_inventory',
      source_table: 'auctions',
      raw_payload: { type: null, brand: 'Rolex', price: '10000', currency: '$' }
    }
  ];

  const testDir = path.resolve('audit-output/mariadb-live/test-norm-canary');
  const result = processStagedRowsLocally(sampleRows, { outputDir: testDir });

  assert.equal(result.reconciliation.total_inputs, 3);
  assert.equal(result.reconciliation.normalized_proposals, 1);
  assert.equal(result.reconciliation.review_required, 2);
  assert.equal(result.reconciliation.errors, 0);
  assert.equal(result.reconciliation.exact_reconciliation, true);

  assert.equal(fs.existsSync(path.join(testDir, 'proposals.jsonl')), true);
  assert.equal(fs.existsSync(path.join(testDir, 'proposals.csv')), true);
  assert.equal(fs.existsSync(path.join(testDir, 'manifest.json')), true);
  assert.equal(fs.existsSync(path.join(testDir, 'error-reasons.json')), true);

  // Cleanup test output
  fs.rmSync(testDir, { recursive: true, force: true });
});

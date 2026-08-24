'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { classify, discover } = require('../tools/audit/phase4b-rolex-wts-discovery.cjs');

const fx = {
  observed_at: '2026-08-24T00:00:00Z',
  source: 'European Central Bank reference rates',
  usd_per_unit: { USD: 1, EUR: 1.1664, HKD: 0.12760371083493788 },
  recognized_but_withheld: ['AED'],
};

function row(raw_message, overrides = {}) {
  return {
    listing_id: '11111111-1111-4111-8111-111111111111',
    source_record_id: 'source-1',
    raw_message_version_id: '22222222-2222-4222-8222-222222222222',
    source_hash: 'a'.repeat(64),
    source_candidate_hash: 'b'.repeat(64),
    reference_normalized: '126334',
    intent: 'WTS',
    raw_message,
    parent_id: null,
    is_bundle: false,
    bundle_status: 'SINGLE_CANDIDATE',
    price_usd: null,
    ...overrides,
  };
}

test('explicit USD is safe only with exact immutable WTS lineage', () => {
  const result = classify(row('Rolex 126334\nUSD 12500'), fx);
  assert.equal(result.classification, 'SAFE_EXPLICIT_USD');
  assert.equal(result.parser_evidence.proposed_price_usd, 12500);
});

test('recognized but unsupported AED remains review-required', () => {
  const result = classify(row('Rolex 126334 AED 58500\nBox and papers'), fx);
  assert.equal(result.classification, 'REVIEW_REQUIRED');
  assert.equal(result.reason, 'DATED_FX_UNAVAILABLE');
});

test('bare dollar and multiple-reference price evidence cannot enter the safe lane', () => {
  const bare = classify(row('Rolex 126334 $14,500'), fx);
  assert.notEqual(bare.classification, 'SAFE_EXPLICIT_USD');
  const bundle = classify(row('Rolex 126334 and Patek 5712/1A USD 30000'), fx);
  assert.equal(bundle.classification, 'REVIEW_REQUIRED');
  assert.equal(bundle.reason, 'PARSER_BUNDLE_PRICE_AMBIGUITY');
});

test('discovery reconciles safe, review, and unresolved rows without writes', async () => {
  const input = {
    read_only: true,
    transaction_read_only: 'on',
    count: 3,
    rows: [
      row('Rolex 126334\nUSD 12500'),
      row('Rolex 126334 AED 58500\nBox and papers', { listing_id: '33333333-3333-4333-8333-333333333333' }),
      row('Rolex 126334 price on request', { listing_id: '44444444-4444-4444-8444-444444444444' }),
    ],
  };
  const report = await discover(input, fx);
  assert.equal(report.counts.SAFE_EXPLICIT_USD, 1);
  assert.equal(report.counts.REVIEW_REQUIRED, 1);
  assert.equal(report.counts.UNRESOLVED, 1);
  assert.equal(report.production_writes, 0);
  assert.equal(report.safe_rows.length, 1);
});

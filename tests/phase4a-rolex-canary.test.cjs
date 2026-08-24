'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { AUTHORIZED, buildManifest } = require('../tools/audit/build-phase4a-rolex-canary.cjs');

function row(listingId, overrides = {}) {
  const expected = AUTHORIZED.get(listingId);
  return {
    classification: 'SAFE_VERIFIED_FX',
    listing_id: listingId,
    normalized_reference: expected.reference,
    source_record_id: expected.source_record_id,
    raw_message_version_id: expected.raw_message_version_id,
    source_hash: expected.source_hash,
    source_candidate_hash: expected.source_candidate_hash,
    intent: 'WTB',
    bundle_state: { parent_id: null, is_bundle: false, bundle_status: 'SINGLE_CANDIDATE' },
    existing_price: { price_usd: null },
    parser_observation: {
      proposed_price_usd: 11664,
      source_amount: 10000,
      source_currency: 'EUR',
      currency_evidence: 'explicit_line_currency',
      fx_rate: 1.1664,
      fx_date: '2026-08-24T00:00:00+00:00',
      fx_source: 'European Central Bank reference rates',
    },
    ...overrides,
  };
}

function cohort() {
  const ids = [...AUTHORIZED.keys()];
  return {
    rows: ids.map((id, index) => row(id, index === 1 ? {
      parser_observation: {
        proposed_price_usd: 51742,
        source_amount: 37950,
        source_currency: 'GBP',
        currency_evidence: 'explicit_line_currency',
        fx_rate: 1.3634132086499124,
        fx_date: '2026-08-24T00:00:00+00:00',
        fx_source: 'European Central Bank reference rates',
      },
    } : {})),
  };
}

test('Phase 4A manifest is bound to exactly the three authorized immutable rows', () => {
  const manifest = buildManifest(cohort(), '2026-08-24T15:36:51.000Z');
  assert.equal(manifest.expected_count, 3);
  assert.deepEqual(manifest.records.map(value => value.listing_id), [...AUTHORIZED.keys()].sort());
  assert.match(manifest.manifest_sha256, /^[0-9a-f]{64}$/);
  assert.equal(manifest.records.find(value => value.normalized_reference === '228235').conversion_rate, 1.363413);
});

test('Phase 4A manifest aborts on a non-null target field', () => {
  const input = cohort();
  input.rows[0].existing_price.price_usd = 1;
  assert.throws(() => buildManifest(input), /Invariant drift/);
});

test('Phase 4A manifest aborts if the immutable cohort is not exactly three', () => {
  const input = cohort();
  input.rows.pop();
  assert.throws(() => buildManifest(input), /Expected exactly 3 safe rows/);
});

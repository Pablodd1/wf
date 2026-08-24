'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { classify } = require('../tools/audit/phase6a-patek-wts-discovery.cjs');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'audit-output/phase6a-patek-second-brand-pilot');

function row(overrides = {}) {
  return {
    listing_id: '00000000-0000-0000-0000-000000000001',
    source_record_id: 'source-1',
    raw_message_version_id: '00000000-0000-0000-0000-000000000002',
    source_hash: 'a'.repeat(64),
    source_candidate_hash: 'b'.repeat(64),
    reference_normalized: '5167/1A-001',
    intent: 'WTS',
    price_usd: null,
    parent_id: null,
    is_bundle: false,
    bundle_status: 'SINGLE_CANDIDATE',
    exact_raw_match: true,
    dial_color_normalized: 'Black',
    condition_normalized: 'Pre-Owned',
    raw_message: 'Patek Philippe 5167/1A-001\nPrice: USD 55,000',
    ...overrides,
  };
}

test('Patek classifier reuses parser-v5 for an exact explicit-USD row', () => {
  const result = classify(row(), { usd_per_unit: { USD: 1 }, source: 'test', observed_at: '2026-08-24T00:00:00Z' });
  assert.equal(result.classification, 'SAFE_EXPLICIT_USD');
  assert.equal(result.model, 'Aquanaut');
  assert.equal(result.reference, '5167/1A-001');
  assert.equal(result.parser_evidence.source_amount, 55000);
});

test('partial Patek references are not silently promoted', () => {
  const result = classify(row({ reference_normalized: '5167A', raw_message: 'Patek Philippe 5167A\nPrice: USD 55,000' }), { usd_per_unit: { USD: 1 } });
  assert.equal(result.classification, 'UNRESOLVED');
  assert.equal(result.reason, 'NOT_VALID_PUNCTUATION_SENSITIVE_EXACT_REFERENCE');
});

test('Phase 6A artifact is read-only, blocked, and contains no retained private raw payload', () => {
  const audit = JSON.parse(fs.readFileSync(path.join(OUT, 'audit.json'), 'utf8'));
  const discovery = fs.readFileSync(path.join(OUT, 'wts-discovery.json'), 'utf8');
  assert.equal(audit.mode, 'READ_ONLY_SHADOW_ONLY');
  assert.equal(audit.transaction_read_only, 'on');
  assert.equal(audit.production_writes, 0);
  assert.equal(audit.recommendation, 'BLOCKED_NO_SAFE_COHORT');
  assert.equal(audit.discovery.safe, 0);
  assert.equal(audit.proposed_production_canary.count, 0);
  assert.equal(audit.census.wts + audit.census.wtb, audit.census.active_staging_listings);
  assert.equal(audit.safeguards.raw_messages_retained_in_private_input, false);
  assert.equal(/"raw_message"\s*:/.test(discovery), false);
  assert.equal(fs.existsSync(path.join(OUT, 'inputs/private-cohort.tmp.json')), false);
});

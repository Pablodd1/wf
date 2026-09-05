'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { auditRow, classifyMismatch, evaluateCanaryEligibility, CANARY_POLICY_VERSION } = require('../tools/price-quality/audit-price-normalization.cjs');
const { buildRows } = require('../tools/price-quality/stage-price-canary.cjs');

test('flags stale stored USD when exact reference line contains explicit USD', () => {
  const finding = auditRow({
    id: '8ea77591-a76d-4e86-b153-2c79f7c35851',
    brand: 'Patek Philippe',
    reference: '5712/1R',
    dial_color: 'Blue',
    condition: 'Used',
    listing_type: 'WTS',
    price_usd: 31917,
    currency: 'HKD',
    raw_message: '5712/1R Used 2024 Fullset HKD1,920,000 / USD249,350',
  });

  assert.equal(finding.normalized_price_usd, 249350);
  assert.equal(finding.stored_price_usd, 31917);
  assert.equal(finding.price_normalization, 'EXPLICIT_USD_FROM_REFERENCE_LINE');
  assert.equal(finding.severity, 'high');
  assert.ok(finding.flags.includes('LIKELY_LEGACY_HKD_DOUBLE_CONVERSION'));
  assert.ok(finding.flags.includes('MAJOR_PRICE_DELTA'));
});

test('flags stored low-price luxury floor issue when raw HKD line normalizes higher', () => {
  const finding = auditRow({
    id: 'low-stored-price',
    brand: 'Rolex',
    reference: '52506',
    dial_color: 'Ice Blue',
    condition: 'New',
    listing_type: 'WTS',
    price_usd: 244,
    currency: 'HKD',
    raw_message: '52506 Ice Blue HKD 313K',
  });

  assert.equal(finding.normalized_price_usd, 40128);
  assert.equal(finding.severity, 'high');
  assert.ok(finding.flags.includes('STORED_PRICE_BELOW_LUXURY_FLOOR'));
  assert.ok(finding.flags.includes('MAJOR_PRICE_DELTA'));
});

test('keeps minor mismatches low severity', () => {
  const result = classifyMismatch({ price_usd: 100000 }, 103000, 'EXPLICIT_USD_FROM_REFERENCE_LINE');
  assert.equal(result.severity, 'low');
  assert.equal(result.delta_pct, 3);
  assert.ok(result.flags.includes('MINOR_PRICE_DELTA'));
});

test('marks repeated-reference evidence blocks for review', () => {
  const finding = auditRow({
    id: 'repeated-reference',
    brand: 'Audemars Piguet',
    reference: '15202BC',
    price_usd: 365000,
    raw_message: '15202bc salmon 2019 used full set 855k hkd\n15202bc salmon 2021 Brand New 885k hkd',
  });

  assert.equal(finding.normalized_price_usd, 109615);
  assert.ok(finding.flags.includes('REPEATED_REFERENCE_BLOCK_REVIEW'));
});

test('only a single WTS listing with explicit line currency is canary eligible', () => {
  const finding = auditRow({
    id: 'safe-1',
    brand: 'Rolex',
    reference: '126500LN',
    listing_type: 'WTS',
    currency: 'USD',
    price_usd: 1000,
    raw_message: '126500LN white USD 280000',
  });

  assert.equal(finding.canary_eligible, true);
  assert.equal(finding.candidate_count, 1);
  assert.deepEqual(finding.canary_exclusions, []);
});

test('bundles and implausible luxury prices are excluded from the canary', () => {
  const finding = auditRow({
    id: 'unsafe-1',
    brand: 'Rolex',
    reference: '126500LN',
    listing_type: 'WTS',
    currency: 'USD',
    price_usd: 10000,
    raw_message: '126500LN white USD 244\n5712/1A blue USD 90000',
  });

  assert.equal(finding.canary_eligible, false);
  assert.ok(finding.canary_exclusions.includes('BUNDLE_OR_MULTILISTING'));
  assert.ok(finding.canary_exclusions.includes('BELOW_LUXURY_FLOOR'));
});

test('price canary staging refuses excluded candidates and preserves review-only fields', () => {
  const safe = {
    id: 'safe-row',
    stored_price_usd: 780000,
    normalized_price_usd: 100000,
    price_normalization: 'EXPLICIT_HKD_FROM_REFERENCE_LINE',
    evidence_line: '5712/1A HKD 780000',
    flags: ['MAJOR_PRICE_DELTA'],
    canary_eligible: true,
    canary_exclusions: [],
  };
  const rows = buildRows({
    readOnly: true,
    canaryReleaseGate: { productionWrites: false, policyVersion: CANARY_POLICY_VERSION },
    canaryCandidates: [safe],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].review_status, 'PENDING');
  assert.equal(rows[0].source_record_id, 'safe-row');

  assert.throws(() => buildRows({
    readOnly: true,
    canaryReleaseGate: { productionWrites: false, policyVersion: CANARY_POLICY_VERSION },
    canaryCandidates: [{ ...safe, canary_eligible: false, canary_exclusions: ['BUNDLE_OR_MULTILISTING'] }],
  }), /Unsafe candidate/);
});

test('price canary excludes a single parsed candidate that does not match the stored reference context', () => {
  const finding = {
    price_normalization: 'EXPLICIT_USD_FROM_REFERENCE_LINE',
    flags: [],
    evidence_line: '5712/1A blue USD 90000',
  };
  const eligibility = evaluateCanaryEligibility({
    brand: 'Rolex',
    reference: '126500LN',
    listing_type: 'WTS',
    raw_message: '5712/1A blue USD 90000',
  }, finding);

  assert.equal(eligibility.canary_eligible, false);
  assert.ok(eligibility.canary_exclusions.includes('REFERENCE_CONTEXT_MISMATCH'));
});

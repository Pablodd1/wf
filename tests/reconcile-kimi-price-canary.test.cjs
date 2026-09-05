'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildReviewCandidate, hasExplicitUsdEvidence } = require('../tools/external-audit/reconcile-kimi-price-canary.cjs');

const external = {
  source_record_id: 'source-1',
  raw_evidence_line: '126500LN White WTS USD 280000',
  stored_price_usd: '100000',
  proposed_price_usd: '280000',
  source_currency_status: 'VERIFIED',
  recommendation: 'APPLY_CANDIDATE',
  stored_value_correction_candidate: 'True',
};

test('builds a review-only candidate after source evidence revalidation', () => {
  const candidate = buildReviewCandidate(external, {
    id: 'source-1', brand: 'Rolex', reference: '126500LN', listing_type: 'WTS',
    currency: 'USD', price_usd: 100000, raw_message: external.raw_evidence_line,
  }, { version: 'test-v1', allowHkd: false });
  assert.equal(candidate.source_record_id, 'source-1');
  assert.equal(candidate.normalization_reason, 'EXPLICIT_USD_FROM_REFERENCE_LINE');
  assert.equal(candidate.review_status, 'PENDING');
});

test('does not build a candidate when the authoritative source is not WTS', () => {
  const candidate = buildReviewCandidate(external, {
    id: 'source-1', brand: 'Rolex', reference: '126500LN', listing_type: 'WTB',
    currency: 'USD', price_usd: 100000, raw_message: external.raw_evidence_line,
  }, { version: 'test-v1', allowHkd: false });
  assert.equal(candidate, null);
});

test('keeps the initial no-FX canary to USD rather than USDT', () => {
  assert.equal(hasExplicitUsdEvidence('For sale USD $280000'), true);
  assert.equal(hasExplicitUsdEvidence('For sale USDT 280000'), false);
});

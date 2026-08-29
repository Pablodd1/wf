'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPromotionDecision } = require('../tools/shadow-reprocess/promotion-policy.cjs');

const validCandidate = {
  brand: 'Rolex',
  reference: '126610LN',
  prices: [{
    is_primary: true,
    amount_original: 114000,
    currency_original: 'HKD',
    currency_evidence: 'section_context',
  }],
};

test('blocks ambiguous and multi-watch shadow proposals from promotion', () => {
  const result = buildPromotionDecision({
    source_listing_type: 'WTS',
    candidate_count: 2,
    proposed_candidates: [validCandidate],
    change_flags: ['BUNDLE_SPLIT_REQUIRED', 'CURRENCY_AMBIGUOUS'],
  });
  assert.equal(result.disposition, 'HUMAN_REVIEW');
  assert.deepEqual(result.reasons, ['BUNDLE_SPLIT_REQUIRED', 'CURRENCY_AMBIGUOUS']);
});

test('requires catalog confirmation for a deterministic single-candidate WTS proposal', () => {
  const result = buildPromotionDecision({
    source_listing_type: 'WTS',
    candidate_count: 1,
    proposed_candidates: [validCandidate],
    change_flags: ['REFERENCE_CHANGED'],
  });
  assert.equal(result.disposition, 'CATALOG_CONFIRMATION_REQUIRED');
  assert.equal(result.candidate.reference, '126610LN');
});

test('allows WTB identity confirmation without an asking price', () => {
  const result = buildPromotionDecision({
    source_listing_type: 'WTB',
    candidate_count: 1,
    proposed_candidates: [{ brand: 'Cartier', reference: 'WSSA0039', prices: [] }],
    change_flags: ['REFERENCE_CHANGED'],
  });
  assert.equal(result.disposition, 'CATALOG_CONFIRMATION_REQUIRED');
});

test('uses explicit normalized WTB intent instead of a conflicting legacy source default', () => {
  const result = buildPromotionDecision({
    source_listing_type: 'WTS',
    candidate_count: 1,
    proposed_candidates: [{
      brand: 'Patek Philippe', reference: '7118/1A', listing_type: 'WTB', prices: [],
    }],
    change_flags: ['INTENT_CHANGED'],
  });
  assert.equal(result.disposition, 'CATALOG_CONFIRMATION_REQUIRED');
});

test('does not promote source-record currency evidence without human review', () => {
  const result = buildPromotionDecision({
    source_listing_type: 'WTS',
    candidate_count: 1,
    proposed_candidates: [{
      ...validCandidate,
      prices: [{
        ...validCandidate.prices[0],
        currency_evidence: 'source_record_currency',
      }],
    }],
    change_flags: [],
  });
  assert.equal(result.disposition, 'HUMAN_REVIEW');
  assert.deepEqual(result.reasons, ['CURRENCY_EVIDENCE_INSUFFICIENT']);
});

test('blocks ambiguous dial changes from promotion', () => {
  const result = buildPromotionDecision({
    source_listing_type: 'WTS',
    candidate_count: 1,
    proposed_candidates: [validCandidate],
    change_flags: ['DIAL_AMBIGUOUS', 'DIAL_CHANGED'],
  });
  assert.equal(result.disposition, 'HUMAN_REVIEW');
  assert.deepEqual(result.reasons, ['DIAL_AMBIGUOUS']);
});

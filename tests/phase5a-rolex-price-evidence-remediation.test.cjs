'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { deterministicLineAssociation, syntaxPattern, reasonToClass } = require('../tools/audit/phase5a-rolex-price-evidence-remediation.cjs');

test('maps frozen parser reasons into the six Phase 5A blocker classes', () => {
  assert.equal(reasonToClass('MULTIPLE_PRICE_CANDIDATES'), 'MULTIPLE_PRICE_AMBIGUITY');
  assert.equal(reasonToClass('PARSER_BUNDLE_PRICE_AMBIGUITY'), 'BUNDLE_OR_MULTIPLE_CONTEXT');
  assert.equal(reasonToClass('IMPLAUSIBLE_HKD_1_TO_3'), 'IMPLAUSIBLE_HKD');
  assert.equal(reasonToClass('DATED_FX_UNAVAILABLE'), 'AED_WITHOUT_APPROVED_FX');
});

test('accepts only a unique exact-reference line with one explicit parser-approved price', () => {
  const result = deterministicLineAssociation({ reference_normalized: '126334', raw_message: 'Rolex 126334 USD 12500' });
  assert.equal(result.recoverable, true);
  assert.equal(result.currency, 'USD');
});

test('does not choose among multiple prices on the exact-reference line', () => {
  const result = deterministicLineAssociation({ reference_normalized: '126334', raw_message: 'Rolex 126334 USD 12500 / USD 13000' });
  assert.equal(result.recoverable, false);
});

test('keeps implausible HKD without an explicit multiplier blocked', () => {
  const result = deterministicLineAssociation({ reference_normalized: '126334', raw_message: 'Rolex 126334 HKD 2' });
  assert.equal(result.recoverable, false);
  assert.equal(result.reason, 'IMPLAUSIBLE_HKD_WITHOUT_EXPLICIT_MULTIPLIER');
});

test('marks literal AED as conditional on approved dated FX', () => {
  const result = deterministicLineAssociation({ reference_normalized: '126334', raw_message: 'Rolex 126334 AED 45000', source_created_on: '2026-06-01T10:00:00Z' });
  assert.equal(result.recoverable, true);
  assert.equal(result.conditional, 'APPROVED_DATED_AED_FX_REQUIRED');
});

test('keeps AED blocked when the immutable source date is absent', () => {
  const result = deterministicLineAssociation({ reference_normalized: '126334', raw_message: 'Rolex 126334 AED 45000' });
  assert.equal(result.recoverable, false);
  assert.equal(result.reason, 'AED_SOURCE_DATE_MISSING');
});

test('reports syntax templates without returning the source text', () => {
  assert.equal(syntaxPattern('Rolex 126334 $12500', '126334'), 'BARE_DOLLAR_AMOUNT');
});

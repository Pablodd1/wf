'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyVisualAdvisory, normalizeReference } = require('../api/_lib/image-visual-advisory.cjs');

const claim = { brand: 'Rolex', model: 'Daytona', reference: '116500LN', dialColor: 'White' };

function observed(overrides = {}) {
  return {
    brand: 'Rolex',
    referenceVisible: '116500LN',
    modelGuess: 'Daytona',
    dialColor: 'White',
    legible: true,
    confidence: 95,
    ...overrides,
  };
}

test('visual advisory accepts only an exact normalized visible reference as a match', () => {
  assert.equal(normalizeReference('5712/1A-001'), '57121A001');
  const exact = classifyVisualAdvisory(claim, observed({ referenceVisible: '116500-LN' }));
  assert.equal(exact.verdict, 'MATCH');
  assert.equal(exact.checks.reference, 'AGREES');

  const partial = classifyVisualAdvisory(claim, observed({ referenceVisible: '116500' }));
  assert.equal(partial.verdict, 'UNVERIFIED');
  assert.equal(partial.checks.reference, 'PARTIAL');
});

test('brand, model, or dial resemblance cannot turn an image into a match', () => {
  const noReference = classifyVisualAdvisory(claim, observed({ referenceVisible: 'UNKNOWN' }));
  assert.equal(noReference.verdict, 'UNVERIFIED');
  assert.equal(noReference.checks.brand, 'AGREES');
  assert.equal(noReference.checks.model, 'CONSISTENT');
  assert.equal(noReference.checks.dial, 'CONSISTENT');
});

test('a visible identity conflict is surfaced for human adjudication', () => {
  const refConflict = classifyVisualAdvisory(claim, observed({ referenceVisible: '126500LN' }));
  assert.equal(refConflict.verdict, 'MISMATCH');
  assert.equal(refConflict.flag, 'IMAGE_MISMATCH');

  const brandConflict = classifyVisualAdvisory(claim, observed({ brand: 'Patek Philippe', referenceVisible: 'UNKNOWN' }));
  assert.equal(brandConflict.verdict, 'MISMATCH');
  assert.equal(brandConflict.checks.brand, 'CONFLICT');
});

test('unreadable images remain unverified even when the model emits a reference', () => {
  const result = classifyVisualAdvisory(claim, observed({ legible: false, confidence: 98 }));
  assert.equal(result.verdict, 'UNVERIFIED');
  assert.equal(result.flag, null);
});

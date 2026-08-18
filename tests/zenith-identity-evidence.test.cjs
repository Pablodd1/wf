'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyZenithIdentityEvidence,
  extractZenithReferences,
} = require('../api/_lib/zenith-identity-evidence.cjs');

test('extracts the real dotted Zenith reference instead of a source inventory number', () => {
  assert.deepEqual(
    extractZenithReferences('12379 - Zenith - 51.2081.400/78.C810 complete set €4650'),
    ['51.2081.400/78.C810'],
  );
});

test('supports alpha segments and terminal variants', () => {
  assert.deepEqual(extractZenithReferences('Zenith 03.A780.400-2/91.M3642 USD 7200'), [
    '03.A780.400-2/91.M3642',
  ]);
});

test('quarantines Zenith-movement Daytonas and mixed-brand messages', () => {
  assert.equal(classifyZenithIdentityEvidence('16520 Zenith Daytona T serial').reason, 'CROSS_BRAND_OR_DAYTONA');
  assert.equal(classifyZenithIdentityEvidence(
    'Zenith 03.A384.400/385.C855 USD 9000; Breitling V13375101C1X1 USD 7000',
  ).reason, 'CROSS_BRAND_OR_DAYTONA');
});

test('quarantines multiple Zenith references and reference-less accessory rows', () => {
  assert.equal(classifyZenithIdentityEvidence(
    'Zenith 03.3100.3600/69 USD 8000, Zenith 03.9300.3620/51.I001 USD 12000',
  ).reason, 'MULTIPLE_ZENITH_REFERENCES');
  assert.equal(classifyZenithIdentityEvidence('Zenith bracelet endlinks $1850').reason, 'NO_EXACT_ZENITH_REFERENCE');
});

test('admits one exact Zenith watch reference', () => {
  assert.deepEqual(classifyZenithIdentityEvidence('WTS Zenith 03.3100.3600/69.M3100 EUR 8500'), {
    decision: 'RELEASE_SAFE',
    reason: 'ONE_EXACT_ZENITH_REFERENCE',
    references: ['03.3100.3600/69.M3100'],
  });
});

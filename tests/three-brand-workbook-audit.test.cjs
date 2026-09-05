'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  canonicalBrand,
  duplicateSignature,
  normalizeReference,
  priceEvidence,
  scopedBrand,
} = require('../tools/intake/audit-three-brand-workbooks.cjs');

test('three-brand workbook audit canonicalizes only the approved scopes', () => {
  assert.equal(canonicalBrand('PP'), 'Patek Philippe');
  assert.equal(canonicalBrand('Rolex'), 'Rolex');
  assert.equal(canonicalBrand('AP'), 'Audemars Piguet');
  assert.equal(scopedBrand('PP all 138.xlsx'), 'Patek Philippe');
  assert.equal(scopedBrand('Rolex all 104.xlsx'), 'Rolex');
  assert.equal(scopedBrand('Audemars Piguet all 54.xlsx'), 'Audemars Piguet');
  assert.equal(scopedBrand('A Lange all 1.xlsx'), null);
  assert.equal(normalizeReference('5712/1a-001'), '5712/1A001');
  assert.notEqual(
    duplicateSignature({
      brand: 'Rolex',
      postingDate: '2026-07-30',
      rawMessage: '15500 blue 10000 USD',
      reference: '15500',
      price: 10000,
    }),
    duplicateSignature({
      brand: 'Audemars Piguet',
      postingDate: '2026-07-30',
      rawMessage: '15500 blue 10000 USD',
      reference: '15500',
      price: 10000,
    }),
  );
});

test('bare dollar and non-USD prices never become Price Research USD evidence', () => {
  assert.equal(
    priceEvidence('PP 5905R blue $497000 arrive HK', 497000).status,
    'CURRENCY_AMBIGUOUS_OR_MISSING',
  );
  assert.equal(
    priceEvidence('AP 15202BC 855000 HKD', 109615).status,
    'DATED_FX_PROVENANCE_REQUIRED',
  );
});

test('only matching source-explicit USD is immediately eligible', () => {
  const matching = priceEvidence('WTS Rolex 126500 USD 32000', 32000);
  assert.equal(matching.status, 'SOURCE_EXPLICIT_USD_MATCH');
  assert.equal(matching.sourceProvenUsd, true);
  assert.equal(matching.primary.amount_original, 32000);
  assert.equal(matching.primary.currency_original, 'USD');
  assert.equal(matching.primary.currency_evidence, 'explicit_line_currency');
  assert.equal(
    priceEvidence('WTS Rolex 126500 USD 32000', 33000).status,
    'EXPLICIT_USD_PRICE_CONFLICT',
  );
});

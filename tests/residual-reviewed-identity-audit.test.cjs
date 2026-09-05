'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  expectedBrandPresent,
  residualIdentityReason,
} = require('../tools/audit/generate-residual-reviewed-identity-manifest.cjs');

function row(raw_message, reference, model = '') { return { raw_message, reference, model }; }

test('detects TAG Richard Mille shorthand and Carter typo without broad surname rules', () => {
  assert.equal(residualIdentityReason(row('RM 72-01 watch only 620,000 USD', '7201', 'RM 72-01'), 'TAG Heuer'), 'RESIDUAL_TAG_RICHARD_MILLE_SHORTHAND');
  assert.equal(residualIdentityReason(row('Carter Cloche watch only', 'WGCC0004'), 'TAG Heuer'), 'RESIDUAL_TAG_CARTIER_TYPO');
  assert.equal(residualIdentityReason(row('TAG Heuer Carrera Day-Date', 'WDA2111', 'Carrera'), 'TAG Heuer'), null);
});

test('detects Breguet JLC and Patek metal-suffix identities while preserving valid Breguet numerals', () => {
  assert.equal(residualIdentityReason(row('JLC Q5023402 Master Grande Tradition 290000 usd', 'Jlc Q5023402'), 'Breguet'), 'RESIDUAL_BREGUET_JLC_IDENTITY');
  assert.equal(residualIdentityReason(row('5134G-001 White Breguet Numeric 2003', '5134G'), 'Breguet'), 'RESIDUAL_BREGUET_PATEK_CATALOG_IDENTITY');
  assert.equal(residualIdentityReason(row('Breguet Type XX 3800 full set', '3800', 'Type XX'), 'Breguet'), null);
  assert.equal(expectedBrandPresent('Breguet', '5134G White Breguet Numeric'), false);
});

test('preserves explicit Franck Muller numeric references', () => {
  assert.equal(residualIdentityReason(row('Franck Muller Casablanca 5850 full set', '5850', 'Casablanca'), 'Franck Muller'), null);
});

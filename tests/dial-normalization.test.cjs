'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeDialValue,
  resolveDial,
  uniqueCatalogDials,
} = require('../api/_lib/dial-normalization.cjs');

test('turns placeholder dial values into audited unknown values', () => {
  for (const value of [null, '', 'Unknown', 'N/A', 'none', '-']) {
    assert.equal(normalizeDialValue(value).value, null);
  }
});

test('canonicalizes spelling and dealer shorthand without losing meaningful variants', () => {
  assert.equal(normalizeDialValue('gray dial').value, 'Grey');
  assert.equal(normalizeDialValue('Blue Dial').value, 'Blue');
  assert.equal(normalizeDialValue('M.O.P.').value, 'Mother of Pearl');
  assert.equal(normalizeDialValue('choco').value, 'Chocolate');
  assert.equal(normalizeDialValue('tiffany').value, 'Tiffany Blue');
  assert.equal(normalizeDialValue('ice blue').value, 'Ice Blue');
  assert.equal(normalizeDialValue('salmon').value, 'Salmon');
  assert.equal(normalizeDialValue('champagne').value, 'Champagne');
  assert.equal(normalizeDialValue('reverse panda').value, 'Reverse Panda');
});

test('prefers explicit raw text over an unknown source value', () => {
  const result = resolveDial({
    sourceDial: 'Unknown',
    rawText: 'Rolex 126334 blue dial full set',
    catalogDials: ['Blue', 'Black', 'Green'],
  });
  assert.equal(result.value, 'Blue');
  assert.equal(result.evidence, 'explicit_raw_text');
  assert.equal(result.ambiguous, false);
});

test('uses an exact single-dial catalog configuration when text and source are empty', () => {
  const result = resolveDial({
    sourceDial: null,
    rawText: 'reference 52506 full set',
    catalogDials: ['White'],
  });
  assert.deepEqual(result, {
    value: 'White',
    evidence: 'exact_catalog_single_dial',
    confidence: 90,
    ambiguous: false,
    reason: null,
  });
});

test('does not guess when an exact reference has multiple possible dials', () => {
  const result = resolveDial({
    sourceDial: 'Unknown',
    rawText: 'Rolex 126334 full set',
    catalogDials: ['Blue', 'Black', 'Green'],
  });
  assert.equal(result.value, null);
  assert.equal(result.ambiguous, true);
  assert.equal(result.reason, 'multiple_catalog_dials');
});

test('preserves catalog variants instead of collapsing them to base colors', () => {
  assert.deepEqual(
    uniqueCatalogDials(['Tiffany Blue', 'Champagne', 'Salmon', 'Meteorite', 'Panda']),
    ['Tiffany Blue', 'Champagne', 'Salmon', 'Meteorite', 'Panda'],
  );
});

test('accepts a scalar dial value from the legacy catalog', () => {
  assert.deepEqual(uniqueCatalogDials('Blue'), ['Blue']);
});

test('flags conflicting source and explicit text for review', () => {
  const result = resolveDial({
    sourceDial: 'Black',
    rawText: '126500 white dial',
    catalogDials: ['Black', 'White'],
  });
  assert.equal(result.value, 'White');
  assert.equal(result.ambiguous, true);
  assert.equal(result.reason, 'source_text_conflict');
});

test('does not confuse case, bracelet, or bezel materials with dial color', () => {
  for (const rawText of [
    '18k solid yellow gold automatic watch',
    'diamond bezel white gold case',
    'silver bracelet black leather strap',
  ]) {
    assert.equal(resolveDial({ sourceDial: null, rawText, catalogDials: [] }).value, null);
  }
  assert.equal(
    resolveDial({ sourceDial: null, rawText: 'diamond dial white gold case', catalogDials: [] }).value,
    'Diamond',
  );
});

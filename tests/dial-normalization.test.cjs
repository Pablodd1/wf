'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  alignDealerDialAliasToCatalog,
  normalizeDialValue,
  resolveDial,
  uniqueCatalogDials,
} = require('../api/_lib/dial-normalization.cjs');

test('turns placeholder dial values into audited unknown values', () => {
  for (const value of [null, '', 'Unknown', 'N/A', 'none', '-', 'UNKNOW', 'Unknow', 'No Color', 'unknown color', 'multiple', 'multi', 'mixed']) {
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
  assert.equal(normalizeDialValue('blk').value, 'Black');
  assert.equal(normalizeDialValue('pista').value, 'Pistachio');
  assert.equal(normalizeDialValue('wim').value, 'Wimbledon');
  assert.equal(normalizeDialValue('mete').value, 'Meteorite');
  assert.equal(normalizeDialValue('yml').value, 'Yellow Mother of Pearl');
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

test('maps dealer panda shorthand to catalog white when panda is not a catalog dial', () => {
  const result = resolveDial({
    sourceDial: 'Unknown',
    rawText: 'Rolex Daytona 116500LN panda dial full set',
    catalogDials: ['Black', 'White'],
  });
  assert.equal(normalizeDialValue('panda dial').value, 'Panda');
  assert.deepEqual(alignDealerDialAliasToCatalog('Panda', ['Black', 'White']), {
    value: 'White',
    reason: 'raw_alias_panda_to_white',
  });
  assert.deepEqual(alignDealerDialAliasToCatalog('Panda', ['Black', 'Silver']), {
    value: 'White',
    reason: 'raw_alias_panda_to_white',
  });
  assert.equal(result.value, 'White');
  assert.equal(result.evidence, 'explicit_raw_text');
  assert.equal(result.ambiguous, false);
  assert.equal(result.reason, 'raw_alias_panda_to_white');
});

test('preserves panda when the exact catalog models panda as its own dial', () => {
  assert.deepEqual(alignDealerDialAliasToCatalog('Panda', ['Panda', 'Black']), {
    value: 'Panda',
    reason: null,
  });
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

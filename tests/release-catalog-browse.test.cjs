'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReleaseBrowseIndex } = require('../api/_lib/release-catalog-browse.cjs');

test('release browse assigns every reference to one canonical model', () => {
  const catalog = [
    { brand: 'Tudor', model: 'Black Bay', reference: '79220B' },
    { brand: 'Tudor', model: 'Clair de Rose', reference: '35800' },
  ];
  const observed = [
    { model: 'Reference-only listings', reference: '79220B', listing_count: 5, wts_count: 4 },
    { model: 'Heritage', reference: '79220B', listing_count: 3, wts_count: 2 },
    { model: 'Clair De Rose', reference: '35800', listing_count: 2, wts_count: 2 },
    { model: 'Reference-only listings', reference: '99999', listing_count: 1, wts_count: 1 },
  ];

  const result = buildReleaseBrowseIndex('Tudor', observed, catalog);
  assert.equal(result.references.length, 3);
  assert.equal(result.models.reduce((sum, row) => sum + row.reference_count, 0), 3);
  assert.equal(result.references.find(row => row.reference === '79220B').model, 'Black Bay');
  assert.equal(result.references.find(row => row.reference === '35800').model, 'Clair de Rose');
  assert.equal(result.references.filter(row => row.reference === '79220B').length, 1);
  assert.equal(result.modelConflicts.length, 1);
});

test('observed conflicts without catalog ownership prefer a specific model deterministically', () => {
  const result = buildReleaseBrowseIndex('Tudor', [
    { model: 'Reference-only listings', reference: '25407N', listing_count: 10 },
    { model: 'Pelagos', reference: '25407N', listing_count: 4 },
    { model: 'Black Bay', reference: '25407N', listing_count: 2 },
  ], []);
  assert.equal(result.references.length, 1);
  assert.equal(result.references[0].model, 'Pelagos');
  assert.equal(result.references[0].listing_count, 16);
});

test('unresolved-reference counts remain scoped to their observed model', () => {
  const result = buildReleaseBrowseIndex('Omega', [
    { model: 'Speedmaster', reference: null, listing_count: 3, priced_wts_count: 1 },
    { model: 'Seamaster', reference: '', listing_count: 5, priced_wts_count: 2 },
  ], []);
  assert.deepEqual(result.unresolvedByModel.Speedmaster, { listing_count: 3, priced_wts_count: 1 });
  assert.deepEqual(result.unresolvedByModel.Seamaster, { listing_count: 5, priced_wts_count: 2 });
  assert.equal(result.unresolvedReferenceListingCount, 8);
  assert.equal(result.unresolvedReferencePricedWtsCount, 3);
});

test('unresolvable strict catalog prefixes never become selectable exact references', () => {
  const result = buildReleaseBrowseIndex('Omega', [
    { model: 'Seamaster', reference: '22010', listing_count: 3, priced_wts_count: 2 },
    { model: 'Seamaster', reference: 'SOURCE-EXACT', listing_count: 1, priced_wts_count: 1 },
  ], [
    { brand: 'Omega', model: 'Seamaster', reference: '220.10.38.20.01.002' },
  ]);

  assert.equal(result.references.some(row => row.reference === '22010'), false);
  assert.equal(result.references.some(row => row.reference === 'SOURCE-EXACT'), true);
  assert.equal(result.suppressedPartialReferenceCount, 1);
  assert.deepEqual(result.suppressedPartialReferences, [
    { reference: '22010', listing_count: 3, priced_wts_count: 2 },
  ]);
});

test('canonical-source entries that resolve only as partial are not browsable exact references', () => {
  const result = buildReleaseBrowseIndex('Tudor', [
    { model: '1926', reference: '91650', listing_count: 20, priced_wts_count: 9 },
  ], [
    { brand: 'Tudor', model: '1926', reference: '91650' },
  ]);

  assert.equal(result.references.some(row => row.reference === '91650'), false);
  assert.equal(result.suppressedPartialReferenceCount, 1);
  assert.deepEqual(result.suppressedPartialReferences, [
    { reference: '91650', listing_count: 20, priced_wts_count: 9 },
  ]);
});

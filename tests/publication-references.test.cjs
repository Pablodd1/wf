'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  isPublicationReferenceAllowed,
  normalizePublicationReference,
  publicationReferencePostgrestFilter,
  publicationReferences,
  publicationReferencesForBrand,
} = require('../api/_lib/publication-references.cjs');

const configured = [
  'Rolex::116610LN',
  'Patek Philippe::5712/1A',
  'Patek Philippe::5712/1A-001',
  'Rolex::126710BLNR',
].join('|');

test('three-watch release configuration is brand-scoped and exact', () => {
  assert.equal(publicationReferences(configured).length, 4);
  assert.deepEqual(publicationReferencesForBrand('Rolex', configured), ['116610LN', '126710BLNR']);
  assert.equal(isPublicationReferenceAllowed('rolex', '116610ln', configured), true);
  assert.equal(isPublicationReferenceAllowed('Patek Philippe', '5712/1A-001', configured), true);
  assert.equal(isPublicationReferenceAllowed('Rolex', '5712/1A-001', configured), false);
  assert.equal(isPublicationReferenceAllowed('Rolex', '126610LN', configured), false);
});

test('reference normalization preserves identity while ignoring punctuation and case', () => {
  assert.equal(normalizePublicationReference(' 5712/1a-001 '), '57121A001');
  assert.equal(normalizePublicationReference('116610ln'), '116610LN');
});

test('PostgREST release filter is a bounded exact IN predicate', () => {
  assert.equal(
    publicationReferencePostgrestFilter(configured),
    'in.("116610LN","5712/1A","5712/1A-001","126710BLNR")',
  );
});

test('an unset reference release configuration preserves existing behavior', () => {
  assert.equal(isPublicationReferenceAllowed('Rolex', '126610LN', ''), true);
  assert.equal(publicationReferencePostgrestFilter(''), null);
});

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  isPublicationBrandAllowed,
  publicationBrandPostgrestFilter,
  publicationBrands,
} = require('../api/_lib/publication-brands.cjs');

test('configured release includes the controlled reviewed workbook brands', () => {
  const configured = 'Rolex|Patek Philippe';
  assert.deepEqual(publicationBrands(configured), ['Rolex', 'Patek Philippe', 'Panerai', 'Zenith']);
  assert.equal(isPublicationBrandAllowed('rolex', configured), true);
  assert.equal(isPublicationBrandAllowed('Patek Philippe', configured), true);
  assert.equal(isPublicationBrandAllowed('Panerai', configured), true);
  assert.equal(isPublicationBrandAllowed('Zenith', configured), true);
  assert.equal(isPublicationBrandAllowed('Audemars Piguet', configured), false);
  assert.equal(publicationBrandPostgrestFilter(configured), 'in.("Rolex","Patek Philippe","Panerai","Zenith")');
});

test('reviewed Panerai release can be added without opening other brands', () => {
  const configured = 'Rolex|Patek Philippe|Audemars Piguet|Panerai';
  assert.deepEqual(publicationBrands(configured), [
    'Rolex',
    'Patek Philippe',
    'Audemars Piguet',
    'Panerai',
    'Zenith',
  ]);
  assert.equal(isPublicationBrandAllowed('Panerai', configured), true);
  assert.equal(isPublicationBrandAllowed('Omega', configured), false);
  assert.equal(
    publicationBrandPostgrestFilter(configured),
    'in.("Rolex","Patek Philippe","Audemars Piguet","Panerai","Zenith")',
  );
});

test('an unset release configuration preserves the full catalog', () => {
  assert.equal(isPublicationBrandAllowed('Audemars Piguet', ''), true);
  assert.equal(publicationBrandPostgrestFilter(''), null);
});

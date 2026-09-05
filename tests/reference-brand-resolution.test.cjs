const assert = require('node:assert/strict');
const test = require('node:test');

const { inferBrand } = require('../api/_lib/resolve.js');

test('infers Omega from modern dotted references before punctuation normalization', () => {
  assert.equal(inferBrand('123.10.28.60.06.001'), 'Omega');
  assert.equal(inferBrand('131.25.29.20.55.001'), 'Omega');
});

test('preserves existing reference-family inference', () => {
  assert.equal(inferBrand('116500LN'), 'Rolex');
  assert.equal(inferBrand('5711/1A'), 'Patek Philippe');
  assert.equal(inferBrand('RM 11-03'), 'Richard Mille');
  assert.equal(inferBrand('PAM00671'), 'Panerai');
});

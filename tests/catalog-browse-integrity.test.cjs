'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  listCanonicalCatalogReferences,
  listCatalogBrands,
  listCatalogReferences,
} = require('../api/_lib/catalog.js');

test('public browse catalog excludes price, currency and punctuation artifacts retained by legacy lookup', () => {
  const legacy = listCatalogReferences('Cartier').map(entry => entry.reference);
  const canonical = listCanonicalCatalogReferences('Cartier').map(entry => entry.reference);

  assert.ok(legacy.includes('10000USD'));
  assert.ok(!canonical.includes('10000USD'));
  assert.ok(canonical.length > 700);
  assert.ok(canonical.every(reference => /[A-Z0-9]/i.test(reference)));
  assert.ok(canonical.every(reference => !/(?:USD|USDT|HKD|EUR|GBP|JPY|CNY|RMB|CHF|AED)$/i.test(reference)));
});

test('canonical browse preserves exact references that are awaiting model taxonomy', () => {
  const rolexOther = listCanonicalCatalogReferences('Rolex', 'Reference-only listings');
  assert.ok(rolexOther.some(entry => entry.reference === '126000'));
  assert.ok(rolexOther.every(entry => entry.model === 'Reference-only listings'));
});

test('brand totals include canonical references still awaiting model taxonomy', () => {
  const rolex = listCatalogBrands().find(entry => entry.brand === 'Rolex');
  assert.equal(rolex.reference_count, listCanonicalCatalogReferences('Rolex').length);
  assert.equal(rolex.model_count, new Set(listCanonicalCatalogReferences('Rolex').map(entry => entry.model)).size);
});

test('catalog reference API does not fabricate an observation or analytics readiness', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'catalog-references.js'), 'utf8');
  assert.match(source, /listCanonicalCatalogReferences/);
  assert.match(source, /listing_count: 0/);
  assert.match(source, /eligible_observation_count: 0/);
  assert.match(source, /analytics_ready: false/);
  assert.match(source, /identity_source: 'PREAGGREGATED_CATALOG_INDEX',\s*evidence_resolution: 'EXACT_REFERENCE_ON_SELECTION'/);
  assert.match(source, /evidence_resolution: 'EXACT_REFERENCE_ON_SELECTION'/);
  assert.doesNotMatch(source, /totalMentions \|\| entry\.totalMentions \|\| 1/);
});

test('catalog model API builds released browse groups from canonical identities only', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'catalog-models.js'), 'utf8');
  assert.match(source, /listCanonicalCatalogReferences/);
  assert.doesNotMatch(source, /const \{ listCatalogReferences, lookupCatalog \}/);
});

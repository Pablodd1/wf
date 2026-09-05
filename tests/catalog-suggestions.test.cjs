'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { listCatalogSuggestions } = require('../api/_lib/catalog');
const handler = require('../api/catalog-suggestions.js');

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
}

test('suggests every catalog-backed Patek 5712 family without silently selecting one', () => {
  const suggestions = listCatalogSuggestions('5712', { brand: 'Patek Philippe', limit: 20 });
  assert.deepEqual(
    suggestions.map(item => item.reference).sort(),
    ['5712/1A-001', '5712/1R-001', '5712G-001', '5712R-001'].sort(),
  );
  assert.ok(suggestions.every(item => item.brand === 'Patek Philippe'));
  assert.ok(suggestions.every(item => ['catalog_curation', 'local_catalog_v1'].includes(item.source)));
  assert.ok(suggestions.every(item => !/(?:NEW|ONLY|20\d{2})$/i.test(item.reference)));
});

test('suggests curated Rolex 116500LN and its approved dial labels', () => {
  const [suggestion] = listCatalogSuggestions('116500LN', { brand: 'Rolex' });
  assert.equal(suggestion.reference, '116500LN');
  assert.deepEqual(suggestion.dial_colors, ['Black', 'White']);
  assert.equal(suggestion.match_type, 'exact_reference');
});

test('offers a typo candidate but labels it for explicit user selection', () => {
  const suggestions = listCatalogSuggestions('16500LN', { brand: 'Rolex' });
  const correction = suggestions.find(item => item.reference === '116500LN');
  assert.ok(correction);
  assert.notEqual(correction.match_type, 'exact_reference');
});

test('catalog suggestions endpoint is bounded and read-only', async () => {
  const res = response();
  await handler({ method: 'GET', query: { q: '5712', brand: 'Patek Philippe', limit: '1000' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.ok(res.body.suggestions.length <= 20);
  assert.equal(res.body.selection_required_for_partial_or_typo_match, true);
});

test('catalog suggestions endpoint returns no results for a one-character query', async () => {
  const res = response();
  await handler({ method: 'GET', query: { q: '5' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.suggestions, []);
});

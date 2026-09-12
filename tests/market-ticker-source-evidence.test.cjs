'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = fs.readFileSync(require.resolve('../src/lib/marketTicker.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exportsObject = {};
new Function('exports', code)(exportsObject);
const { marketTickerItems } = exportsObject;

test('ticker never promotes an unverified price or creates an observation for an empty response', () => {
  assert.deepEqual(marketTickerItems([]), []);
  const rows = marketTickerItems([
    { id: 'synthetic-a', brand: 'Synthetic', reference: 'A', intent: 'WTS', price_usd: 28500 },
    { id: 'synthetic-b', brand: 'Synthetic', reference: 'B', intent: 'WTB', price_usd: 1200.5, price_display_verified: true },
  ]);
  assert.equal(rows[0].price, 'Price not confirmed');
  assert.equal(rows[1].price, '$1,200.50 USD');
  assert.equal(rows[1].status, 'WTB');
});

test('ticker keeps source identities unique and excludes bundles and unsupported intent', () => {
  const row = { id: 'synthetic-a', brand: 'Synthetic', model: 'One', reference: 'A', intent: 'WTS' };
  assert.equal(marketTickerItems([row, row, { ...row, id: 'bundle', is_bundle: true },
    { ...row, id: 'child', parent_listing_id: 'bundle' }, { ...row, id: 'unknown', intent: null }]).length, 1);
  assert.equal(marketTickerItems(Array.from({ length: 30 }, (_, i) => ({ ...row, id: String(i) }))).length, 12);
});

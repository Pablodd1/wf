'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/pages/PriceResearch.tsx'), 'utf8');
const ast = ts.createSourceFile('PriceResearch.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'mapWtbToRowData');
assert.ok(declaration);
const js = ts.transpileModule(declaration.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const map = new Function(js + '; return mapWtbToRowData;')();
test('WTB detail retains canonical source identity, raw prose, currency and evidence without inventing dates', () => {
  const row = { id: 'fixture-wtb', listing_id: 'fixture-wtb', contract_version: 'v2.0', intent: 'WTB',
    brand: 'Fixture', reference: 'R1', original_price_amount: 100, original_price_currency: 'EUR',
    raw_message: '  original request\nEUR 100  ', contact_available: false,
    image_evidence_type: 'SOURCE_LINKED_IMAGE', image_url: 'https://example.invalid/source.png',
    source_hash: 'a'.repeat(64), seller_rating: null, seller_review_count: null };
  const detail = map(row);
  for (const key of ['listing_id','contract_version','intent','brand','reference','raw_message','contact_available','source_hash','image_evidence_type']) assert.equal(detail[key], row[key]);
  assert.equal(detail.source_price_amount, 100);
  assert.equal(detail.source_currency, 'EUR');
  assert.equal(detail.price_usd, null);
  assert.equal(detail.created_at, '');
  assert.equal(detail.listing_date, null);
  assert.equal(detail.analytics_included, false);
  assert.equal(detail.is_outlier, false);
  assert.equal(detail.seller_rating, null);
});

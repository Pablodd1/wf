'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  classify,
  summarizeSource,
} = require('../tools/audit/build-global-catalog-census-reconciliation.cjs');

test('catalog census classifies exact, alias, partial, component, invalid and unresolved references without guessing', () => {
  const authoritative = new Set(['TUDOR|79030N', 'TUDOR|M7941A1A0RU0001']);
  const aliases = new Map([['TUDOR|ALIAS79030', { canonical_reference: '79030N' }]]);
  assert.equal(classify('79030N', 'Tudor', authoritative, aliases), 'EXACT');
  assert.equal(classify('ALIAS79030', 'Tudor', authoritative, aliases), 'ALIAS');
  assert.equal(classify('79030', 'Tudor', authoritative, aliases), 'PARTIAL');
  assert.equal(classify('BRACELET', 'Tudor', authoritative, aliases), 'COMPONENT');
  assert.equal(classify('USD', 'Tudor', authoritative, aliases), 'INVALID');
  assert.equal(classify('99999X', 'Tudor', authoritative, aliases), 'UNRESOLVED');
});

test('source reconciliation preserves every non-authoritative value in an explicit evidence bucket', () => {
  const rows = [
    { brand: 'Tudor', reference: '79030N' },
    { brand: 'Tudor', reference: '79030' },
    { brand: 'Tudor', reference: 'BRACELET' },
    { brand: 'Tudor', reference: 'USD' },
    { brand: 'Tudor', reference: '99999X' },
  ];
  const summary = summarizeSource('Tudor', 'fixture', rows, new Set(['TUDOR|79030N']), new Map(), new Set());
  assert.equal(summary.reference_count, 5);
  assert.equal(summary.exact_authoritative, 1);
  assert.equal(summary.partials, 1);
  assert.equal(summary.components, 1);
  assert.equal(summary.invalids, 1);
  assert.equal(summary.unresolved, 1);
  assert.equal(Object.values(summary.references_by_classification).flat().length, 5);
});

test('catalog census implementation is read-only and does not rerun Phase 7B', () => {
  const source = fs.readFileSync(path.resolve(__dirname,
    '../tools/audit/build-global-catalog-census-reconciliation.cjs'), 'utf8');
  assert.match(source, /phase7b_rerun:\s*false/);
  assert.doesNotMatch(source, /\.(?:insert|delete|upsert)\s*\(/i);
  assert.doesNotMatch(source, /method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
  assert.doesNotMatch(source, /raw_message\s*:/i);
});

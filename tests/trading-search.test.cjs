'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTradingSearch } = require('../api/_lib/trading-search.cjs');

test('parses brand reference and dial from one query', () => {
  assert.deepEqual(parseTradingSearch('Rolex 116500LN black'), { brand: 'Rolex', reference: '116500LN', dial: 'black' });
});

test('preserves multi-word brand', () => {
  assert.deepEqual(parseTradingSearch('Patek Philippe 5712/1A blue'), { brand: 'Patek Philippe', reference: '5712/1A', dial: 'blue' });
});

test('keeps simple brand and reference searches', () => {
  assert.deepEqual(parseTradingSearch('Omega'), { brand: 'Omega', reference: '', dial: '' });
  assert.deepEqual(parseTradingSearch('52508'), { brand: '', reference: '52508', dial: '' });
});

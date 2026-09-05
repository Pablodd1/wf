'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTradingSearch } = require('../api/_lib/trading-search.cjs');

test('parses brand reference and dial from one query', () => {
  assert.deepEqual(parseTradingSearch('Rolex 116500LN black'), { brand: 'Rolex', reference: '116500LN', dial: 'black', year: '', condition: '', completeness: '' });
});

test('preserves multi-word brand', () => {
  assert.deepEqual(parseTradingSearch('Patek Philippe 5712/1A blue'), { brand: 'Patek Philippe', reference: '5712/1A', dial: 'blue', year: '', condition: '', completeness: '' });
});

test('keeps simple brand and reference searches', () => {
  assert.deepEqual(parseTradingSearch('Omega'), { brand: 'Omega', reference: '', dial: '', year: '', condition: '', completeness: '' });
  assert.deepEqual(parseTradingSearch('52508'), { brand: '', reference: '52508', dial: '', year: '', condition: '', completeness: '' });
});

test('treats four-digit production years as attributes rather than references', () => {
  assert.deepEqual(parseTradingSearch('black daytona complete 2018'), {
    brand: 'daytona', reference: '', dial: 'black', year: '2018', condition: '', completeness: 'complete',
  });
});

test('keeps all typed watch attributes available for AND matching', () => {
  assert.deepEqual(parseTradingSearch('Rolex 116500LN black used full-set 2018'), {
    brand: 'Rolex', reference: '116500LN', dial: 'black', year: '2018', condition: 'used', completeness: 'full-set',
  });
});

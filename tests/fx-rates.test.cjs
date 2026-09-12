'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { convertCurrency, parseEcbRates } = require('../api/_lib/fx-rates.cjs');

test('builds USD-based rates from the latest ECB EUR quotes', async () => {
  const input = [
    'CURRENCY,TIME_PERIOD,OBS_VALUE',
    'USD,2026-07-17,1.10',
    'HKD,2026-07-17,8.58',
    'USD,2026-07-20,1.20',
    'HKD,2026-07-20,9.36',
    'GBP,2026-07-20,0.84',
  ].join('\n');
  const result = await parseEcbRates(input);
  assert.equal(result.observedAt, '2026-07-20');
  assert.equal(result.rates.USD, 1);
  assert.equal(result.rates.HKD, 7.8);
  assert.equal(result.rates.GBP, 0.7);
});

test('converts through the shared USD base without changing stored values', () => {
  const rates = { USD: 1, HKD: 7.8, EUR: 0.9 };
  assert.equal(convertCurrency(1000, 'USD', 'HKD', rates), 7800);
  assert.equal(convertCurrency(7800, 'HKD', 'USD', rates), 1000);
  assert.equal(convertCurrency('bad', 'USD', 'HKD', rates), null);
});

test('cross rates use the USD observation date and withhold currencies without a matching quote', async () => {
  const result = await parseEcbRates([
    'CURRENCY,TIME_PERIOD,OBS_VALUE',
    'USD,2026-07-17,1.20',
    'GBP,2026-07-17,0.84',
    'GBP,2026-07-18,0.96',
    'CHF,2026-07-16,0.90',
  ].join('\n'));
  assert.equal(result.observedAt, '2026-07-17');
  assert.equal(result.rates.GBP, 0.7);
  assert.equal(result.rates.CHF, undefined);
  assert.equal(convertCurrency(1000, 'GBP', 'USD', result.rates), 1000 / 0.7);
});

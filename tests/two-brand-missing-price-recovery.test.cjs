'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { recoveredLineagedPrice } = require('../tools/mariadb-live/build-two-brand-price-canary.cjs');

const fx = {
  observed_at: '2026-08-11T00:00:00Z',
  source: 'European Central Bank reference rates',
  usd_per_unit: { USD: 1, USDT: 1, HKD: 0.128, CNY: 0.139, JPY: 0.0068 },
};

test('recovers current-policy USD and Asian-currency prices from immutable raw text', () => {
  const cases = [
    ['$37k', 'USD', 37000],
    ['60000$', 'USD', 60000],
    ['106000 usdt', 'USDT', 106000],
    ['305k HKD', 'HKD', 39040],
    ['1.105m hkd', 'HKD', 141440],
    ['325.000 HKD', 'HKD', 41600],
    ['500000 RMB', 'CNY', 69500],
    ['4200000 JPY', 'JPY', 28560],
  ];
  for (const [raw, currency, usd] of cases) {
    const price = recoveredLineagedPrice({ raw_message: raw }, fx);
    assert.equal(price.currency_original, currency, raw);
    assert.equal(price.amount_usd, usd, raw);
    assert.equal(price.conversion_source,
      ['USD', 'USDT'].includes(currency)
        ? (raw.includes('$') ? 'USD_DEFAULTED_BY_POLICY' : 'SOURCE_USD_OR_USDT')
        : fx.source,
      raw);
  }
});

test('prefers an explicitly supplied USD amount over an accompanying HKD quote', () => {
  const price = recoveredLineagedPrice({
    raw_message: 'HKD 240,000. USD 30,500.',
  }, fx);
  assert.equal(price.currency_original, 'USD');
  assert.equal(price.amount_original, 30500);
  assert.equal(price.amount_usd, 30500);
});

test('fails closed for truly missing or materially conflicting non-USD amounts', () => {
  assert.equal(recoveredLineagedPrice({ raw_message: 'DM for price' }, fx), null);
  assert.equal(recoveredLineagedPrice({ raw_message: 'HKD 240,000 and HKD 1,000,000' }, fx), null);
});

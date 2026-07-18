'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMarketRow } = require('../api/_lib/market-row-normalization.cjs');

test('repairs HKD stored as USD using the exact reference line', () => {
  const result = normalizeMarketRow({ price_usd: 325000, raw_message: '52506 Ice Blue - HKD 325k\n52508 Black - HKD 296k' }, '52506');
  assert.equal(result.analytics_price_usd, 41667);
  assert.equal(result.price_normalization, 'EXPLICIT_HKD_FROM_REFERENCE_LINE');
});

test('prefers an explicit USD equivalent on the exact reference line', () => {
  const result = normalizeMarketRow({ price_usd: 313000, raw_message: 'New 52506 N5 Hkd313K Usdt40.5K' }, '52506');
  assert.equal(result.analytics_price_usd, 40500);
  assert.equal(result.price_normalization, 'EXPLICIT_USD_FROM_REFERENCE_LINE');
});

test('does not borrow a price from a different reference in the bundle', () => {
  const result = normalizeMarketRow({ price_usd: 26000, raw_message: '52506 Ice Blue price on request\n52508 Black HKD 296k' }, '52506');
  assert.equal(result.analytics_price_usd, 26000);
  assert.equal(result.price_normalization, null);
});

test('uses the claimed reference when catalog normalization adds a variant suffix', () => {
  const result = normalizeMarketRow(
    { price_usd: 871000, raw_message: '5167a 2023 HKD543k\n5712/1A blue 2020 HKD871k\n5961r 2022 HKD980k' },
    ['5712/1A', '5712/1A-001'],
  );
  assert.equal(result.analytics_price_usd, 111667);
  assert.equal(result.price_normalization, 'EXPLICIT_HKD_FROM_REFERENCE_LINE');
});

test('keeps an explicit Patek USD amount instead of a legacy double conversion', () => {
  const result = normalizeMarketRow({
    price_usd: 31917,
    raw_message: '5712/1R Used 2024 Fullset HKD1,920,000 / USD249,350',
  }, '5712/1R');
  assert.equal(result.analytics_price_usd, 249350);
  assert.equal(result.price_normalization, 'EXPLICIT_USD_FROM_REFERENCE_LINE');
});

test('reads an explicit USD equivalent from the short multiline listing block', () => {
  const result = normalizeMarketRow(
    { price_usd: 1305000, raw_message: '5712/1A blue\n2024 Full set\nNew Buckle\nHKD 1.305m\nusdt 168k' },
    ['5712/1A', '5712/1A-001'],
  );
  assert.equal(result.analytics_price_usd, 168000);
  assert.equal(result.price_normalization, 'EXPLICIT_USD_FROM_REFERENCE_LINE');
});

test('does not treat a repeated reference after HKD as the HKD amount', () => {
  const result = normalizeMarketRow(
    {
      price_usd: 365000,
      raw_message: '15202bc salmon 2019 used full set 855k hkd\n15202bc salmon 2021 Brand New 885k hkd',
    },
    '15202BC',
  );
  assert.equal(result.analytics_price_usd, 109615);
  assert.equal(result.price_normalization, 'EXPLICIT_HKD_FROM_REFERENCE_LINE');
});

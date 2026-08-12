'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMarketRow } = require('../api/_lib/market-row-normalization.cjs');

test('repairs HKD stored as USD using the exact reference line', () => {
  const result = normalizeMarketRow({ price_usd: 325000, raw_message: '52506 Ice Blue - HKD 325k\n52508 Black - HKD 296k' }, '52506');
  assert.equal(result.analytics_price_usd, 41667);
  assert.equal(result.price_normalization, 'EXPLICIT_HKD_FROM_REFERENCE_LINE');
  assert.equal(result.analytics_currency_status, 'CURRENCY_RATE_UNVERIFIED');
  assert.equal(result.analytics_fx_rate, 7.8);
  assert.equal(result.analytics_fx_source, 'LEGACY_FIXED_RATE_REVIEW_ONLY');
  assert.equal(result.analytics_fx_date, null);
  assert.equal(result.source_price_amount, 325000);
  assert.equal(result.source_currency, 'HKD');
});

test('prefers an explicit USD equivalent on the exact reference line', () => {
  const result = normalizeMarketRow({ price_usd: 313000, raw_message: 'New 52506 N5 Hkd313K Usdt40.5K' }, '52506');
  assert.equal(result.analytics_price_usd, 40500);
  assert.equal(result.price_normalization, 'EXPLICIT_USD_FROM_REFERENCE_LINE');
  assert.equal(result.analytics_currency_status, 'VERIFIED');
  assert.equal(result.source_price_amount, 40500);
  assert.equal(result.source_currency, 'USD');
});

test('does not parse a trailing production year as the USD price', () => {
  const result = normalizeMarketRow({
    price_usd: 2025,
    raw_message: '7118/1200a blue 84000 USD 2025 rdy now',
  }, '7118/1200A');
  assert.equal(result.analytics_price_usd, 84000);
  assert.equal(result.price_normalization, 'EXPLICIT_USD_FROM_REFERENCE_LINE');
  assert.equal(result.analytics_currency_status, 'VERIFIED');
});

test('does not borrow a price from a different reference in the bundle', () => {
  const result = normalizeMarketRow({ price_usd: 26000, raw_message: '52506 Ice Blue price on request\n52508 Black HKD 296k' }, '52506');
  assert.equal(result.analytics_price_usd, 26000);
  assert.equal(result.price_normalization, null);
  assert.equal(result.analytics_currency_status, 'CURRENCY_UNVERIFIED');
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
test('recovers an explicit HKD price when the stored USD price is null', () => {
  const result = normalizeMarketRow({
    price_usd: null,
    price_raw: null,
    currency: null,
    raw_message: '5712/1A blue 2024 HDK 871k',
  }, '5712/1A');
  assert.equal(result.analytics_price_usd, 111667);
  assert.equal(result.price_normalization, 'EXPLICIT_HKD_FROM_REFERENCE_LINE');
});

test('keeps an unsupported structured currency unresolved', () => {
  const result = normalizeMarketRow({
    price_usd: null,
    price_raw: 100000,
    currency: 'CNY',
    raw_message: '5712/1A blue full set',
  }, '5712/1A');
  assert.equal(result.analytics_price_usd, null);
  assert.equal(result.price_normalization, null);
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

test('does not borrow a later emoji-bullet price from the same physical line', () => {
  const result = normalizeMarketRow(
    { price_usd: 480000, raw_message: '🚀 5712/1R 5/2025 NEW HKD 1.73m 🚀 5303R 5/2025 NEW 1.05m usdt' },
    '5712/1R',
  );
  assert.equal(result.analytics_price_usd, 221795);
  assert.equal(result.price_normalization, 'EXPLICIT_HKD_FROM_REFERENCE_LINE');
});

test('defaults bare-dollar to USD while withholding non-pegged currency without dated FX', () => {
  const ambiguous = normalizeMarketRow({ price_usd: 25000, raw_message: '5712/1A blue $25k' }, '5712/1A');
  const eur = normalizeMarketRow({ price_usd: 27000, raw_message: '5712/1A blue EUR 25k' }, '5712/1A');
  assert.equal(ambiguous.analytics_currency_status, 'VERIFIED');
  assert.equal(ambiguous.analytics_price_usd, 25000);
  assert.equal(ambiguous.price_normalization, 'USD_DEFAULTED_BY_POLICY');
  assert.equal(eur.analytics_currency_status, 'CURRENCY_RATE_UNVERIFIED');
});

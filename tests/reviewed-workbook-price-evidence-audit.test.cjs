'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  classifyPriceEvidence,
  historicallyQualifiedPrice,
} = require('../tools/intake/audit-reviewed-workbook-price-evidence.cjs');

test('classifies exact explicit USD and USDT as review candidates', () => {
  const usd = classifyPriceEvidence({ raw_message: 'WTS TAG Heuer USD 6,500' }, 'WTS');
  assert.equal(usd.classification, 'EXPLICIT_USD_USDT_REVIEW_CANDIDATE');
  assert.equal(usd.proposed_price_usd, 6500);
  const usdt = classifyPriceEvidence({ raw_message: 'available 8k USDT' }, 'WTS');
  assert.equal(usdt.classification, 'EXPLICIT_USD_USDT_REVIEW_CANDIDATE');
  assert.equal(usdt.proposed_price_usd, 8000);
});

test('bare dollar and retail values remain deferred', () => {
  assert.equal(
    classifyPriceEvidence({ raw_message: 'WTS Carrera $6,500' }, 'WTS').classification,
    'AMBIGUOUS_BARE_DOLLAR',
  );
  assert.equal(
    classifyPriceEvidence({ raw_message: 'MSRP USD 9,000' }, 'WTS').classification,
    'RETAIL_APPRAISAL_OR_NON_ASKING',
  );
});

test('retail amount does not hide a later asking amount', () => {
  const result = classifyPriceEvidence({
    raw_message: 'Retail USD 9,000; our price USD 4,500',
  }, 'WTS');
  assert.equal(result.classification, 'EXPLICIT_USD_USDT_REVIEW_CANDIDATE');
  assert.equal(result.proposed_price_usd, 4500);
});

test('named dated non-USD conversion is a sidecar review candidate', () => {
  const result = classifyPriceEvidence({
    raw_message: 'WTS Breguet HKD 50,000', source_currency: 'HKD',
    normalized_price_usd: 6410, fx_source: 'ECB', fx_rate_date: '2026-08-11',
  }, 'WTS');
  assert.equal(result.classification, 'NAMED_DATED_FX_REVIEW_CANDIDATE');
  assert.equal(result.source_amount, 50000);
  assert.equal(result.proposed_price_usd, 6410);
});

test('WTB overrides any price and remains demand', () => {
  const result = classifyPriceEvidence({ raw_message: 'WTB TAG Heuer USD 5,000' }, 'WTB');
  assert.equal(result.classification, 'WTB_OVERRIDE');
  assert.equal(result.recommendation, 'KEEP_AS_DEMAND');
});

test('historical qualification census remains reproducible after stricter currency matching', () => {
  const source = {
    raw_message: 'TAG Heuer Carrera WTS HKD 50,000', intent: 'WTS',
    source_currency: 'USD', normalized_price_usd: 50000,
    fx_source: 'SOURCE_STATED', fx_rate_date: '2026-08-11',
  };
  assert.equal(historicallyQualifiedPrice(
    source, { price_research_status: 'ELIGIBLE' }, 'WTS',
  ), true);
});

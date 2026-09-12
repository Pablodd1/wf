'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractPriceCandidates, extractPriceObservations, extractReference } = require('../api/_lib/normalization-v4.cjs');

test('SAR inside a complete watch reference cannot establish currency for its bare-dollar ask', () => {
  const source = 'WTS Rolex 126755SARU full set. Asking $113K';
  const candidates = extractPriceCandidates(source);
  assert.deepEqual(extractPriceObservations(source), []);
  assert.equal(extractReference(source), '126755SARU');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].raw_price_text, '$113K');
  assert.equal(candidates[0].amount_original, 113000);
  assert.equal(candidates[0].currency_original, null);
  assert.equal(candidates[0].amount_usd, null);
  assert.equal(candidates[0].review_reason, 'CURRENCY_AMBIGUOUS');
  assert.equal(source.slice(candidates[0].position.start, candidates[0].position.end), '$113K');
});

test('a currency suffix cannot stop inside a longer reference or word', () => {
  for (const source of ['126755SARU', '126755sarU', '43000AEDX', '18000EUROPEAN', '12500USDTX']) {
    assert.deepEqual(extractPriceObservations(source), [], source);
    assert.ok(extractPriceCandidates(source).every(candidate => candidate.evidence_status !== 'AUTO_APPROVED'), source);
  }
});

test('standalone and compact SAR/AED currency prices retain their exact source spans', () => {
  for (const [source, amount, currency] of [
    ['SAR 126755', 126755, 'SAR'], ['126755 SAR', 126755, 'SAR'], ['126755SAR,', 126755, 'SAR'],
    ['AED 43000', 43000, 'AED'], ['43000 AED', 43000, 'AED'], ['43000AED.', 43000, 'AED'],
    ['50K AED', 50000, 'AED'], ['12.5k USDT', 12500, 'USDT'],
  ]) {
    const prices = extractPriceObservations(source);
    assert.equal(prices.length, 1, source);
    assert.equal(prices[0].amount_original, amount, source);
    assert.equal(prices[0].currency_original, currency, source);
    assert.equal(prices[0].evidence_status, 'AUTO_APPROVED', source);
    assert.equal(source.slice(prices[0].position.start, prices[0].position.end), prices[0].raw_price_text, source);
    if (['SAR', 'AED'].includes(currency)) assert.equal(prices[0].amount_usd, null, source);
  }
});

test('an explicit price after a SARU reference remains separate evidence', () => {
  const source = 'WTS Rolex 126755SARU. Asking 121000 USD';
  const prices = extractPriceObservations(source);
  assert.equal(prices.length, 1);
  assert.equal(prices[0].amount_original, 121000);
  assert.equal(prices[0].currency_original, 'USD');
  assert.equal(prices[0].raw_price_text, '121000 USD');
  assert.equal(extractReference(source), '126755SARU');
});

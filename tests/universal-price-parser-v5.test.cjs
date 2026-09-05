'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractPriceCandidates,
  extractPriceObservations,
  parseNumber,
  segmentDealerMessage,
} = require('../api/_lib/normalization-v4.cjs');

const ADVERSARIAL_CASES = [
  'Rolex 126500LN',
  'Rolex 116500',
  'AP 15500ST',
  'AP 26240ST',
  'RM11-03',
  'RM67-01',
  'RM 001',
  'Patek 5712/1A',
  'Patek 5980/1R',
  'year 2025',
  'date 2025/08/24',
  'phone +852 9123 4567',
  'phone 91 234 567',
  'stock ID 87351',
  'dealer ID 123456',
  'serial 12345678',
  'quantity 10 pcs',
  'case 41mm',
  'weight 120g',
  'limited edition 25/50',
  '116688 37000',
  'Rolex 126508 85K',
  'Rolex 126333 $14,500',
  'Rolex 126333 HK 115',
  'Rolex 126333 115K HK',
  'Rolex 126333 115 / HK',
];

test('26 adversarial reference, phone, ID, and ambiguous-price cases produce zero auto-approved prices', () => {
  assert.equal(ADVERSARIAL_CASES.length, 26);
  for (const raw of ADVERSARIAL_CASES) {
    assert.deepEqual(extractPriceObservations(raw), [], raw);
    assert.ok(
      extractPriceCandidates(raw).every(candidate => candidate.evidence_status === 'REVIEW_REQUIRED'),
      raw,
    );
  }
});

test('explicit supported currency forms are auto-approved without foreign fixed-rate conversion', () => {
  const cases = [
    ['USD 12500', 12_500, 'USD'],
    ['12500 USD', 12_500, 'USD'],
    ['USDT 12.5k', 12_500, 'USDT'],
    ['12.5k USDT', 12_500, 'USDT'],
    ['HKD 115000', 115_000, 'HKD'],
    ['HKD 115K', 115_000, 'HKD'],
    ['HK$115000', 115_000, 'HKD'],
    ['EUR 18K', 18_000, 'EUR'],
    ['€18000', 18_000, 'EUR'],
    ['GBP 14.5K', 14_500, 'GBP'],
    ['£14500', 14_500, 'GBP'],
    ['CHF 20K', 20_000, 'CHF'],
    ['SGD 28K', 28_000, 'SGD'],
    ['JPY 2.5M', 2_500_000, 'JPY'],
    ['CNY 85K', 85_000, 'CNY'],
    ['RMB 85K', 85_000, 'CNY'],
    ['AED 50K', 50_000, 'AED'],
    ['MYR 500K', 500_000, 'MYR'],
  ];

  for (const [raw, amount, currency] of cases) {
    const observations = extractPriceObservations(raw);
    assert.equal(observations.length, 1, raw);
    assert.equal(observations[0].amount_original, amount, raw);
    assert.equal(observations[0].currency_original, currency, raw);
    assert.equal(observations[0].evidence_status, 'AUTO_APPROVED', raw);
    assert.equal(observations[0].amount_usd, ['USD', 'USDT'].includes(currency) ? amount : null, raw);
  }
});

test('safe decimal comma K/M notation does not inflate by two orders of magnitude', () => {
  assert.equal(parseNumber('1,71', 'M'), 1_710_000);
  assert.equal(parseNumber('12,5', 'K'), 12_500);
  assert.equal(extractPriceObservations('1,71M HKD')[0].amount_original, 1_710_000);
  assert.equal(extractPriceObservations('EUR 12,5K')[0].amount_original, 12_500);
});

test('fractional explicit USDT remains fractional rather than rounding to a whole token', () => {
  assert.equal(extractPriceObservations('USDT 12.5')[0].amount_original, 12.5);
  assert.equal(extractPriceObservations('12.5 USDT')[0].amount_original, 12.5);
});

test('multiple explicit prices preserve spans and become review-only', () => {
  const raw = 'Rolex 126500LN HKD 100000 / USDT 13000';
  assert.deepEqual(extractPriceObservations(raw), []);
  const candidates = extractPriceCandidates(raw);
  assert.deepEqual(candidates.map(item => [item.amount_original, item.currency_original]), [
    [100_000, 'HKD'],
    [13_000, 'USDT'],
  ]);
  assert.ok(candidates.every(item => item.review_reason === 'MULTIPLE_PRICE_AMBIGUITY'));
  assert.ok(candidates.every(item => item.raw_price_text && Number.isInteger(item.position.start)));
});

test('one price covering multiple references is bundle-review evidence, not an approved child price', () => {
  const raw = 'WTS Rolex 126500LN and Patek 5712/1A USD 30000';
  assert.deepEqual(extractPriceObservations(raw), []);
  const [candidate] = extractPriceCandidates(raw);
  assert.equal(candidate.review_reason, 'BUNDLE_PRICE_AMBIGUITY');

  const listings = segmentDealerMessage(raw);
  assert.ok(listings.every(listing => listing.prices.length === 0));
  assert.ok(listings.some(listing => listing.price_review_reasons.includes('BUNDLE_PRICE_AMBIGUITY')));
});

test('existing valid explicit price evidence is read-only input to the parser', () => {
  const raw = 'Omega 130.30.39.21.03.001 asking EUR 3900';
  const before = raw;
  const [observation] = extractPriceObservations(raw);
  assert.equal(raw, before);
  assert.equal(observation.raw_price_text, 'EUR 3900');
  assert.equal(observation.parser_version, 'price-parser-v5-shadow');
});

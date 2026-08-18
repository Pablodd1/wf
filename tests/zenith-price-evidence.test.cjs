'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractPriceObservations } = require('../api/_lib/normalization-v4.cjs');
const { selectZenithPriceEvidence } = require('../api/_lib/zenith-price-evidence.cjs');

test('explicit euro symbols remain prices even when the amount resembles a year', () => {
  assert.equal(extractPriceObservations('Zenith 02.0500.420 - €1950')[0].amount_original, 1950);
  assert.equal(extractPriceObservations('Zenith 02.0500.420 - 1950€')[0].amount_original, 1950);
});

test('selects the actual ask instead of retail or list price', () => {
  assert.deepEqual(selectZenithPriceEvidence(
    'Zenith 06.9100.9004/21.I001 List price :€33.000 My price €14.000',
  ), {
    amount_original: 14000,
    currency_original: 'EUR',
    currency_evidence: 'explicit_line_currency',
    raw_price_text: '€14.000',
  });
  assert.equal(selectZenithPriceEvidence(
    'Zenith 97.9100.9004/02.I001 Retail $ 18,600 (-40% off) Item 2398538 $11,160',
  ).amount_original, 11160);
});

test('prefers an explicit USD equivalent and recognizes source dollar forms', () => {
  assert.equal(selectZenithPriceEvidence(
    'Zenith 10.9000.9004/M99.R939 100000hkd 13300usdt',
  ).amount_original, 13300);
  assert.equal(selectZenithPriceEvidence('Zenith 49.9010.9004/01.R947 $10,250+ label').amount_original, 10250);
  assert.equal(selectZenithPriceEvidence('Zenith 03.A780.400 9,020$').amount_original, 9020);
  assert.equal(selectZenithPriceEvidence('Zenith 95.9600.3620 Here for 💲7500').amount_original, 7500);
});

test('does not manufacture a price from references, years, or item numbers', () => {
  assert.equal(selectZenithPriceEvidence('Zenith 49.9000.9004/78.R782 anyone have unworn'), null);
  assert.equal(selectZenithPriceEvidence('Zenith 18.2215.8805/36.C713 Limited No.80 Only the watch'), null);
});

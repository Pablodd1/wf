'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyPair, stripDateTokens } = require('../tools/duplicate-audit/duplicate-signatures.cjs');

const base = {
  brand: 'Patek Philippe',
  reference: '5712/1A',
  dial_color: 'Blue',
  condition: 'Used',
  listing_type: 'WTS',
  seller_phone: '+852 6123 4567',
  price_usd: 93000,
};

test('identifies an exact raw-message repeat despite a new chat timestamp', () => {
  const first = { ...base, raw_message: '[7/16, 9:00 AM] +852 6123 4567: 5712/1A Blue 2022 Used USD 93k' };
  const second = { ...base, raw_message: '[7/17, 10:00 AM] +852 6123 4567: 5712/1A Blue 2022 Used USD 93k' };
  assert.equal(classifyPair(first, second).type, 'EXACT_RAW_MESSAGE');
});

test('classifies a changed watch date as date-shifted, not automatically identical evidence', () => {
  const first = { ...base, raw_message: '+852 6123 4567: 5712/1A Blue 5/2025 Used USD 93k' };
  const second = { ...base, raw_message: '+852 6123 4567: 5712/1A Blue 6/2026 Used USD 93k' };
  assert.equal(classifyPair(first, second).type, 'DATE_SHIFTED_REPOST');
});

test('retains a price change as a historical price update', () => {
  const first = { ...base, raw_message: '5712/1A Blue Used', price_usd: 93000 };
  const second = { ...base, raw_message: '5712/1A Blue Used revised', price_usd: 90000 };
  const result = classifyPair(first, second);
  assert.equal(result.type, 'PRICE_UPDATE_REPOST');
  assert.equal(result.suppressFromAnalytics, false);
});

test('does not auto-collapse matching stock from different dealers', () => {
  const first = { ...base, seller_phone: '+852 6123 4567', raw_message: '5712/1A Blue USD 93k' };
  const second = { ...base, seller_phone: '+852 6999 9999', raw_message: 'different listing text' };
  const result = classifyPair(first, second);
  assert.equal(result.type, 'POSSIBLE_SHARED_INVENTORY');
  assert.equal(result.suppressFromAnalytics, false);
});

test('does not use a generic ingestion source as dealer identity', () => {
  const first = { ...base, seller_phone: '', source: 'MYSQL_RAW', raw_message: '5712/1A Blue Used USD 93k' };
  const second = { ...base, seller_phone: '', source: 'MYSQL_RAW', raw_message: '5712/1A Blue Used USD 93k' };
  const result = classifyPair(first, second);
  assert.equal(result.type, 'EXACT_RAW_MESSAGE');
  assert.equal(result.suppressFromAnalytics, false);
});

test('date token normalization preserves price and reference', () => {
  const value = stripDateTokens('5712/1A 7/2026 USD 93,000');
  assert.match(value, /5712\/1A/);
  assert.match(value, /93,000/);
  assert.match(value, /<DATE>/);
});

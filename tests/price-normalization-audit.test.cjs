'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { auditRow, classifyMismatch } = require('../tools/price-quality/audit-price-normalization.cjs');

test('flags stale stored USD when exact reference line contains explicit USD', () => {
  const finding = auditRow({
    id: '8ea77591-a76d-4e86-b153-2c79f7c35851',
    brand: 'Patek Philippe',
    reference: '5712/1R',
    dial_color: 'Blue',
    condition: 'Used',
    listing_type: 'WTS',
    price_usd: 31917,
    currency: 'HKD',
    raw_message: '5712/1R Used 2024 Fullset HKD1,920,000 / USD249,350',
  });

  assert.equal(finding.normalized_price_usd, 249350);
  assert.equal(finding.stored_price_usd, 31917);
  assert.equal(finding.price_normalization, 'EXPLICIT_USD_FROM_REFERENCE_LINE');
  assert.equal(finding.severity, 'high');
  assert.ok(finding.flags.includes('LIKELY_LEGACY_HKD_DOUBLE_CONVERSION'));
  assert.ok(finding.flags.includes('MAJOR_PRICE_DELTA'));
});

test('flags stored low-price luxury floor issue when raw HKD line normalizes higher', () => {
  const finding = auditRow({
    id: 'low-stored-price',
    brand: 'Rolex',
    reference: '52506',
    dial_color: 'Ice Blue',
    condition: 'New',
    listing_type: 'WTS',
    price_usd: 244,
    currency: 'HKD',
    raw_message: '52506 Ice Blue HKD 313K',
  });

  assert.equal(finding.normalized_price_usd, 40128);
  assert.equal(finding.severity, 'high');
  assert.ok(finding.flags.includes('STORED_PRICE_BELOW_LUXURY_FLOOR'));
  assert.ok(finding.flags.includes('MAJOR_PRICE_DELTA'));
});

test('keeps minor mismatches low severity', () => {
  const result = classifyMismatch({ price_usd: 100000 }, 103000, 'EXPLICIT_USD_FROM_REFERENCE_LINE');
  assert.equal(result.severity, 'low');
  assert.equal(result.delta_pct, 3);
  assert.ok(result.flags.includes('MINOR_PRICE_DELTA'));
});

test('marks repeated-reference evidence blocks for review', () => {
  const finding = auditRow({
    id: 'repeated-reference',
    brand: 'Audemars Piguet',
    reference: '15202BC',
    price_usd: 365000,
    raw_message: '15202bc salmon 2019 used full set 855k hkd\n15202bc salmon 2021 Brand New 885k hkd',
  });

  assert.equal(finding.normalized_price_usd, 109615);
  assert.ok(finding.flags.includes('REPEATED_REFERENCE_BLOCK_REVIEW'));
});

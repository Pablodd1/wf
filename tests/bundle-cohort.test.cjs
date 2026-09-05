'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  adjacentDialClaim,
  buildStagingChildren,
  comparePersisted,
  deterministicUuid,
  specialDialClaim,
} = require('../tools/multilisting/bundle-cohort.cjs');

test('uses a dial immediately following the reference and flags inherited conflicts', () => {
  assert.equal(adjacentDialClaim('15202bc salmon 2019 used full set 855k hkd', '15202BC'), 'Salmon');
  const source = {
    id: '00000000-0000-4000-8000-000000000004',
    raw_message: '15202bc salmon 2019 used full set 855k hkd',
    listing_type: 'WTS',
  };
  const rows = buildStagingChildren(source, {
    source_listing_type: 'WTS',
    proposed_candidates: [{
      raw_line: source.raw_message,
      brand: 'Audemars Piguet',
      reference: '15202BC',
      dial_color: 'Black',
      dial_evidence: 'source_record',
      condition: 'Used',
      prices: [{ amount_original: 855000, amount_usd: 109615, currency_original: 'HKD', is_primary: true }],
    }],
  });
  assert.equal(rows[0].dial_color, 'Salmon');
  assert.equal(rows[0].field_confidence.dial_evidence, 'exact_raw_adjacent_to_reference');
  assert.ok(rows[0].flags.includes('DIAL_RAW_SOURCE_CONFLICT'));
});

test('recognizes defensible dealer dial shorthand adjacent to a reference', () => {
  const cases = [
    ['124200 Pistachio N9/2025y 62k hkd', '124200', 'Pistachio'],
    ['126300 Wim jub 2025 hkd 80k', '126300', 'Wimbledon'],
    ['116500LN Blk 2022 230k hkd', '116500LN', 'Black'],
    ['5712/1A Tiff 2021 1.8m hkd', '5712/1A', 'Tiffany Blue'],
    ['228238 Mete 2024 500k hkd', '228238', 'Meteorite'],
    ['279171G YML 2025 130k hkd', '279171G', 'Yellow Mother of Pearl'],
  ];
  for (const [raw, reference, expected] of cases) {
    assert.equal(adjacentDialClaim(raw, reference), expected, raw);
  }
});

test('preserves Tiffany shorthand as a market-significant dial claim', () => {
  assert.equal(adjacentDialClaim('5712/1A Tiffany 2021 full set 1.88m hkd', '5712/1A'), 'Tiffany Blue');
  assert.equal(specialDialClaim('126000-0006 Tiffany naked HKD82k'), 'Tiffany Blue');
  assert.equal(specialDialClaim('126000 blue dial HKD82k'), null);
});

const source = {
  id: 'source-1',
  raw_message: 'Rolex\n126500LN White HKD 283000\n126610LN Black HKD 114000',
  listing_type: 'WTS',
};
const candidates = [
  {
    brand: 'Rolex', reference: '126500LN', dial_color: 'White', listing_type: 'WTS',
    raw_line: '126500LN White HKD 283000',
    prices: [{ is_primary: true, amount_original: 283000, amount_usd: 36282, currency_original: 'HKD', currency_evidence: 'explicit_line_currency' }],
  },
  {
    brand: 'Rolex', reference: '126610LN', dial_color: 'Black', listing_type: 'WTS',
    raw_line: '126610LN Black HKD 114000',
    prices: [{ is_primary: true, amount_original: 114000, amount_usd: 14615, currency_original: 'HKD', currency_evidence: 'explicit_line_currency' }],
  },
];

test('builds deterministic staging children with exact parent lineage', () => {
  const shadow = { source_listing_type: 'WTS', proposed_candidates: candidates };
  const first = buildStagingChildren(source, shadow);
  const second = buildStagingChildren(source, shadow);
  assert.deepEqual(first, second);
  assert.equal(first.length, 2);
  assert.equal(first[0].source, 'bundle_child:source-1');
  assert.equal(first[0].field_confidence.exact_raw_lineage, true);
  assert.deepEqual(first[0].flags.slice(-2), ['BUNDLE_PARENT:source-1', 'BUNDLE_INDEX:1']);
  assert.equal(first[0].verdict, 'PENDING');
});

test('keeps unresolved children pending with explicit review flags', () => {
  const rows = buildStagingChildren(source, {
    source_listing_type: 'WTS',
    proposed_candidates: [{ raw_line: 'not present', brand: 'Rolex', reference: '126500LN', listing_type: 'WTS', prices: [] }],
  });
  assert.ok(rows[0].flags.includes('RAW_LINEAGE_MISSING'));
  assert.ok(rows[0].flags.includes('DIAL_REQUIRED'));
  assert.ok(rows[0].flags.includes('PRICE_REQUIRED'));
});

test('uses stable UUIDs and exact persisted reconciliation', () => {
  assert.equal(deterministicUuid('same'), deterministicUuid('same'));
  const expected = {
    normalization_version: 'v4.2-line-condition', candidate_count: 2,
    proposed_candidates: candidates, change_flags: ['BUNDLE_SPLIT_REQUIRED'],
  };
  assert.equal(comparePersisted(expected, { ...expected }).matches, true);
  assert.equal(comparePersisted(expected, { ...expected, candidate_count: 1 }).matches, false);
});

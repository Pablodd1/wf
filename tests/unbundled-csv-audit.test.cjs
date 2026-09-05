'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { expectedListingId, auditRow } = require('../tools/multilisting/audit-unbundled-csv.cjs');

function report() {
  return {
    rowsScanned: 0,
    detailedRowsScanned: 0,
    issues: {},
    examples: {},
    coverage: {
      rawLine: 0, sourceCreatedAt: 0, sellerName: 0, sellerPhone: 0,
      dealer: 0, imageUrl: 0, catalogConfirmed: 0, catalogDialConfirmed: 0,
    },
    _listingIds: new Set(),
    _childKeys: new Set(),
  };
}

test('uses source id plus zero-padded candidate index as the stable child key', () => {
  assert.equal(expectedListingId({ source_record_id: 'source-1', candidate_index: '7' }), 'source-1_007');
});

test('detects raw dial conflicts without promoting the edited value', () => {
  const result = report();
  auditRow({
    listing_id: 'source-1_000',
    source_record_id: 'source-1',
    candidate_index: '0',
    brand: 'Audemars Piguet',
    reference: '15202BC',
    raw_line: '15202bc salmon 2019 used full set 855k hkd',
    condition: 'Used',
    price_raw: '855000',
    price_currency: 'HKD',
    price_usd: '109615',
    listing_type: 'WTS',
    dial_color: 'Black',
    source_created_at: '2025-12-29T05:15:38Z',
  }, result, 1000);
  assert.equal(result.issues.dial_raw_source_conflict, 1);
  assert.equal(result.examples.dial_raw_source_conflict[0].rawClaim, 'Salmon');
  assert.equal(result.examples.dial_raw_source_conflict[0].exported, 'Black');
});

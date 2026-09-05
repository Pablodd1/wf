'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { COLUMNS, csvEscape, toExportRow } = require('../tools/external-audit/export-live-price-audit-input.cjs');

test('live external audit export preserves the immutable ID and omits seller PII', () => {
  const row = toExportRow({
    id: 'live-id', raw_message: 'For sale, 5712/1A USD 90000', brand: 'Patek Philippe',
    reference: '5712/1A', listing_type: 'WTS', price_usd: 90000,
    seller_name: 'Private Dealer', seller_phone: '+123', flags: ['DUPLICATE'],
  });
  assert.equal(row.source_record_id, 'live-id');
  assert.equal(row.seller_lineage_present, true);
  assert.equal(Object.hasOwn(row, 'seller_name'), false);
  assert.equal(Object.hasOwn(row, 'seller_phone'), false);
  assert.equal(row.duplicate_status, 'DUPLICATE_FLAGGED');
  assert.ok(COLUMNS.includes('source_record_id'));
});

test('CSV escaping protects embedded commas and line breaks', () => {
  assert.equal(csvEscape('a,b'), '"a,b"');
  assert.equal(csvEscape('a\nb'), '"a\nb"');
});

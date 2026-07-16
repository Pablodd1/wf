'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { deduplicateReposts } = require('../api/_lib/repost-deduplication.cjs');

test('collapses a dealer repost while retaining the newest observation', () => {
  const rows = [
    { id: 'new', brand: 'Patek Philippe', reference: '3712/1A', dial_color: 'Blue', condition: 'Used', price_usd: 130769, raw_message: '[7/16, 9:00 AM] +852 6123 4567: 3712/1A Blue HKD 1.02m' },
    { id: 'old', brand: 'Patek Philippe', reference: '3712/1A', dial_color: 'Blue', condition: 'Used', price_usd: 130769, raw_message: '[7/10, 8:00 AM] +852 6123 4567: 3712/1A Blue HKD 1.02m' },
  ];
  const result = deduplicateReposts(rows);
  assert.deepEqual(result.uniqueRows.map(row => row.id), ['new']);
  assert.equal(result.repostRows[0].duplicate_of_id, 'new');
});

test('does not merge matching offers from different dealers', () => {
  const rows = [
    { id: 'a', brand: 'Rolex', reference: '116500LN', dial_color: 'White', condition: 'New', price_usd: 27000, raw_message: '+852 6123 4567: 116500LN White USD 27000' },
    { id: 'b', brand: 'Rolex', reference: '116500LN', dial_color: 'White', condition: 'New', price_usd: 27000, raw_message: '+852 6999 9999: 116500LN White USD 27000' },
  ];
  assert.equal(deduplicateReposts(rows).uniqueRows.length, 2);
});

test('keeps records without dealer or source text distinct', () => {
  const rows = [
    { id: 'a', brand: 'Rolex', reference: '116500LN', price_usd: 27000 },
    { id: 'b', brand: 'Rolex', reference: '116500LN', price_usd: 27000 },
  ];
  assert.equal(deduplicateReposts(rows).uniqueRows.length, 2);
});

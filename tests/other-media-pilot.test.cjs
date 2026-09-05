'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { records } = require('../tools/mission-images/publish-other-pilot.cjs');

test('publishes only explicitly unnormalized non-watch pilot records', () => {
  const rows = records();
  assert.equal(rows.length, 8);
  assert.ok(rows.every(row => row.listing_type === 'OTHER'));
  assert.ok(rows.every(row => row.verdict === 'HUMAN'));
  assert.ok(rows.every(row => row.flags.normalization_status === 'UNNORMALIZED'));
  assert.ok(rows.every(row => row.price_usd === null && row.reference === null));
  assert.ok(rows.every(row => row.has_images && row.thumbnail_url));
});

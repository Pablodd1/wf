'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { priorCursor, repeatedCount } = require('../tools/audit/sample-raw-first-high-cardinality.cjs');

test('bounded sampler identifies repeated emissions and prior page cursor', () => {
  assert.equal(repeatedCount(['a', 'a', 'b', 'a']), 2);
  const checkpoint = { page_files: {
    first: { dataset: 'raw', shard: 3, page: 1, last_id: 'a' },
    second: { dataset: 'raw', shard: 3, page: 2, last_id: 'b' },
  } };
  assert.equal(priorCursor(checkpoint, checkpoint.page_files.second), 'a');
  assert.equal(priorCursor(checkpoint, checkpoint.page_files.first), null);
});

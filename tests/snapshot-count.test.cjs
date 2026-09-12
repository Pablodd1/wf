'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readSnapshotCount } = require('../api/_lib/snapshot-count.cjs');

test('snapshot count forwards exact identity/filters and accepts bigint wire representations', async () => {
  const params = { p_snapshot_id: 'synthetic-snapshot', p_brand: 'Synthetix', p_images_only: true };
  for (const data of [0, 50, '0', '50']) {
    const client = { rpc: async (name, args) => {
      assert.equal(name, 'get_trading_floor_snapshot_count');
      assert.deepEqual(args, params);
      return { data, error: null };
    } };
    assert.equal(await readSnapshotCount(client, 'get_trading_floor_snapshot_count', params), Number(data));
  }
});
test('absent, malformed, negative, fractional and overflowing counts fail closed', async () => {
  for (const data of [null, undefined, [], {}, '', ' ', '-1', '-0', -1, 1.5, '1.5', false, NaN, Infinity, '9007199254740993']) {
    await assert.rejects(readSnapshotCount({ rpc: async () => ({ data }) }, 'count', {}),
      { code: 'INVALID_SNAPSHOT_TOTAL' });
  }
});
test('expired snapshot count maps to HTTP 400, transport/database errors are not turned into zero', async () => {
  await assert.rejects(readSnapshotCount({ rpc: async () => ({ error: {
    code: '22023', message: 'snapshot_expired: expired snapshot',
  } }) }, 'count', {}), { statusCode: 400 });
  const failure = new Error('synthetic database failure');
  await assert.rejects(readSnapshotCount({ rpc: async () => ({ error: failure }) }, 'count', {}), failure);
});

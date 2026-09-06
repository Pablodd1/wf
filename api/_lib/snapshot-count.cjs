'use strict';
const { mapSnapshotRpcError } = require('./canary-keyset.cjs');

async function readSnapshotCount(client, rpc, params) {
  const { data, error } = await client.rpc(rpc, params);
  if (error) throw mapSnapshotRpcError(error) || error;
  // A missing count is not an empty snapshot. PostgREST may serialize bigint as text.
  if (!((typeof data === 'number' && Number.isSafeInteger(data) && data >= 0)
    || (typeof data === 'string' && /^(0|[1-9]\d*)$/.test(data) && Number.isSafeInteger(Number(data))))) {
    const failure = new Error('Invalid snapshot total');
    failure.code = 'INVALID_SNAPSHOT_TOTAL';
    throw failure;
  }
  return Number(data);
}
module.exports = { readSnapshotCount };

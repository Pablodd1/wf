'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runReproducibleBackfill } = require('../tools/mariadb-live/reproducible-proposal-hash-backfill.cjs');
const { capturedFixture } = require('./helpers/captured-fixture.cjs');
const { normalizeAuthoritativeRow } = require('../tools/mariadb-live/authoritative-evidence-normalizer.cjs');

const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-only-key'
};

function rawRow(sourceId = 'source-1') {
  const raw = capturedFixture({
    id: sourceId,
    source_system: 'OceanDigital MariaDB',
    source_database: 'thecollective_inventory',
    source_table: 'auctions',
    source_id: sourceId,
    source_record_id: 'mysql_auctions_' + sourceId,
    source_created_on: '2026-04-20T10:00:00.000Z',
    source_hash: 'a'.repeat(64),
    raw_message: 'WTS Rolex Daytona 116500LN 2022 28000 USD',
    raw_payload: {
      type: 'sale',
      title: 'WTS Rolex Daytona 116500LN 2022 28000 USD',
      brand: 'Rolex',
      model: 'Daytona',
      reference: '116500LN'
    },
    captured_at: '2026-08-29T12:00:00.000Z'
  });
  raw.stored_proposal = { ...normalizeAuthoritativeRow(raw), proposal_hash: null };
  return raw;
}

test('hash-only backfill refuses different stored facts without issuing a write', async () => {
  const row = rawRow();
  row.stored_proposal.original_price_amount = 999;
  let calls = 0;
  await assert.rejects(runReproducibleBackfill(env, { callRpc: async (_u, _k, name) => {
    calls += 1;
    assert.equal(name, 'get_mariadb_proposals_missing_or_invalid_hash');
    return [row];
  } }), /BACKFILL_RENORMALIZATION_REQUIRED/);
  assert.equal(calls, 1);
});

test('hash-only backfill requires stored proposal evidence', async () => {
  const row = rawRow();
  delete row.stored_proposal;
  await assert.rejects(runReproducibleBackfill(env, { callRpc: async () => [row] }),
    /BACKFILL_RENORMALIZATION_REQUIRED/);
});

test('hash backfill migration selects only missing/invalid hashes and has no insert path', () => {
  const migration = fs.readFileSync(
    path.resolve('supabase/migrations/20260830220000_safe_proposal_hash_backfill.sql'),
    'utf8'
  );
  assert.match(migration, /proposal_hash IS NULL/);
  assert.match(migration, /proposal_hash !~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(migration, /INNER JOIN wf_canonical_staging\.mariadb_raw_source_rows/);
  const backfillBody = migration.split('CREATE OR REPLACE FUNCTION public.backfill_mariadb_proposal_hashes')[1];
  assert.doesNotMatch(backfillBody, /INSERT\s+INTO/i);
  assert.match(backfillBody, /'inserted', 0/);
});

test('hash backfill performs no write when no invalid hashes are selected', async () => {
  const calls = [];
  const result = await runReproducibleBackfill(env, {
    callRpc: async (_url, _key, rpcName) => {
      calls.push(rpcName);
      return [];
    }
  });
  assert.deepEqual(calls, ['get_mariadb_proposals_missing_or_invalid_hash']);
  assert.deepEqual(result, { totalChecked: 0, totalInserted: 0, totalUpdated: 0, totalMissing: 0 });
});

test('hash backfill repairs only selected rows and reconciles inserted=0', async () => {
  const calls = [];
  let selectionCalls = 0;
  const result = await runReproducibleBackfill(env, {
    callRpc: async (_url, _key, rpcName, body) => {
      calls.push(rpcName);
      if (rpcName === 'get_mariadb_proposals_missing_or_invalid_hash') {
        selectionCalls += 1;
        return selectionCalls === 1 ? [rawRow()] : [];
      }
      assert.equal(rpcName, 'backfill_mariadb_proposal_hashes');
      assert.equal(body.p_hashes.length, 1);
      assert.match(body.p_hashes[0].proposal_hash, /^[0-9a-f]{64}$/);
      return { inserted: 0, updated: 1, unchanged: 0, missing: 0, total: 1 };
    }
  });
  assert.deepEqual(calls, [
    'get_mariadb_proposals_missing_or_invalid_hash',
    'backfill_mariadb_proposal_hashes',
    'get_mariadb_proposals_missing_or_invalid_hash'
  ]);
  assert.deepEqual(result, { totalChecked: 1, totalInserted: 0, totalUpdated: 1, totalMissing: 0 });
});

test('hash backfill fails immediately if an RPC reports any insertion', async () => {
  await assert.rejects(
    runReproducibleBackfill(env, {
      callRpc: async (_url, _key, rpcName) => {
        if (rpcName === 'get_mariadb_proposals_missing_or_invalid_hash') return [rawRow('source-2')];
        return { inserted: 1, updated: 0, missing: 0, total: 1 };
      }
    }),
    /requires inserted=0; received 1/
  );
});

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { sourceRecord } = require('../tools/mariadb-live/lib.cjs');
const { run } = require('../tools/mariadb-live/run-two-brand-price-correction.cjs');

function response(body) {
  return { ok: true, status: 200, json: async () => body };
}

function pageRow(id, title, brand, reference) {
  const raw = sourceRecord({ id, type: 'sale', title, brand, reference });
  return {
    listing_id: `00000000-0000-0000-0000-${String(id).padStart(12, '0')}`,
    source_record_id: raw.source_record_id,
    source_hash: raw.raw_sha256,
    canonical_brand: brand,
    normalized_reference: reference,
    raw_payload: raw,
  };
}

test('runner applies one bounded page, advances durable counts, and creates zero staging rows', async () => {
  const fx = { observed_at: '2026-08-11T00:00:00Z', source: 'TEST', usd_per_unit: { HKD: 0.128205 } };
  const rows = [
    pageRow('1', 'Rolex 116688 $37k', 'Rolex', '116688'),
    pageRow('2', 'Patek Philippe 5712/1A 298000 HKD', 'Patek Philippe', '5712/1A'),
  ];
  const queries = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    const sql = body.query;
    queries.push(sql);
    if (sql.includes("'database_gib'")) return response([{ safety: { database_gib: 4, staging_rows: 603678, pending_jobs: 0, failed_jobs: 0 } }]);
    if (sql.includes('FROM staging.mariadb_price_policy_correction_runs AS run')) return response([]);
    if (sql.includes('start_mariadb_two_brand_price_correction')) return response([{ run: {
      correction_run_key: 'correction-v1', normalization_run_key: 'normalized-v1', fx_snapshot: fx,
      census_rows: 2, scanned_rows: 0, corrected_rows: 0, skipped_rows: 0, batch_sequence: 0, status: 'READY',
    } }]);
    if (sql.includes('qnsa_two_brand_price_correction_page')) return response([{ page: {
      previous_cursor: null, records: rows,
    } }]);
    if (sql.includes('apply_mariadb_two_brand_price_policy_batch')) return response([{ result: {
      input_rows: 2, corrected_rows: 2, duplicate_staging_rows_created: 0,
    } }]);
    if (sql.includes('advance_mariadb_two_brand_price_correction')) return response([{ run: {
      census_rows: 2, scanned_rows: 2, corrected_rows: 2, skipped_rows: 0,
      batch_sequence: 1, status: 'COMPLETE', staging_rows_created: 0,
    } }]);
    throw new Error(`Unexpected query: ${sql}`);
  };
  const result = await run({
    env: {
      SUPABASE_ACCESS_TOKEN: 'masked', SUPABASE_PROJECT_REF: 'qnsa', EXPECTED_PROJECT_REF: 'qnsa',
      NORMALIZED_RUN_KEY: 'normalized-v1', CORRECTION_RUN_KEY: 'correction-v1',
      DATABASE_LIMIT_GIB: '16', MINIMUM_HEADROOM_GIB: '2', MAX_PENDING_JOBS: '1000',
      MAX_FAILED_JOBS: '0', CORRECTION_PAGE_SIZE: '500', CORRECTION_MAX_BATCHES: '1',
    },
    fetchImpl,
    fxSnapshot: fx,
  });
  assert.deepEqual(result, {
    status: 'COMPLETE', batches_processed: 1, census_rows: 2, scanned_rows: 2,
    corrected_rows: 2, skipped_rows: 0, staging_row_delta: 0,
  });
  assert.equal(queries.filter(sql => sql.includes("'database_gib'")).length, 3);
  assert.ok(queries.some(sql => sql.includes('LIMIT') === false && sql.includes('apply_mariadb_two_brand_price_policy_batch')));
});

test('runner stops before paging when queue or capacity thresholds fail', async () => {
  let calls = 0;
  await assert.rejects(() => run({
    env: {
      SUPABASE_ACCESS_TOKEN: 'masked', SUPABASE_PROJECT_REF: 'qnsa', EXPECTED_PROJECT_REF: 'qnsa',
      NORMALIZED_RUN_KEY: 'normalized-v1', CORRECTION_RUN_KEY: 'correction-v1',
      DATABASE_LIMIT_GIB: '8', MINIMUM_HEADROOM_GIB: '2', MAX_PENDING_JOBS: '10',
      MAX_FAILED_JOBS: '0', CORRECTION_PAGE_SIZE: '500', CORRECTION_MAX_BATCHES: '1',
    },
    fetchImpl: async () => {
      calls += 1;
      return response([{ safety: { database_gib: 7, staging_rows: 1, pending_jobs: 0, failed_jobs: 0 } }]);
    },
    fxSnapshot: { observed_at: '2026-08-11', source: 'TEST', usd_per_unit: { USD: 1 } },
  }), /stop threshold/);
  assert.equal(calls, 1);
});

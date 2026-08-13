'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { sourceRecord } = require('../tools/mariadb-live/lib.cjs');
const {
  PRICE_CURRENCIES,
  TARGET_BRANDS,
  buildCorrectionPage,
  correctionRecord,
  validateFxSnapshot,
} = require('../tools/mariadb-live/build-three-brand-price-correction.cjs');
const { run } = require('../tools/mariadb-live/run-three-brand-price-correction.cjs');

const ROOT = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const fx = {
  contract: 'wf-dated-fx-snapshot-v1',
  fetched_at: '2026-08-12T12:00:00Z',
  observed_at: '2026-08-11T00:00:00Z',
  source: 'TEST ECB SNAPSHOT',
  source_url: 'https://example.test/fx',
  base: 'USD',
  recognized_but_withheld: ['AED', 'SAR', 'TWD', 'VND'],
  usd_per_unit: {
    USD: 1, EUR: 1.1, HKD: 0.128, GBP: 1.28, CHF: 1.14, CNY: 0.139, JPY: 0.0068, SGD: 0.75,
    KRW: 0.00073, THB: 0.028, CAD: 0.73, AUD: 0.65, NZD: 0.59, MYR: 0.23, IDR: 0.000061,
    INR: 0.012, PHP: 0.017, BRL: 0.18, MXN: 0.054, ZAR: 0.055, SEK: 0.095, NOK: 0.094, DKK: 0.147,
  },
};

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

function response(body) {
  return { ok: true, status: 200, json: async () => body };
}

test('correction builder supports the complete declared currency set and all three brands', () => {
  assert.deepEqual([...TARGET_BRANDS], ['Rolex', 'Patek Philippe', 'Audemars Piguet']);
  assert.deepEqual([...PRICE_CURRENCIES].sort(), [
    'AUD','BRL','CAD','CHF','CNY','DKK','EUR','GBP','HKD','IDR','INR','JPY','KRW','MXN',
    'MYR','NOK','NZD','PHP','SEK','SGD','THB','USD','USDT','ZAR',
  ]);
  assert.equal(validateFxSnapshot(fx), fx);
  assert.throws(() => validateFxSnapshot({ ...fx, usd_per_unit: { USD: 1 } }), /missing EUR/);

  const records = [
    correctionRecord(pageRow('1', 'Rolex 116500LN EUR 25000', 'Rolex', '116500LN'), fx),
    correctionRecord(pageRow('2', 'Patek Philippe 5712/1A HKD 850000', 'Patek Philippe', '5712/1A'), fx),
    correctionRecord(pageRow('3', 'Audemars Piguet 15500ST SGD 45000', 'Audemars Piguet', '15500ST'), fx),
  ];
  assert.equal(records.filter(Boolean).length, 3);
  assert.deepEqual(records.map(record => record.candidate.price.conversion_source), [fx.source, fx.source, fx.source]);
  assert.ok(records.every(record => record.candidate.price.conversion_timestamp === fx.observed_at));
});

test('builder fails closed for cross-brand, bundle, unsupported, or inexact lineage evidence', () => {
  const conflict = pageRow('4', 'Rolex and Audemars Piguet 15500ST SGD 45000', 'Audemars Piguet', '15500ST');
  assert.equal(correctionRecord(conflict, fx), null);
  const lineage = pageRow('5', 'Audemars Piguet 15500ST SGD 45000', 'Audemars Piguet', '15500ST');
  lineage.source_hash = 'f'.repeat(64);
  assert.equal(correctionRecord(lineage, fx), null);
  const page = buildCorrectionPage([
    pageRow('6', 'Rolex 116500LN USD 25000', 'Rolex', '116500LN'),
  ], fx, { normalizationRunKey: 'normalized-v1', correctionRunKey: 'correction-v1' });
  assert.equal(page.scanned_rows, 1);
  assert.equal(page.corrected_rows, 1);
  assert.match(page.batch_token, /^[0-9a-f]{64}$/);
  assert.equal(page.records[0].listing_id, '00000000-0000-0000-0000-000000000006');
});

test('forward SQL is update-only, exact-lineage, snapshot-bound, fixed-census, and resumable', () => {
  const sql = read('supabase/migrations/20260812220000_qnsa_three_brand_global_price_correction.sql');
  assert.match(sql, /brand_normalized IN \('Rolex', 'Patek Philippe', 'Audemars Piguet'\)/);
  assert.match(sql, /'USD','EUR','HKD','GBP','CHF','CNY','JPY','SGD','KRW','THB','CAD','AUD'/);
  assert.match(sql, /recognized_but_withheld/);
  assert.match(sql, /p_fx_snapshot->>'contract' IS DISTINCT FROM 'wf-dated-fx-snapshot-v1'/);
  assert.match(sql, /input\.conversion_source IS DISTINCT FROM v_run\.fx_snapshot->>'source'/);
  assert.match(sql, /input\.conversion_timestamp IS DISTINCT FROM \(v_run\.fx_snapshot->>'observed_at'\)::timestamptz/);
  assert.match(sql, /listing\.id = input\.listing_id/);
  assert.match(sql, /version\.source_hash = listing\.source_hash/);
  assert.match(sql, /cursor_listing_id UUID/);
  assert.match(sql, /scanned_rows = corrected_rows \+ skipped_rows/);
  assert.match(sql, /v_run\.scanned_rows <> v_run\.census_rows/);
  assert.match(sql, /v_after_rows <> v_before_rows/);
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+staging\.listings/i);
  assert.doesNotMatch(sql, /(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+(?:public\.)?raw_message_versions/i);
  assert.doesNotMatch(sql, /(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+(?:raw\.)?payloads/i);
});

test('workflow separates read-only audit, one-page canary, and bounded resume', () => {
  const workflow = read('.github/workflows/qnsa-three-brand-global-price-correction.yml');
  assert.match(workflow, /options: \[AUDIT, CANARY, RESUME\]/);
  assert.match(workflow, /APPLY_THREE_BRAND_FX_CANARY/);
  assert.match(workflow, /RESUME_THREE_BRAND_FX/);
  assert.match(workflow, /inputs\.mode == 'CANARY' && '1'/);
  assert.match(workflow, /Read-only configured disk and utilization preflight/);
  assert.match(workflow, /Read-only bounded checkpoint, queue, and lineage preflight/);
  assert.match(workflow, /node tools\/supabase\/audit-disk-capacity\.cjs/);
  assert.doesNotMatch(workflow, /pg_database_size\(current_database\(\)\)/);
  assert.doesNotMatch(workflow, /SELECT count\(\*\) FROM staging\.listings/);
  assert.doesNotMatch(workflow, /SELECT count\(\*\) FROM public\.raw_message_versions/);
  assert.match(workflow, /staging_row_delta/);
  assert.match(workflow, /raw_immutability_verification/);
  assert.doesNotMatch(workflow, /'raw_version_row_delta',\s*0/);
  assert.match(workflow, /unsupported_currency_rows/);
  assert.match(workflow, /MAX_PENDING_JOBS: '0'/);
  assert.match(workflow, /scanned_rows -ne \(\[long\]\$r\.run\.corrected_rows\+\[long\]\$r\.run\.skipped_rows\)/);
});

test('runner uses the immutable run snapshot and reconciles a zero-row-delta page', async () => {
  const rows = [
    pageRow('7', 'Rolex 116500LN EUR 25000', 'Rolex', '116500LN'),
    pageRow('8', 'Audemars Piguet 15500ST SGD 45000', 'Audemars Piguet', '15500ST'),
  ];
  const queries = [];
  const fetchImpl = async (_url, options) => {
    const sql = JSON.parse(options.body).query;
    queries.push(sql);
    if (sql.includes("'database_gib'")) return response([{ safety: { database_gib: 4, staging_rows: 603678, pending_jobs: 0, failed_jobs: 0 } }]);
    if (sql.includes('FROM staging.mariadb_three_brand_price_correction_runs AS run')) return response([]);
    if (sql.includes('start_mariadb_three_brand_price_correction')) return response([{ run: {
      correction_run_key: 'correction-v1', normalization_run_key: 'normalized-v1', fx_snapshot: fx,
      initial_staging_rows: 603678, census_rows: 2, scanned_rows: 0, corrected_rows: 0,
      skipped_rows: 0, batch_sequence: 0, status: 'READY',
    } }]);
    if (sql.includes('qnsa_three_brand_price_correction_page')) return response([{ page: { previous_cursor: null, records: rows } }]);
    if (sql.includes('apply_mariadb_three_brand_price_policy_batch')) return response([{ result: {
      corrected_rows: 2, duplicate_staging_rows_created: 0, staging_row_delta: 0,
      fx_contract: fx.contract, fx_observed_at: fx.observed_at, fx_source: fx.source,
    } }]);
    if (sql.includes('advance_mariadb_three_brand_price_correction')) return response([{ run: {
      census_rows: 2, scanned_rows: 2, corrected_rows: 2, skipped_rows: 0,
      batch_sequence: 1, status: 'COMPLETE', staging_rows_created: 0, staging_row_delta: 0,
    } }]);
    throw new Error(`Unexpected query: ${sql}`);
  };
  const result = await run({
    env: {
      SUPABASE_ACCESS_TOKEN: 'masked', SUPABASE_PROJECT_REF: 'qnsa', EXPECTED_PROJECT_REF: 'qnsa',
      NORMALIZED_RUN_KEY: 'normalized-v1', CORRECTION_RUN_KEY: 'correction-v1',
      DATABASE_LIMIT_GIB: '16', MINIMUM_HEADROOM_GIB: '2', MAX_PENDING_JOBS: '1000',
      MAX_FAILED_JOBS: '0', CORRECTION_PAGE_SIZE: '100', CORRECTION_MAX_BATCHES: '1',
      CORRECTION_BATCH_DELAY_MS: '0',
    },
    fetchImpl,
    fxSnapshot: fx,
  });
  assert.deepEqual(result, { status: 'COMPLETE', batches_processed: 1, census_rows: 2,
    scanned_rows: 2, corrected_rows: 2, skipped_rows: 0, staging_row_delta: 0 });
  assert.ok(queries.some(sql => sql.includes('apply_mariadb_three_brand_price_policy_batch')));
  assert.ok(queries.some(sql => sql.includes('qnsa_three_brand_price_correction_page')));
});

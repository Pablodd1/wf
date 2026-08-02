'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  assertReadOnlyGrants,
  normalizationInput,
  sourceRecord,
} = require('../tools/mariadb-live/lib.cjs');
const {
  atomicGzip,
  publishAccountability,
  prepareOutput: prepareContinuousOutput,
  reconciliation,
} = require('../tools/mariadb-live/continuous-worker.cjs');

test('accountability publisher sends counts only to the service ledger', async () => {
  const previousEnabled = process.env.PIPELINE_ACCOUNTABILITY_ENABLED;
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.PIPELINE_ACCOUNTABILITY_ENABLED = 'true';
  process.env.SUPABASE_URL = 'https://shadow.example';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-key';
  let request;
  try {
    const result = await publishAccountability({
      status: 'PROCESSING',
      checked_at: '2026-08-02T16:00:00.000Z',
      last_created_on: '2026-08-02 11:59:00',
      last_id: 'source-9',
      batch_sequence: 9,
      source_input_rows: 100,
      raw_output_rows: 99,
      collection_error_rows: 1,
      normalization_output_rows: 98,
      normalization_error_rows: 1,
      source_reconciled: true,
      normalization_reconciled: true,
      watch_records_writes: 0,
    }, async (url, options) => {
      request = { url, options };
      return { ok: true };
    });
    const body = JSON.parse(request.options.body);
    assert.equal(result.published, true);
    assert.equal(request.url, 'https://shadow.example/rest/v1/source_pipeline_accountability?on_conflict=source_key');
    assert.equal(body.source_input_rows, 100);
    assert.equal(body.immutable_raw_rows, 99);
    assert.equal(body.normalization_proposal_rows, 98);
    assert.equal(body.customer_record_writes, 0);
    assert.equal('raw_message' in body, false);
    assert.doesNotMatch(request.url, /watch_records/);

    let errorRequest;
    await publishAccountability({
      status: 'ERROR_RETRYING',
      checked_at: '2026-08-02T16:01:00.000Z',
      declared_errors: ['WORKER_EXECUTION_FAILED'],
    }, async (url, options) => {
      errorRequest = { url, options };
      return { ok: true };
    });
    const errorBody = JSON.parse(errorRequest.options.body);
    assert.equal(errorBody.pipeline_status, 'ERROR_RETRYING');
    assert.equal('source_input_rows' in errorBody, false, 'transient errors must not erase the last reconciled counts');
  } finally {
    if (previousEnabled === undefined) delete process.env.PIPELINE_ACCOUNTABILITY_ENABLED;
    else process.env.PIPELINE_ACCOUNTABILITY_ENABLED = previousEnabled;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});

test('MariaDB source wrapper preserves immutable evidence and stable lineage', () => {
  const row = {
    id: '122fdf19-010c-4fcd-95ee-4e5c8aa44e8e',
    created_on: '2026-08-01 20:10:42',
    origin: 'WhatsApp',
    type: 'sale',
    status: 'open',
    is_bundle: 0,
    title: 'Rolex 126500LN USD 31,000',
    description: null,
    brand: 'Rolex',
    reference: '126500LN',
    normalized_reference: '126500LN',
    dial_color: 'White',
    price: '31000.00',
    front_image: 'abc_front_image.jpg',
  };
  const wrapped = sourceRecord(row, '2026-08-02T00:15:00.000Z');
  assert.equal(wrapped.source_record_id, `mysql_auctions_${row.id}`);
  assert.equal(wrapped.raw_message, row.title);
  assert.equal(wrapped.raw_data.title, row.title);
  assert.equal(wrapped.raw_data.price, row.price);
  assert.match(wrapped.raw_sha256, /^[a-f0-9]{64}$/);
});

test('normalization input never promotes collapsed MariaDB price or currency', () => {
  const wrapped = sourceRecord({
    id: 'a', created_on: '2026-08-01 20:10:42', type: 'search', title: 'WTB 5712/1A',
    brand: 'Patek Philippe', reference: '5712/1A', price: '12345.00',
  });
  const input = normalizationInput(wrapped);
  assert.equal(input.listing_type, 'WTB');
  assert.equal(input.price_raw, null);
  assert.equal(input.price_usd, null);
  assert.equal(input.currency, null);
});

test('collector refuses a MariaDB account with write privileges', () => {
  assert.doesNotThrow(() => assertReadOnlyGrants([
    "GRANT USAGE ON *.* TO 'reader'@'%'",
    "GRANT SELECT ON `thecollective_inventory`.* TO 'reader'@'%'",
  ]));
  assert.throws(() => assertReadOnlyGrants([
    "GRANT SELECT, INSERT ON `thecollective_inventory`.* TO 'writer'@'%'",
  ]), /beyond read-only/);
});

test('continuous worker checkpoints local shadow files and reconciles both stages', () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-mariadb-continuous-'));
  try {
    const prepared = prepareContinuousOutput(output, '2026-08-01 00:00:00');
    assert.equal(fs.existsSync(prepared.paths.checkpoint), true);
    assert.deepEqual(reconciliation({
      source_input_rows: 12,
      raw_output_rows: 11,
      collection_error_rows: 1,
      normalization_output_rows: 10,
      normalization_error_rows: 1,
    }), {
      source_reconciled: true,
      normalization_reconciled: true,
      source_difference: 0,
      normalization_difference: 0,
    });
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});

test('continuous worker writes compact atomic gzip segments', () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-mariadb-gzip-'));
  try {
    const filePath = path.join(output, 'raw', '000000001-test.jsonl.gz');
    const bytes = atomicGzip(filePath, ['{"id":1}\n', '{"id":2}\n']);
    assert.equal(bytes > 0, true);
    assert.equal(fs.existsSync(filePath), true);
    assert.equal(fs.existsSync(`${filePath}.${process.pid}.tmp`), false);
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});

test('continuous worker declares failures and retries under an internal supervisor', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'tools', 'mariadb-live', 'continuous-worker.cjs'),
    'utf8',
  );
  assert.match(source, /async function supervise\(\)/);
  assert.match(source, /status: 'ERROR_RETRYING'/);
  assert.match(source, /declared_errors: \['WORKER_EXECUTION_FAILED'\]/);
  assert.match(source, /await sleep\(retryDelayMs\)/);
});

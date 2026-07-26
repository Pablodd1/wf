'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { sha256 } = require('../api/_lib/review-packets.cjs');
const { runExport } = require('../tools/review-packets/export-routing-evidence.cjs');
const { runSnapshot } = require('../tools/review-packets/snapshot-local.cjs');

function response(rows, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => rows,
  };
}

function requestedIds(url, column) {
  const filter = new URL(url).searchParams.get(column);
  return [...filter.matchAll(/"([^"]+)"/g)].map(match => match[1]);
}

function mockSupabase(sources, shadows, calls = []) {
  return async (url, options) => {
    calls.push({ url, options });
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/watch_records')) {
      return response(requestedIds(url, 'id').flatMap(id => sources[id] ? [sources[id]] : []));
    }
    if (parsed.pathname.endsWith('/normalization_shadow_v4')) {
      return response(requestedIds(url, 'source_record_id').flatMap(id => shadows[id] ? [shadows[id]] : []));
    }
    return response([], 404);
  };
}

function writeCsv(filePath, rows) {
  const headers = ['reason', 'packet_id', 'source_record_id', 'normalization_version', 'review_status'];
  fs.writeFileSync(filePath, `${headers.join(',')}\n${rows.map(row => headers.map(key => row[key] || '').join(',')).join('\n')}\n`);
}

function route(sourceRecordId, overrides = {}) {
  return {
    reason: 'CURRENCY_AMBIGUOUS',
    packet_id: 'CURRENCY_AMBIGUOUS-0001',
    source_record_id: sourceRecordId,
    normalization_version: 'v4.2-line-condition',
    review_status: 'PENDING',
    ...overrides,
  };
}

function shadow(sourceRecordId, overrides = {}) {
  return {
    source_record_id: sourceRecordId,
    normalization_version: 'v4.2-line-condition',
    candidate_count: 1,
    proposed_candidates: [{ reference: '116500LN', raw_line: 'Rolex 116500LN $30K', seller_phone: '+85262361307' }],
    change_flags: ['CURRENCY_AMBIGUOUS'],
    review_status: 'PENDING',
    ...overrides,
  };
}

test('exports only hashes and same-version frozen shadow proposals using GET-only batched reads', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-review-export-'));
  const input = path.join(temporary, 'review-packets.csv');
  const output = path.join(temporary, 'output');
  const calls = [];
  writeCsv(input, [route('source-1'), route('source-2'), route('source-3')]);
  const fetchImpl = mockSupabase({
    'source-1': { id: 'source-1', raw_message: '[7/12] +852 6236 1307: Rolex 116500LN $30K' },
    'source-2': { id: 'source-2', raw_message: 'second source' },
  }, {
    'source-1': shadow('source-1'),
    'source-2': shadow('source-2', { normalization_version: 'v4.1-old' }),
    'source-3': shadow('source-3'),
  }, calls);

  try {
    const result = await runExport({
      input,
      output,
      baseUrl: 'https://example.supabase.co',
      key: 'test-service-key',
      batchSize: 3,
      maxRows: 3,
      fetchImpl,
    });
    assert.deepEqual(
      { input: result.input_rows, output: result.output_rows, errors: result.error_rows },
      { input: 3, output: 1, errors: 2 },
    );
    assert.equal(result.reconciled, true);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(call => call.options.method === 'GET'));
    assert.ok(calls.every(call => !call.options.body));

    const text = fs.readFileSync(path.join(output, 'routing.jsonl'), 'utf8');
    assert.doesNotMatch(text, /6236|seller_phone|raw_line":|raw_message":/);
    assert.match(text, /raw_line_sha256/);
    const row = JSON.parse(text.trim());
    assert.equal(row.raw_message_sha256, sha256('[7/12] +852 6236 1307: Rolex 116500LN $30K'));
    assert.equal(row.frozen_proposal.proposed_candidates[0].raw_line_sha256, sha256('Rolex 116500LN $30K'));
    assert.equal('source_currency' in row.frozen_proposal, false);

    const errors = fs.readFileSync(path.join(output, 'errors.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
    assert.deepEqual(errors.map(error => error.code), ['VERSION_MISMATCH', 'MISSING_SOURCE']);
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
    assert.equal(manifest.contains_raw_messages, false);
    assert.equal(manifest.contains_contact_data, false);
    assert.equal(manifest.database_writes, 0);
    assert.equal(manifest.llm_calls, 0);

    const snapshot = await runSnapshot({
      input: path.join(output, 'routing.jsonl'),
      output: path.join(temporary, 'snapshot'),
      maxRows: 1,
      packetSize: 1,
    });
    assert.equal(snapshot.packet_item_rows, 1);
    assert.equal(snapshot.reconciled, true);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('hard row cap checkpoints committed batches and resumes without duplicates', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-review-export-resume-'));
  const input = path.join(temporary, 'review-packets.csv');
  const output = path.join(temporary, 'output');
  const ids = ['source-1', 'source-2', 'source-3'];
  writeCsv(input, ids.map(id => route(id)));
  const sources = Object.fromEntries(ids.map(id => [id, { id, raw_message: `immutable ${id}` }]));
  const shadows = Object.fromEntries(ids.map(id => [id, shadow(id)]));
  const calls = [];
  const fetchImpl = mockSupabase(sources, shadows, calls);

  try {
    await assert.rejects(runExport({
      input,
      output,
      baseUrl: 'https://example.supabase.co',
      key: 'test-service-key',
      batchSize: 2,
      maxRows: 2,
      fetchImpl,
    }), /exceeds bounded maxRows=2/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'checkpoint.json'), 'utf8')).input_rows, 2);

    const resumed = await runExport({
      input,
      output,
      baseUrl: 'https://example.supabase.co',
      key: 'test-service-key',
      batchSize: 1,
      maxRows: 3,
      fetchImpl,
    });
    assert.equal(resumed.input_rows, 3);
    assert.equal(resumed.output_rows, 3);
    assert.equal(resumed.error_rows, 0);
    const outputRows = fs.readFileSync(path.join(output, 'routing.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
    assert.equal(new Set(outputRows.map(row => row.source_record_id)).size, 3);
    assert.equal(calls.length, 4);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('fails closed when a Supabase read returns an unrequested lineage key', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-review-export-lineage-'));
  const input = path.join(temporary, 'review-packets.csv');
  const output = path.join(temporary, 'output');
  writeCsv(input, [route('source-1')]);
  const fetchImpl = async url => {
    const parsed = new URL(url);
    return parsed.pathname.endsWith('/watch_records')
      ? response([{ id: 'wrong-source', raw_message: 'wrong' }])
      : response([shadow('source-1')]);
  };

  try {
    await assert.rejects(runExport({
      input,
      output,
      baseUrl: 'https://example.supabase.co',
      key: 'test-service-key',
      maxRows: 1,
      fetchImpl,
    }), /unrequested lineage key/);
    assert.equal(fs.readFileSync(path.join(output, 'routing.jsonl'), 'utf8'), '');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('fails closed when routing reason or candidate count disagrees with the frozen shadow row', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-review-export-mismatch-'));
  const input = path.join(temporary, 'review-packets.csv');
  const output = path.join(temporary, 'output');
  writeCsv(input, [
    route('source-1', { reason: 'DIAL_AMBIGUOUS' }),
    route('source-2'),
  ]);
  const fetchImpl = mockSupabase({
    'source-1': { id: 'source-1', raw_message: 'first immutable source' },
    'source-2': { id: 'source-2', raw_message: 'second immutable source' },
  }, {
    'source-1': shadow('source-1'),
    'source-2': shadow('source-2', { candidate_count: 2 }),
  });

  try {
    const result = await runExport({
      input,
      output,
      baseUrl: 'https://example.supabase.co',
      key: 'test-service-key',
      maxRows: 2,
      fetchImpl,
    });
    assert.equal(result.output_rows, 0);
    assert.equal(result.error_rows, 2);
    const errors = fs.readFileSync(path.join(output, 'errors.jsonl'), 'utf8')
      .trim().split(/\r?\n/).map(JSON.parse);
    assert.deepEqual(errors.map(error => error.code), ['REASON_MISMATCH', 'INVALID_SHADOW_PROPOSAL']);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

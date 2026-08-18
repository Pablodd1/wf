'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { CONFIRMATION, config, createQnsaSegmentIngestor } = require('../tools/mariadb-live/qnsa-segment-ingestor.cjs');

test('QNSA adapter is project pinned and confirmation gated', () => {
  const base = { SUPABASE_SERVICE_ROLE_KEY: 'server-only', MARIADB_SEGMENT_BRIDGE_CONFIRMATION: CONFIRMATION };
  assert.throws(() => config({ ...base, SUPABASE_URL: 'https://wrong.supabase.co' }), /origin pin/);
  assert.throws(() => config({ ...base, SUPABASE_URL: 'http://qnsafosakvonzgfcsphh.supabase.co' }), /HTTPS origin pin/);
  assert.throws(() => config({ ...base, SUPABASE_URL: 'https://user:pass@qnsafosakvonzgfcsphh.supabase.co' }), /HTTPS origin pin/);
  assert.throws(() => config({ ...base, SUPABASE_URL: 'https://qnsafosakvonzgfcsphh.supabase.co/rest' }), /HTTPS origin pin/);
  assert.throws(() => config({ ...base, SUPABASE_URL: 'https://qnsafosakvonzgfcsphh.supabase.co', MARIADB_SEGMENT_BRIDGE_CONFIRMATION: 'wrong' }), /confirmation/);
  assert.equal(config({ ...base, SUPABASE_URL: 'https://qnsafosakvonzgfcsphh.supabase.co' }).maxRows, 500);
});

test('adapter calls only private shadow RPC and preserves zero-publication contract', async () => {
  let request;
  const ingest = createQnsaSegmentIngestor({ config: { url: 'https://qnsafosakvonzgfcsphh.supabase.co', key: 'secret', maxRows: 500 }, fetchImpl: async (url, options) => {
    request = { url, options };
    return { ok: true, text: async () => JSON.stringify({ raw_accounted: 1, staging_accounted: 1, error_rows: 0, publication_writes: 0, idempotent: true, segment_chain_sha256: 'b'.repeat(64) }) };
  } });
  const result = await ingest({ contract: 'wf-mariadb-live-segment-bridge-v1', batch_token: 'a'.repeat(64), sequence: 1,
    expected_previous_cursor: { last_created_on: '1970-01-01 00:00:00', last_source_id: '' }, next_cursor: { last_created_on: '2026-08-18 00:00:00', last_source_id: '1' },
    expected_previous_segment_chain_sha256: '0'.repeat(64), next_segment_chain_sha256: 'b'.repeat(64),
    raw_file_sha256: 'c'.repeat(64), proposal_file_sha256: 'd'.repeat(64),
    raw_records: [{}], staging_records: [{}], publication_authorized: false });
  assert.match(request.url, /\/rpc\/ingest_live_shadow_segment$/);
  assert.doesNotMatch(request.url, /watch_records|staging\.listings|release|dealer/);
  assert.equal(JSON.parse(request.options.body).p_batch_token, 'a'.repeat(64));
  assert.equal(JSON.parse(request.options.body).p_raw_file_sha256, 'c'.repeat(64));
  assert.equal(JSON.parse(request.options.body).p_proposal_file_sha256, 'd'.repeat(64));
  assert.equal(result.publication_writes, 0);
  await assert.rejects(ingest({ raw_records: Array(501).fill({}), staging_records: Array(501).fill({}), publication_authorized: false }), /record count/);
});

test('adapter never copies PostgREST error text into operator logs', async () => {
  const ingest = createQnsaSegmentIngestor({
    config: { url: 'https://qnsafosakvonzgfcsphh.supabase.co', key: 'secret', maxRows: 500 },
    fetchImpl: async () => ({ ok: false, status: 400, text: async () => 'phone +1 212 555 0100 raw listing secret' }),
  });
  await assert.rejects(ingest({
    contract: 'wf-mariadb-live-segment-bridge-v1', batch_token: 'a'.repeat(64), sequence: 1,
    expected_previous_cursor: { last_created_on: '1970-01-01 00:00:00', last_source_id: '' },
    next_cursor: { last_created_on: '2026-08-18 00:00:00', last_source_id: '1' },
    expected_previous_segment_chain_sha256: '0'.repeat(64), next_segment_chain_sha256: 'b'.repeat(64),
    raw_file_sha256: 'c'.repeat(64), proposal_file_sha256: 'd'.repeat(64),
    raw_records: [{}], staging_records: [{}], publication_authorized: false,
  }), error => {
    assert.equal(error.code, 'QNSA_SHADOW_RPC_FAILED');
    assert.doesNotMatch(error.message, /212|raw listing|secret/);
    return true;
  });
});

test('migration is private, transactional, idempotent and has no publication target', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260818150000_live_shadow_segment_ingest.sql'), 'utf8');
  assert.match(sql, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /WHERE batch_token = p_batch_token/);
  assert.match(sql, /request_sha256 <> v_request_sha256/);
  assert.match(sql, /p_expected_previous_chain_sha256 \|\| E'\\n' \|\| p_batch_token/);
  assert.match(sql, /v_expected_batch_token := encode\(digest/);
  assert.match(sql, /ORDER BY entry\.key COLLATE "C"/);
  assert.match(sql, /v_computed_sha256 <> v_raw->>'raw_sha256'/);
  assert.match(sql, /v_computed_candidate_sha256 <> v_stage->>'source_candidate_hash'/);
  assert.match(sql, /existing raw version does not match immutable incoming lineage/);
  assert.match(sql, /existing shadow candidate does not match immutable incoming lineage/);
  assert.match(sql, /ON CONFLICT \(raw_message_id, source_hash\) DO NOTHING/);
  assert.match(sql, /BETWEEN 1 AND 500/);
  assert.match(sql, /publication_writes BIGINT NOT NULL DEFAULT 0 CHECK \(publication_writes = 0\)/);
  assert.match(sql, /REVOKE ALL ON staging\.live_shadow_candidates FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(sql, /'COPIED_RAW', 'live-shadow-v1'/);
  assert.doesNotMatch(sql, /'PENDING', 'live-shadow-v1'/);
  assert.match(sql, /materialization' = 'SINGLE'[\s\S]*listing_type' NOT IN \('WTS','WTB'\)/);
  assert.doesNotMatch(sql, /INSERT INTO staging\.listings/i);
  assert.doesNotMatch(sql, /INSERT INTO (?:public\.)?watch_records/i);
  assert.doesNotMatch(sql, /published_pending_verification|NORMALIZATION_STAGED/);
});

test('rollback-only schema audit executes a database contract test on pinned QNSA', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'qnsa-live-shadow-schema-audit.yml'), 'utf8');
  const dbTest = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'tests', 'live_shadow_segment_ingest.sql'), 'utf8');
  assert.match(workflow, /PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.match(workflow, /BEGIN;[\s\S]*ROLLBACK;/);
  assert.match(workflow, /INPUT_CONFIRMATION: \$\{\{ inputs\.confirmation \}\}/);
  assert.doesNotMatch(workflow, /'\$\{\{ inputs\.confirmation \}\}'/);
  assert.match(dbTest, /altered same-count replay was not rejected/);
  assert.match(dbTest, /2f3456391f1ea48381b13e8de1aa0d8009a990a967feca8a5f5b1c2f9e9028c9/);
  assert.match(dbTest, /cbe8a26566fc555c22d6a7a0b7db75bef97905d333d1f4f55ce2a3b61ff73940/);
  assert.match(dbTest, /processing_status[\s\S]*COPIED_RAW/);
  assert.match(dbTest, /publication_status <> 'PRIVATE_SHADOW_ONLY'/);
});

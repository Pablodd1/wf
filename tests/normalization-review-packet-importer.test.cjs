'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { proposalSha256, sha256 } = require('../api/_lib/review-packets.cjs');
const {
  APPROVAL,
  loadAndValidate,
  resolveConfig,
  runImporter,
} = require('../tools/review-packets/import-private.cjs');

const ROOT = path.join(__dirname, '..');
const SOURCE_HASH = 'a'.repeat(64);

function writeSnapshot(directory, mutate = value => value) {
  const reasons = ['CURRENCY_AMBIGUOUS', 'BUNDLE_SPLIT_REQUIRED'];
  const packets = reasons.map((reason, index) => ({
    id: `rp_${SOURCE_HASH.slice(0, 12)}_${reason.toLowerCase()}_0001`,
    reason,
    normalization_version: 'v4.2-line-condition',
    source_artifact_sha256: SOURCE_HASH,
    status: 'READY_FOR_REVIEW',
    item_count: 1,
  }));
  const items = packets.map((packet, index) => {
    const sourceRecordId = `source-${index + 1}`;
    const references = packet.reason === 'BUNDLE_SPLIT_REQUIRED' ? ['2a', '2b'] : [`${index + 1}`];
    const frozen = {
      candidate_count: references.length,
      change_flags: [packet.reason],
      proposed_candidates: references.map(reference => ({ reference })),
    };
    return {
      id: `ri_${sha256(`${packet.id}|1|${sourceRecordId}|${packet.normalization_version}`).slice(0, 40)}`,
      packet_id: packet.id,
      ordinal: 1,
      source_record_id: sourceRecordId,
      normalization_version: packet.normalization_version,
      frozen_proposal: frozen,
      proposal_sha256: proposalSha256(frozen),
      raw_message_sha256: String.fromCharCode(98 + index).repeat(64),
      status: 'PENDING',
    };
  });
  const snapshot = mutate({
    manifest: {
      contract: 'normalization-review-packet-snapshot-v1',
      source_artifact_sha256: SOURCE_HASH,
      packet_size: 1,
      max_rows: 2,
      packet_count: 2,
      item_count: 2,
      error_count: 0,
      contains_raw_messages: false,
      contains_contact_data: false,
      database_writes: 0,
    },
    reconciliation: {
      input_rows: 2,
      packet_item_rows: 2,
      error_rows: 0,
      difference: 0,
      reconciled: true,
    },
    packets,
    items,
  });
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'manifest.json'), `${JSON.stringify(snapshot.manifest)}\n`);
  fs.writeFileSync(path.join(directory, 'reconciliation.json'), `${JSON.stringify(snapshot.reconciliation)}\n`);
  fs.writeFileSync(path.join(directory, 'packets.jsonl'), `${snapshot.packets.map(JSON.stringify).join('\n')}\n`);
  fs.writeFileSync(path.join(directory, 'packet-items.jsonl'), `${snapshot.items.map(JSON.stringify).join('\n')}\n`);
  return snapshot;
}

function config(directory) {
  return {
    target: 'https://shadow.example',
    serviceKey: 'test-service-role-key',
    inputDir: directory,
    checkpointPath: path.join(directory, 'import-checkpoint.json'),
    reconciliationPath: path.join(directory, 'import-reconciliation.json'),
  };
}

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

test('requires exact approval, an explicit target allowlist, and an import-specific key', () => {
  assert.throws(() => resolveConfig({}), /APPROVAL/);
  assert.throws(() => resolveConfig({
    REVIEW_PACKET_IMPORT_APPROVAL: APPROVAL,
    REVIEW_PACKET_IMPORT_URL: 'https://shadow.example',
    REVIEW_PACKET_IMPORT_ALLOWED_TARGETS: 'https://other.example',
    REVIEW_PACKET_IMPORT_SERVICE_ROLE_KEY: 'key',
    REVIEW_PACKET_IMPORT_DIR: '.',
  }), /allowlist/);
  const resolved = resolveConfig({
    REVIEW_PACKET_IMPORT_APPROVAL: APPROVAL,
    REVIEW_PACKET_IMPORT_URL: 'https://shadow.example/',
    REVIEW_PACKET_IMPORT_ALLOWED_TARGETS: 'https://preview.example, https://shadow.example',
    REVIEW_PACKET_IMPORT_SERVICE_ROLE_KEY: 'key',
    REVIEW_PACKET_IMPORT_DIR: '.',
  });
  assert.equal(resolved.target, 'https://shadow.example');
});

test('imports one whole packet per RPC, checkpoints, resumes, and reconciles exactly', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-packet-import-'));
  writeSnapshot(directory);
  const calls = [];
  try {
    await assert.rejects(runImporter({
      config: config(directory),
      fetchImpl: async (_url, options) => {
        const request = JSON.parse(options.body);
        calls.push(request);
        if (request.p_packet.reason === 'CURRENCY_AMBIGUOUS') return response({ code: 'TEST_FAILURE' }, 500);
        return response({
          packet_id: request.p_packet.id,
          item_count: request.p_items.length,
          exact_match: true,
          watch_records_mutated: false,
        });
      },
    }), /currency_ambiguous_0001.*HTTP 500/);
    assert.deepEqual(calls.map(call => call.p_packet.reason), ['BUNDLE_SPLIT_REQUIRED', 'CURRENCY_AMBIGUOUS']);
    assert.equal(calls[0].p_items.length, calls[0].p_packet.item_count);
    assert.deepEqual(JSON.parse(fs.readFileSync(config(directory).checkpointPath, 'utf8')), {
      contract: 'normalization-review-packet-import-v1',
      target: 'https://shadow.example',
      artifact_hashes: JSON.parse(fs.readFileSync(config(directory).checkpointPath, 'utf8')).artifact_hashes,
      packet_count: 2,
      item_count: 2,
      completed_packets: 1,
      imported_items: 1,
      complete: false,
      updated_at: JSON.parse(fs.readFileSync(config(directory).checkpointPath, 'utf8')).updated_at,
    });

    const resumedCalls = [];
    const result = await runImporter({
      config: config(directory),
      fetchImpl: async (_url, options) => {
        const request = JSON.parse(options.body);
        resumedCalls.push(request.p_packet.reason);
        return response({
          packet_id: request.p_packet.id,
          item_count: request.p_items.length,
          exact_match: true,
          watch_records_mutated: false,
        });
      },
    });
    assert.deepEqual(resumedCalls, ['CURRENCY_AMBIGUOUS']);
    assert.equal(result.imported_items, 2);
    assert.equal(result.difference, 0);
    assert.equal(result.reconciled, true);
    assert.equal(result.watch_records_mutated, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects proposal hash changes and nested private evidence before any network call', async () => {
  const badHash = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-packet-hash-'));
  const privateEvidence = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-packet-private-'));
  try {
    writeSnapshot(badHash, snapshot => {
      snapshot.items[0].frozen_proposal.proposed_candidates[0].reference = 'changed';
      return snapshot;
    });
    await assert.rejects(loadAndValidate(badHash), /Proposal hash mismatch/);

    writeSnapshot(privateEvidence, snapshot => {
      snapshot.items[0].frozen_proposal.proposed_candidates[0].seller_phone = '+15551212';
      snapshot.items[0].proposal_sha256 = proposalSha256(snapshot.items[0].frozen_proposal);
      return snapshot;
    });
    let called = false;
    await assert.rejects(runImporter({
      config: config(privateEvidence),
      fetchImpl: async () => {
        called = true;
        return response({});
      },
    }), /Private evidence key/);
    assert.equal(called, false);
  } finally {
    fs.rmSync(badHash, { recursive: true, force: true });
    fs.rmSync(privateEvidence, { recursive: true, force: true });
  }
});

test('rejects source-artifact and raw-evidence hash mismatches before import', async () => {
  const sourceMismatch = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-packet-source-'));
  const invalidRawHash = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-packet-raw-'));
  try {
    writeSnapshot(sourceMismatch, snapshot => {
      snapshot.manifest.source_artifact_sha256 = 'd'.repeat(64);
      return snapshot;
    });
    await assert.rejects(loadAndValidate(sourceMismatch), /Source artifact hash mismatch/);

    writeSnapshot(invalidRawHash, snapshot => {
      snapshot.items[0].raw_message_sha256 = 'E'.repeat(64);
      return snapshot;
    });
    await assert.rejects(loadAndValidate(invalidRawHash), /Invalid packet item/);
  } finally {
    fs.rmSync(sourceMismatch, { recursive: true, force: true });
    fs.rmSync(invalidRawHash, { recursive: true, force: true });
  }
});

test('database importer is service-only, atomic, exact-retry-only, and cannot write watch_records', () => {
  const sql = fs.readFileSync(
    path.join(ROOT, 'supabase', 'migrations', '20260726160000_atomic_normalization_review_packet_import.sql'),
    'utf8',
  );
  assert.match(sql, /SECURITY DEFINER\s+SET search_path = ''/i);
  assert.match(sql, /current_setting\('request\.jwt\.claim\.role', true\)[\s\S]*service_role/i);
  assert.match(sql, /item_count[\s\S]*BETWEEN 1 AND 500/i);
  assert.match(sql, /PROPOSAL_HASH_MISMATCH/);
  assert.match(sql, /PACKET_ITEM_ID_MISMATCH/);
  assert.match(sql, /PACKET_REASON_MISMATCH/);
  assert.match(sql, /CANDIDATE_COUNT_REASON_MISMATCH/);
  assert.match(sql, /STALE_SOURCE_EVIDENCE/);
  assert.match(sql, /FOR SHARE OF source/i);
  assert.match(sql, /PACKET_RETRY_CONTENT_MISMATCH/);
  assert.match(sql, /GRANT EXECUTE[\s\S]*TO service_role/i);
  assert.match(sql, /INSERT INTO public\.normalization_review_packets/i);
  assert.match(sql, /INSERT INTO public\.normalization_review_packet_items/i);
  assert.doesNotMatch(sql, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.watch_records/i);
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE FROM)\s+public\.normalization_review_packet/i);
});

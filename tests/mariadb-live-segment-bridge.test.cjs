'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const { sourceRecord } = require('../tools/mariadb-live/lib.cjs');
const { normalizeSourceRecord } = require('../tools/mariadb-live/normalize-local.cjs');
const { prepareBridge, runBridge, safeStaging } = require('../tools/mariadb-live/segment-bridge.cjs');
const { acquireOutputLock } = require('../tools/mariadb-live/collect.cjs');

function source(id, createdOn, description, type = 'sell', image = '') {
  return sourceRecord({
    id, created_on: createdOn, updated_on: createdOn, type, description,
    front_image: image, brand: '', model: '', reference: '', dial_color: '',
  });
}

function writeSegment(root, sequence, sources) {
  const proposals = sources.map(value => normalizeSourceRecord(value));
  const last = sources.at(-1);
  const hash = crypto.createHash('sha256')
    .update(`${last.source_created_on}\n${last.source_id}`).digest('hex').slice(0, 12);
  const name = `${String(sequence).padStart(9, '0')}-${hash}.jsonl.gz`;
  for (const [directory, rows] of [['raw', sources], ['proposals', proposals]]) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
    fs.writeFileSync(path.join(root, directory, name), zlib.gzipSync(rows.map(JSON.stringify).join('\n') + '\n'));
  }
  return name;
}

test('bridge advances only after idempotent raw and staging reconciliation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-segment-bridge-'));
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-segment-state-'));
  try {
    const rows = [source('1', '2026-08-18 01:00:00', 'WTS Rolex 126500LN USD 30000')];
    writeSegment(root, 1, rows);
    let request;
    const report = await runBridge({ sourceRoot: root, output, maxRows: 10, ingestSegment: async value => {
      request = value;
      return { raw_accounted: 1, staging_accounted: 1, error_rows: 0, publication_writes: 0, idempotent: true, segment_chain_sha256: value.next_segment_chain_sha256 };
    } });
    assert.equal(report.last_sequence, 1);
    assert.equal(request.publication_authorized, false);
    assert.equal(request.raw_records[0].raw_sha256, rows[0].raw_sha256);
    assert.match(request.raw_file_sha256, /^[0-9a-f]{64}$/);
    assert.match(request.proposal_file_sha256, /^[0-9a-f]{64}$/);
    assert.equal(request.staging_records[0].contact_publication_approved, false);
    assert.equal(request.staging_records[0].public_image_eligible, false);
    assert.equal(request.staging_records[0].candidate.listing_type, 'WTS');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(output, { recursive: true, force: true });
  }
});

test('failed ingestion is dead-lettered without advancing checkpoint', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-segment-bridge-'));
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-segment-state-'));
  try {
    writeSegment(root, 1, [source('1', '2026-08-18 01:00:00', 'WTB Patek 5712/1A')]);
    await assert.rejects(runBridge({ sourceRoot: root, output, maxRows: 10, ingestSegment: async () => ({
      raw_accounted: 1, staging_accounted: 0, error_rows: 1, publication_writes: 0, idempotent: true,
    }) }), /did not reconcile/);
    await assert.rejects(runBridge({ sourceRoot: root, output, maxRows: 10, ingestSegment: async () => {
      throw new Error('upstream echoed +12125550123 and private@example.com');
    } }), /private@example/);
    assert.equal(prepareBridge(output, root).checkpoint.last_sequence, 0);
    const dead = fs.readFileSync(path.join(output, 'dead-letter.jsonl'), 'utf8');
    assert.match(dead, /checkpoint_advanced.*false/);
    assert.doesNotMatch(dead, /WTB Patek/);
    assert.doesNotMatch(dead, /12125550123|private@example/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(output, { recursive: true, force: true });
  }
});

test('bundle candidates never transport parent media and WTB remains distinct', () => {
  const raw = source('7', '2026-08-18 02:00:00', 'WTB Rolex 126500LN\nWTS Rolex 116500LN USD 25000', 'search', 'parent.jpg');
  const proposal = normalizeSourceRecord(raw);
  const staged = safeStaging(raw, proposal);
  assert.equal(staged.materialization, 'DEFERRED');
  assert.equal(staged.media.source_media_key, null);
  assert.equal(staged.media.public_image_eligible, false);
  assert.equal(staged.contact_publication_approved, false);
});

test('bridge refuses a second replica and segment gaps', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-segment-bridge-'));
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-segment-state-'));
  try {
    assert.throws(() => prepareBridge(output, root, 'secondary'), /Exactly one/);
    writeSegment(root, 2, [source('2', '2026-08-18 03:00:00', 'WTS Omega 310.30 USD 5000')]);
    await assert.rejects(runBridge({ sourceRoot: root, output, maxRows: 10, ingestSegment: async () => ({}) }), /sequence gap/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(output, { recursive: true, force: true });
  }
});

test('bridge never advances across a missing middle segment', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-segment-bridge-'));
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-segment-state-'));
  try {
    writeSegment(root, 1, [source('1', '2026-08-18 01:00:00', 'WTS Rolex 126500LN USD 30000')]);
    writeSegment(root, 3, [source('3', '2026-08-18 03:00:00', 'WTB Rolex 126500LN')]);
    await assert.rejects(runBridge({ sourceRoot: root, output, maxRows: 10, maxSegments: 10, ingestSegment: async value => ({
      raw_accounted: 1,
      staging_accounted: 1,
      error_rows: 0,
      publication_writes: 0,
      idempotent: true,
      segment_chain_sha256: value.next_segment_chain_sha256,
    }) }), /sequence gap/);
    assert.equal(prepareBridge(output, root).checkpoint.last_sequence, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(output, { recursive: true, force: true });
  }
});

test('bridge detects checkpoint tampering and applies disk/backlog backpressure', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-segment-bridge-'));
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-segment-state-'));
  try {
    writeSegment(root, 1, [source('1', '2026-08-18 01:00:00', 'WTS Rolex 126500LN USD 30000')]);
    writeSegment(root, 2, [source('2', '2026-08-18 02:00:00', 'WTB Rolex 126500LN')]);
    await assert.rejects(runBridge({ sourceRoot: root, output, maxRows: 10, maxPendingSegments: 1, ingestSegment: async () => ({}) }), /backpressure/);
    await assert.rejects(runBridge({ sourceRoot: root, output, maxRows: 10, minFreeBytes: Number.MAX_SAFE_INTEGER, ingestSegment: async () => ({}) }), /free disk/);
    const file = path.join(output, 'checkpoint.json');
    const checkpoint = JSON.parse(fs.readFileSync(file, 'utf8'));
    checkpoint.raw_rows_accounted = 99;
    fs.writeFileSync(file, JSON.stringify(checkpoint));
    assert.throws(() => prepareBridge(output, root), /contract mismatch/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(output, { recursive: true, force: true });
  }
});

test('bridge refuses a concurrent process lock and removes stale local locks safely', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-segment-bridge-'));
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-segment-state-'));
  try {
    writeSegment(root, 1, [source('1', '2026-08-18 01:00:00', 'WTS Rolex 126500LN USD 30000')]);
    const release = acquireOutputLock(output);
    await assert.rejects(runBridge({ sourceRoot: root, output, maxRows: 10, ingestSegment: async () => ({}) }), /already active/);
    release();
    fs.writeFileSync(path.join(output, '.collector.lock'), JSON.stringify({ pid: 99999999, hostname: os.hostname() }));
    const result = await runBridge({ sourceRoot: root, output, maxRows: 10, ingestSegment: async value => ({
      raw_accounted: 1,
      staging_accounted: 1,
      error_rows: 0,
      publication_writes: 0,
      idempotent: true,
      segment_chain_sha256: value.next_segment_chain_sha256,
    }) });
    assert.equal(result.last_sequence, 1);
    assert.equal(fs.existsSync(path.join(output, '.collector.lock')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(output, { recursive: true, force: true });
  }
});

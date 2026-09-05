'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildManifest } = require('../tools/mariadb-live/reconcile-normalization-segments.cjs');

function proposal(row) {
  return `${JSON.stringify({
    source_record_id: `mysql_auctions_${row}`,
    source_hash: `hash-${row}`,
    bundle_status: 'SINGLE_CANDIDATE',
    review_disposition: 'HUMAN_REVIEW',
    review_reasons: ['CATALOG_CONFIRMATION_REQUIRED'],
  })}\n`;
}

function writeSegment(directory, start, end, completed = true) {
  fs.mkdirSync(directory, { recursive: true });
  let proposals = '';
  for (let row = start; row <= end; row += 1) proposals += proposal(row);
  fs.writeFileSync(path.join(directory, 'normalization-proposals.jsonl'), proposals);
  fs.writeFileSync(path.join(directory, 'normalization-errors.csv'), 'source_record_id,error_name,error_message\n');
  if (!completed) return;
  const rows = end - start + 1;
  fs.writeFileSync(path.join(directory, 'coverage-report.json'), `${JSON.stringify({
    source_start_row: start,
    source_end_row: end,
    input_rows: rows,
    output_rows: rows,
    error_rows: 0,
    bundle_status: { SINGLE_CANDIDATE: rows },
    review_disposition: { HUMAN_REVIEW: rows },
    blockers_by_reason: { CATALOG_CONFIRMATION_REQUIRED: rows },
  })}\n`);
  fs.writeFileSync(path.join(directory, 'normalization-reconciliation.json'), `${JSON.stringify({
    input_rows: rows,
    output_rows: rows,
    error_rows: 0,
    difference: 0,
    reconciled: true,
  })}\n`);
}

function env(root, sourceRows = 6) {
  return {
    MARIADB_NORMALIZATION_SOURCE_ROWS: String(sourceRows),
    MARIADB_NORMALIZATION_PREFIX_DIR: path.join(root, 'prefix'),
    MARIADB_NORMALIZATION_SHARDS_ROOT: path.join(root, 'shards'),
    MARIADB_NORMALIZATION_MANIFEST_OUTPUT: path.join(root, 'manifest.json'),
  };
}

test('reconciles a durable prefix and completed non-overlapping shards', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-normalization-manifest-'));
  try {
    writeSegment(path.join(root, 'prefix'), 1, 2, false);
    writeSegment(path.join(root, 'shards', 'shard-01'), 3, 4);
    writeSegment(path.join(root, 'shards', 'shard-02'), 5, 6);
    const manifest = await buildManifest({ env: env(root) });
    assert.equal(manifest.segment_count, 3);
    assert.equal(manifest.totals.input_rows, 6);
    assert.equal(manifest.totals.output_rows, 6);
    assert.equal(manifest.totals.error_rows, 0);
    assert.equal(manifest.source_coverage_reconciled, true);
    assert.equal(manifest.segments[0].source_start_row, 1);
    assert.equal(manifest.segments[2].source_end_row, 6);
    assert.match(manifest.segments[0].proposals_sha256, /^[a-f0-9]{64}$/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fails closed when shard coverage has a gap', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-normalization-gap-'));
  try {
    writeSegment(path.join(root, 'prefix'), 1, 2, false);
    writeSegment(path.join(root, 'shards', 'shard-01'), 4, 6);
    await assert.rejects(() => buildManifest({ env: env(root) }), /gap or overlap/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fails closed when a shard has not emitted completion evidence', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-normalization-incomplete-'));
  try {
    writeSegment(path.join(root, 'prefix'), 1, 2, false);
    writeSegment(path.join(root, 'shards', 'shard-01'), 3, 6, false);
    await assert.rejects(() => buildManifest({ env: env(root) }), /coverage does not exist/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reconciles a complete archive represented entirely by finished shards', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-normalization-shards-only-'));
  try {
    writeSegment(path.join(root, 'shards', 'shard-01'), 1, 3);
    writeSegment(path.join(root, 'shards', 'shard-02'), 4, 6);
    const shardOnlyEnv = env(root);
    delete shardOnlyEnv.MARIADB_NORMALIZATION_PREFIX_DIR;
    const manifest = await buildManifest({ env: shardOnlyEnv });
    assert.equal(manifest.segment_count, 2);
    assert.equal(manifest.totals.input_rows, 6);
    assert.equal(manifest.source_coverage_reconciled, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

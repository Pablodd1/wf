'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { evaluateReplayPreflight } = require('../tools/mariadb-live/evaluate-replay-preflight.cjs');

const limits = {
  expected_project_ref: 'qnsafosakvonzgfcsphh',
  run_key: 'mariadb-normalized-20260811-usd-v2',
  database_limit_gib: 16,
  minimum_headroom_gib: 4,
  max_pending_jobs: 1000,
  max_failed_jobs: 0,
};

function snapshot(overrides = {}) {
  return {
    project_ref: 'qnsafosakvonzgfcsphh',
    database_gib: 8.5,
    raw_checkpoint: { status: 'RAW_COPY_COMPLETE', input_rows: 1394269, error_rows: 0 },
    job_statuses: [
      { status: 'normalized', row_count: 200000 },
      { status: 'queued', row_count: 50 },
    ],
    active_normalization_runs: [],
    target_checkpoint: null,
    ...overrides,
  };
}

test('allows a new bounded replay only when headroom and queues are healthy', () => {
  const result = evaluateReplayPreflight(snapshot(), limits);
  assert.equal(result.allowed, true);
  assert.equal(result.headroom_gib, 7.5);
  assert.equal(result.pending_jobs, 50);
  assert.deepEqual(result.blockers, []);
});

test('fails closed when capacity headroom is below the declared reserve', () => {
  const result = evaluateReplayPreflight(snapshot({ database_gib: 12.5 }), limits);
  assert.equal(result.allowed, false);
  assert.deepEqual(result.blockers, ['INSUFFICIENT_DATABASE_HEADROOM']);
});

test('fails closed on queue backlog, dead letters, raw errors, and a conflicting run', () => {
  const result = evaluateReplayPreflight(snapshot({
    raw_checkpoint: { status: 'RAW_COPY_COMPLETE', error_rows: 2 },
    job_statuses: [
      { status: 'received', row_count: 700 },
      { status: 'processing', row_count: 400 },
      { status: 'dead_letter', row_count: 1 },
    ],
    active_normalization_runs: [{ run_key: 'another-run', status: 'STAGING_NORMALIZATION' }],
  }), limits);
  assert.equal(result.allowed, false);
  assert.deepEqual(result.blockers, [
    'PENDING_JOB_THRESHOLD_EXCEEDED',
    'FAILED_JOB_THRESHOLD_EXCEEDED',
    'RAW_IMPORT_HAS_ERRORS',
    'CONFLICTING_NORMALIZATION_RUN_ACTIVE',
  ]);
});

test('reports a completed target as a safe no-op instead of replaying it', () => {
  const result = evaluateReplayPreflight(snapshot({
    target_checkpoint: { status: 'NORMALIZATION_STAGED', error_rows: 0 },
  }), limits);
  assert.equal(result.allowed, false);
  assert.equal(result.already_complete, true);
  assert.deepEqual(result.blockers, []);
});

test('rejects a project mismatch and an errored resumable target', () => {
  const result = evaluateReplayPreflight(snapshot({
    project_ref: 'legacy-project',
    target_checkpoint: { status: 'STAGING_NORMALIZATION', error_rows: 1 },
  }), limits);
  assert.equal(result.allowed, false);
  assert.deepEqual(result.blockers, ['PROJECT_REF_MISMATCH', 'TARGET_CHECKPOINT_HAS_ERRORS']);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '../supabase/migrations/20260717193000_normalization_shadow_work_queue.sql'),
  'utf8',
);
const worker = fs.readFileSync(
  path.join(__dirname, '../tools/shadow-reprocess/railway-worker.cjs'),
  'utf8',
);

test('normalization work queue claims rows with SKIP LOCKED rather than source ID ordering', () => {
  assert.match(migration, /normalization_shadow_work_queue/);
  assert.match(migration, /FOR UPDATE SKIP LOCKED/);
  assert.match(migration, /claim_normalization_shadow_work/);
  assert.match(migration, /complete_normalization_shadow_work/);
  assert.match(migration, /release_normalization_shadow_work/);
  assert.doesNotMatch(migration, /INSERT INTO public\.normalization_shadow_work_queue[\s\S]*SELECT id FROM public\.watch_records/);
});

test('Railway worker can opt into queue mode while retaining a safe legacy default', () => {
  assert.match(worker, /SHADOW_WORKER_MODE.*cursor/);
  assert.match(worker, /useGlobalLease = workerMode === 'cursor'/);
  assert.match(worker, /useGlobalLease \? await acquireLease\(\) : true/);
  assert.match(worker, /if \(useGlobalLease\) await releaseLease\(\)/);
  assert.match(worker, /workerMode === 'queue' \? await runQueueLease\(\) : await runLease\(\)/);
  assert.match(worker, /claim_normalization_shadow_work/);
  assert.match(worker, /releaseQueueWork/);
});

test('completed cursor scans stop while queue workers remain available by default', () => {
  assert.match(worker, /SHADOW_EXIT_ON_COMPLETE/);
  assert.match(worker, /workerMode === 'cursor'/);
  assert.match(worker, /shouldStop = result\.complete && exitOnComplete/);
  assert.match(worker, /event: 'worker_complete'/);
});

test('queue worker reports bounded batch timings and lease resource summaries', () => {
  assert.match(worker, /event: 'batch_complete'/);
  for (const metric of [
    'claimReadMs',
    'analyzeWallMs',
    'analyzeCpuMs',
    'shadowUpsertMs',
    'completionRpcMs',
    'totalMs',
    'rowsPerSecond',
    'memoryMb',
  ]) {
    assert.match(worker, new RegExp(metric));
  }
  assert.match(worker, /records\.map\(analyzeRecord\)/);
  assert.doesNotMatch(worker, /event: 'batch_complete'[\s\S]{0,500}raw_message/);
});

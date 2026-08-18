'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { shardState, waitForShards } = require('../tools/mariadb-live/complete-local-normalization.cjs');

test('completion coordinator recognizes only reconciled, error-free shards', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-completion-shards-'));
  try {
    for (const name of ['shard-01', 'shard-02']) {
      const directory = path.join(root, name);
      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, 'stderr.log'), '');
      fs.writeFileSync(path.join(directory, 'normalization-reconciliation.json'), '{"reconciled":true}\n');
    }
    const state = shardState(root);
    assert.equal(state.length, 2);
    assert.ok(state.every(shard => shard.completed && shard.error_bytes === 0));
    const waited = await waitForShards(root, 2, 1);
    assert.equal(waited.length, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('completion coordinator fails closed on stderr evidence', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-completion-error-'));
  try {
    const directory = path.join(root, 'shard-01');
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'stderr.log'), 'normalizer failed');
    await assert.rejects(() => waitForShards(root, 1, 1), /emitted stderr/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('completion coordinator detects stderr evidence from restarted worker logs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-completion-restart-error-'));
  try {
    const directory = path.join(root, 'shard-01');
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'stderr.log'), '');
    fs.writeFileSync(path.join(directory, 'stderr-cache.log'), 'restarted normalizer failed');
    const [state] = shardState(root);
    assert.deepEqual(state.error_files.sort(), ['stderr-cache.log', 'stderr.log']);
    assert.equal(state.error_bytes, Buffer.byteLength('restarted normalizer failed'));
    await assert.rejects(() => waitForShards(root, 1, 1), /emitted stderr/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

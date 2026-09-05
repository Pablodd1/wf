'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildManifest } = require('./reconcile-normalization-segments.cjs');
const { run: auditPublicationReadiness } = require('./audit-publication-readiness.cjs');

function shardState(root) {
  if (!fs.existsSync(root)) throw new Error(`Normalization shard root does not exist: ${root}`);
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const directory = path.join(root, entry.name);
      const stderrFiles = fs.readdirSync(directory)
        .filter(name => /^stderr(?:[-.][^.]+)*\.log$/i.test(name))
        .map(name => path.join(directory, name));
      const reconciliation = path.join(directory, 'normalization-reconciliation.json');
      return {
        name: entry.name,
        directory,
        error_files: stderrFiles.map(file => path.basename(file)),
        error_bytes: stderrFiles.reduce((sum, file) => sum + fs.statSync(file).size, 0),
        completed: fs.existsSync(reconciliation),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function waitForShards(root, expectedShards, pollMilliseconds = 30_000) {
  for (;;) {
    const state = shardState(root);
    if (state.length !== expectedShards) {
      throw new Error(`Expected ${expectedShards} normalization shards, found ${state.length}`);
    }
    const failed = state.find(shard => shard.error_bytes > 0);
    if (failed) throw new Error(`${failed.name} emitted stderr evidence`);
    const completed = state.filter(shard => shard.completed).length;
    process.stdout.write(`${JSON.stringify({
      event: 'mariadb_local_normalization_waiting',
      completed_shards: completed,
      expected_shards: expectedShards,
      checked_at: new Date().toISOString(),
    })}\n`);
    if (completed === expectedShards) return state;
    await delay(pollMilliseconds);
  }
}

async function run(env = process.env) {
  const shardsRoot = path.resolve(env.MARIADB_NORMALIZATION_SHARDS_ROOT || '');
  const expectedShards = Number(env.MARIADB_NORMALIZATION_EXPECTED_SHARDS || 0);
  if (!env.MARIADB_NORMALIZATION_SHARDS_ROOT) throw new Error('MARIADB_NORMALIZATION_SHARDS_ROOT is required');
  if (!Number.isSafeInteger(expectedShards) || expectedShards < 1) {
    throw new Error('MARIADB_NORMALIZATION_EXPECTED_SHARDS must be a positive integer');
  }
  await waitForShards(shardsRoot, expectedShards);
  const manifest = await buildManifest({ env });
  const publication = await auditPublicationReadiness({ env });
  process.stdout.write(`${JSON.stringify({
    event: 'mariadb_local_normalization_completion_gate_passed',
    source_rows: manifest.source_rows,
    normalization_output_rows: manifest.totals.output_rows,
    normalization_error_rows: manifest.totals.error_rows,
    publication_review_rows: publication.review_rows,
    bundle_child_review_rows: publication.bundle_child_review_rows,
    completed_at: new Date().toISOString(),
    production_writes: 0,
  })}\n`);
  return { manifest, publication };
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({
      event: 'mariadb_local_normalization_completion_gate_error',
      error_name: error.name || 'Error',
      error_message: error.message || String(error),
      production_writes: 0,
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { run, shardState, waitForShards };

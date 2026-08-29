'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflow = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'supabase-derived-lane-dependency-audit.yml'),
  'utf8',
);

test('derived-lane dependency audit is hosted, read-only, and pinned to production', () => {
  assert.match(workflow, /SUPABASE_PROJECT_REF:\s*qnsafosakvonzgfcsphh/);
  assert.match(workflow, /runs-on:\s*windows-latest/);
  assert.match(workflow, /read_only\s*=\s*\$true/);
  assert.doesNotMatch(workflow, /\b(?:DELETE|TRUNCATE|DROP|ALTER|UPDATE|INSERT|CREATE)\b/i);
});

test('derived-lane dependency audit covers every proposed cleanup target and preservation boundary', () => {
  for (const relation of [
    'staging.listings',
    'jobs.processing_jobs',
    'raw.payload_versions',
    'raw.payloads',
  ]) {
    assert.match(workflow, new RegExp(relation.replace('.', '\\.'), 'g'));
  }
  assert.match(workflow, /foreign_keys/);
  assert.match(workflow, /dependent_views/);
  assert.match(workflow, /non_internal_triggers/);
  assert.match(workflow, /owned_sequences/);
  assert.match(workflow, /public\.raw_messages/);
  assert.match(workflow, /public\.raw_message_versions/);
  assert.match(workflow, /mariadb_raw_import_checkpoints/);
});

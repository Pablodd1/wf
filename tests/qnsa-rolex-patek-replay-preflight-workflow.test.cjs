'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflow = fs.readFileSync(path.join(
  __dirname,
  '..',
  '.github',
  'workflows',
  'qnsa-rolex-patek-replay-preflight.yml',
), 'utf8');

test('two-brand replay preflight is manual, pinned, and read-only', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /AUDIT_TWO_BRAND_REPLAY/);
  assert.match(workflow, /SUPABASE_PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.match(workflow, /read_only = \$true/);
  assert.doesNotMatch(workflow, /read_only = \$false/);
  assert.doesNotMatch(workflow, /INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|TRUNCATE\s+/i);
});

test('two-brand replay preflight enforces capacity, queue, and checkpoint evidence', () => {
  assert.match(workflow, /database_limit_gib/);
  assert.match(workflow, /minimum_headroom_gib/);
  assert.match(workflow, /max_pending_jobs/);
  assert.match(workflow, /max_failed_jobs/);
  assert.match(workflow, /jobs\.processing_jobs/);
  assert.match(workflow, /mariadb_raw_import_checkpoints/);
  assert.match(workflow, /mariadb_normalization_import_checkpoints/);
  assert.match(workflow, /evaluate-replay-preflight\.cjs/);
});

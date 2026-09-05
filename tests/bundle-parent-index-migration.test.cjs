'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(
  __dirname,
  '..',
  'supabase',
  'migrations',
  '20260722170000_bundle_parent_lookup_index.sql',
), 'utf8');

test('bundle-parent lookup uses a write-safe partial index', () => {
  assert.match(migration, /CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shadow_v4_bundle_parent_source/);
  assert.match(migration, /ON public\.normalization_shadow_v4 \(source_record_id\)/);
  assert.match(migration, /WHERE candidate_count > 1/);
  assert.doesNotMatch(migration, /UPDATE|DELETE|INSERT/i);
});

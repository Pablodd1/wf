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
  '20260722180000_reference_created_at_index.sql',
), 'utf8');

test('reference search uses a write-safe order-covering index', () => {
  assert.match(migration, /CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_watch_records_reference_created_at_desc/);
  assert.match(migration, /ON public\.watch_records \(reference, created_at DESC, id DESC\)/);
  assert.doesNotMatch(migration, /UPDATE|DELETE|INSERT/i);
});

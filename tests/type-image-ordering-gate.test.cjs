'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260810032500_reviewed_workbook_type_image_order.sql'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/supabase-type-image-ordering-gate.yml'), 'utf8');
const recovery = fs.readFileSync(path.join(root, 'supabase/migrations/20260810033500_recover_reviewed_workbook_type_image_order.sql'), 'utf8');

test('intent image ordering migration is concurrent, index-only, and workbook-scoped', () => {
  assert.match(migration, /CREATE INDEX CONCURRENTLY IF NOT EXISTS/);
  assert.match(migration, /listing_type[\s\S]*user_image_url[\s\S]*id DESC/);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/i);
  assert.doesNotMatch(migration, /staging\.listings/i);
});

test('intent ordering workflow verifies both WTB and WTS plans', () => {
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /for intent in WTB WTS/);
  assert.match(workflow, /idx_reviewed_workbook_inventory_type_exact_image_id_desc/);
  assert.doesNotMatch(workflow, /supabase db push|--include-all/);
});

test('recovery inspects validity and removes only a failed index shell', () => {
  assert.match(workflow, /WHEN target\.indexrelid IS NULL THEN 'missing'/);
  assert.match(workflow, /indisvalid AND indisready AND indislive/);
  assert.match(workflow, /if \[ "\$index_state" = "invalid" \]/);
  assert.match(workflow, /DROP INDEX CONCURRENTLY IF EXISTS[\s\S]*idx_reviewed_workbook_inventory_type_exact_image_id_desc/);
  assert.match(recovery, /SET lock_timeout = '2min'/);
  assert.match(recovery, /CREATE INDEX CONCURRENTLY IF NOT EXISTS/);
  assert.doesNotMatch(recovery, /\b(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/i);
});

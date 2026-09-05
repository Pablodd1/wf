'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(path.join(
  __dirname,
  '..',
  '.github',
  'workflows',
  'supabase-targeted-market-catalog-migration.yml',
), 'utf8');

test('targeted market migration is manual and explicitly confirmed', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /APPLY_MARKET_CATALOG_SCHEMA/);
  assert.doesNotMatch(workflow, /push:/);
});

test('targeted market migration executes only the allowlisted migrations', () => {
  assert.match(workflow, /20260722120000_strict_market_publication_view\.sql/);
  assert.match(workflow, /20260722143000_catalog_model_provenance\.sql/);
  assert.match(workflow, /20260722170000_bundle_parent_lookup_index\.sql/);
  assert.match(workflow, /20260722180000_reference_created_at_index\.sql/);
  assert.doesNotMatch(workflow, /supabase db push/);
  assert.doesNotMatch(workflow, /supabase\/migrations\/\*/);
  assert.match(workflow, /BEGIN;/);
  assert.match(workflow, /COMMIT;/);
  assert.match(workflow, /Add Trading Floor indexes without blocking writes/);
});

test('targeted market migration verifies the deployed contract', () => {
  assert.match(workflow, /trading_floor_market_listings/);
  assert.match(workflow, /'model', 'catalog_confirmed', 'catalog_match'/);
  assert.match(workflow, /has_table_privilege\('anon'/);
  assert.match(workflow, /idx_shadow_v4_bundle_parent_source/);
  assert.match(workflow, /idx_watch_records_reference_created_at_desc/);
  assert.match(workflow, /reference = '5712\/1A'/);
  assert.match(workflow, /reference = '5712\/1R'/);
  assert.match(workflow, /statement_timeout = '15s'/);
  assert.match(workflow, /ON_ERROR_STOP=1/);
});

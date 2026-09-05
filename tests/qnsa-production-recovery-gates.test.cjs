'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const readiness = fs.readFileSync(
  path.join(root, '.github/workflows/supabase-qnsa-schema-readiness-audit.yml'),
  'utf8',
);
const staging = fs.readFileSync(
  path.join(root, '.github/workflows/supabase-local-normalized-staging.yml'),
  'utf8',
);
const importer = fs.readFileSync(
  path.join(root, 'tools/mariadb-live/import-normalized-staging.cjs'),
  'utf8',
);
const sourceWidthMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260811193000_widen_normalized_source_fields.sql'),
  'utf8',
);
const normalizedStagingMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260811120000_mariadb_normalized_staging_import.sql'),
  'utf8',
);

test('schema readiness is read-only and pinned to the new pipeline project', () => {
  assert.match(readiness, /SUPABASE_PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.match(readiness, /read_only = \$true/);
  assert.doesNotMatch(readiness, /read_only = \$false/);
  assert.match(readiness, /migration_ledger_present/);
  assert.match(readiness, /reviewed_workbook_market_source_v2', 'location'/);
  assert.match(readiness, /price_research_verified_source', 'price_usd'/);
  assert.match(readiness, /ingest_mariadb_normalization_batch/);
});

test('normalized staging requires completed immutable raw evidence and never publishes', () => {
  assert.match(staging, /SUPABASE_PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.match(staging, /EXPECTED_RAW_ROWS: '1394269'/);
  assert.match(staging, /RAW_COPY_COMPLETE/);
  assert.match(staging, /other_staging_rows/);
  assert.match(staging, /MARIADB_NORMALIZED_MAX_ROWS = '500'/);
  assert.match(staging, /publication_writes -ne 0/);
  assert.match(staging, /public_image_rows/);
  assert.match(staging, /bundle_rows/);
  assert.match(staging, /WATCH_RECORDS_BEFORE/);
  assert.doesNotMatch(staging, /INSERT\s+INTO\s+public\.watch_records/i);
});

test('normalized importer supports a resumable bounded canary', () => {
  assert.match(importer, /MARIADB_NORMALIZED_MAX_ROWS/);
  assert.match(importer, /mariadb_normalized_staging_canary_complete/);
  assert.match(importer, /partial: true/);
  assert.match(importer, /publication_writes: 0/);
  assert.match(importer, /checkpoint is already beyond the requested canary boundary/);
});

test('normalized staging preserves long source-supplied identity fields', () => {
  assert.match(staging, /20260811193000_widen_normalized_source_fields\.sql/);
  assert.match(staging, /20260812010000_dated_fx_normalized_staging_transport\.sql/);
  for (const column of [
    'brand_original',
    'brand_normalized',
    'model_original',
    'model_normalized',
    'reference_original',
    'reference_normalized',
    'dial_color_original',
    'dial_color_normalized',
    'condition_original',
    'condition_normalized',
    'user_name',
    'from_name',
    'location',
  ]) {
    assert.match(sourceWidthMigration, new RegExp(`'${column}', CASE WHEN length\\(NEW\\.${column}\\)`));
    assert.match(sourceWidthMigration, new RegExp(`NEW\\.${column} := left\\(NEW\\.${column},`));
  }
  assert.match(sourceWidthMigration, /source_field_overflow/);
  assert.match(sourceWidthMigration, /BEFORE INSERT OR UPDATE ON staging\.listings/);
  assert.doesNotMatch(sourceWidthMigration, /ALTER COLUMN/);
  assert.doesNotMatch(sourceWidthMigration, /INSERT\s+INTO\s+public\.watch_records/i);
  assert.match(normalizedStagingMigration, /left\(v_candidate->>'model', 100\)/);
  assert.match(normalizedStagingMigration, /left\(v_candidate->>'dial_color', 50\)/);
  assert.match(normalizedStagingMigration, /left\(v_record#>>'\{seller_public,location\}', 100\)/);
  assert.match(normalizedStagingMigration, /'source_field_overflow', jsonb_strip_nulls/);
});

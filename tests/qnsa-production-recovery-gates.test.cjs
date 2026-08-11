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

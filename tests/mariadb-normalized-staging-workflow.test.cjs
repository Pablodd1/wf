'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflow = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'supabase-normalized-staging-import.yml'),
  'utf8',
);

test('normalized staging workflow is explicit, production-pinned, and non-cancellable', () => {
  assert.match(workflow, /Type STAGE_RECONCILED_MARIADB_NORMALIZATION/);
  assert.match(workflow, /inputs\.confirmation == 'STAGE_RECONCILED_MARIADB_NORMALIZATION'/);
  assert.match(workflow, /SUPABASE_PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.match(workflow, /runs-on: \[self-hosted, Windows, X64, watchfacts-raw-import\]/);
  assert.match(workflow, /cancel-in-progress: false/);
});

test('workflow requires exact immutable archive and normalization reconciliation', () => {
  assert.match(workflow, /default: '1394269'/);
  assert.match(workflow, /default: '620886'/);
  assert.match(workflow, /default: '773383'/);
  assert.match(workflow, /sourceCheckpoint\.complete -ne \$true/);
  assert.match(workflow, /manifest\.source_coverage_reconciled -ne \$true/);
  assert.match(workflow, /raw_checkpoint_status -ne 'RAW_COPY_COMPLETE'/);
  assert.match(workflow, /raw_messages -ne \[long\]\$env:EXPECTED_INPUT_ROWS/);
  assert.match(workflow, /raw_message_versions -ne \[long\]\$env:EXPECTED_INPUT_ROWS/);
});

test('workflow fails closed until the unsafe derived lane is empty', () => {
  assert.match(workflow, /legacy_staging_rows/);
  assert.match(workflow, /other_staging_rows/);
  assert.match(workflow, /processing_jobs -ne 0/);
  assert.match(workflow, /payload_versions -ne 0/);
  assert.match(workflow, /payloads -ne 0/);
  assert.match(workflow, /Derived-lane cleanup has not completed/);
});

test('workflow stages only safe singles and proves publication boundaries', () => {
  assert.match(workflow, /node tools\/mariadb-live\/import-normalized-staging\.cjs/);
  assert.match(workflow, /bundle_rows -ne 0/);
  assert.match(workflow, /published_image_rows -ne 0/);
  assert.match(workflow, /unverified_usd_rows -ne 0/);
  assert.match(workflow, /trading_floor_rows -ne \[long\]\$env:EXPECTED_STAGED_ROWS/);
  assert.match(workflow, /watch_records -ne \$watchRecordsBefore/);
});

test('workflow applies only the required forward migrations in order', () => {
  const migrations = [...workflow.matchAll(/'supabase\/migrations\/(20260811\d+_[^']+\.sql)'/g)].map(match => match[1]);
  assert.deepEqual(migrations, [
    '20260811120000_mariadb_normalized_staging_import.sql',
    '20260811130000_trading_floor_location_and_media_contract.sql',
    '20260811150000_trading_floor_pending_publication_contract.sql',
    '20260811170000_trading_floor_unconfirmed_source_price.sql',
  ]);
});

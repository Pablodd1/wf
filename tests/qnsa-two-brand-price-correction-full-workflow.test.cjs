'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'qnsa-two-brand-price-correction-full.yml'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260812020000_two_brand_price_correction_cursor.sql'), 'utf8');
const runner = fs.readFileSync(path.join(__dirname, '..', 'tools', 'mariadb-live', 'run-two-brand-price-correction.cjs'), 'utf8');

test('full correction is manual, GitHub-hosted, bounded, and resumable', () => {
  assert.match(workflow, /RUN_TWO_BRAND_PRICE_CORRECTION/);
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.match(workflow, /CORRECTION_PAGE_SIZE: '100'/);
  assert.match(workflow, /max_batches must be between 1 and 500/);
  assert.match(workflow, /concurrency:[\s\S]*qnsa-two-brand-price-correction/);
});

test('private census covers eligible existing singles beyond public page membership', () => {
  assert.match(migration, /mariadb_price_policy_correction_runs/);
  assert.match(migration, /brand_normalized IN \('Rolex', 'Patek Philippe'\)/);
  assert.match(migration, /listing\.parent_id IS NULL/);
  assert.match(migration, /listing_type, listing\.intent[\s\S]*= 'WTS'/);
  assert.match(migration, /JOIN public\.raw_message_versions/);
  assert.doesNotMatch(migration, /qnsa_trading_floor_page_rows/);
  assert.doesNotMatch(migration, /publication_review_status.*IN/);
});

test('cursor advancement is durable, exact, and tied to idempotent correction audit', () => {
  assert.match(migration, /idx_staging_two_brand_price_correction_cursor/);
  assert.match(migration, /ON staging\.listings \(normalization_run_key, id\)/);
  assert.match(migration, /cursor_listing_id UUID/);
  assert.match(migration, /ORDER BY listing\.id LIMIT p_scanned_rows/);
  assert.match(migration, /v_expected_last IS DISTINCT FROM p_next_cursor/);
  assert.match(migration, /mariadb_price_policy_correction_batches/);
  assert.match(migration, /p_corrected_rows \+ p_skipped_rows <> p_scanned_rows/);
  assert.match(migration, /v_run\.scanned_rows <> v_run\.census_rows/);
});

test('runner checks capacity and zero staging growth before every bounded batch', () => {
  assert.match(runner, /while \(state\.status !== 'COMPLETE' && batches < config\.maxBatches\)/);
  assert.match(runner, /safetySnapshot\(config, fetchImpl\)/g);
  assert.match(runner, /Staging row count changed during correction/);
  assert.match(runner, /staging_row_delta: 0/);
  assert.match(runner, /raw_text_logged: false/);
  assert.match(runner, /pii_logged: false/);
});

test('workflow artifacts contain only aggregate reconciliation counts', () => {
  assert.match(workflow, /Upload sanitized counts and cursor status only/);
  assert.doesNotMatch(workflow.match(/Upload sanitized counts and cursor status only[\s\S]*$/)[0], /raw_payload|source_record_id|records/);
});


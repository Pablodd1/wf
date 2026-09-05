'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflow = fs.readFileSync(path.join(
  __dirname, '..', '.github', 'workflows', 'qnsa-two-brand-price-correction-canary.yml',
), 'utf8');

test('canary is explicit, GitHub-hosted, pinned, and exactly 100 rows', () => {
  assert.match(workflow, /APPLY_TWO_BRAND_PRICE_CANARY_100/);
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.match(workflow, /SUPABASE_PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.match(workflow, /npm ci --ignore-scripts/);
  assert.match(workflow, /20260812013000_qnsa_correction_reader_grant\.sql/);
  assert.match(workflow, /QNSA_CANARY_ROWS: '100'/);
  assert.match(workflow, /input_rows -ne 100/);
  assert.match(workflow, /corrected_rows -ne 100/);
});

test('canary fetches no more than 202 exact immutable QNSA version rows', () => {
  assert.match(workflow, /WITH bounded_ids AS MATERIALIZED/);
  assert.equal((workflow.match(/qnsa_trading_floor_page_rows\('[^']+', 101, 0\)/g) || []).length, 2);
  assert.match(workflow, /JOIN public\.raw_message_versions AS version/);
  assert.match(workflow, /version\.source_record_id = listing\.source_record_id/);
  assert.match(workflow, /version\.source_hash = listing\.source_hash/);
  assert.doesNotMatch(workflow, /RAW_INPUT: C:\\/);
});

test('canary does not log or upload ephemeral raw or correction payloads', () => {
  assert.match(workflow, /Destroy ephemeral raw and private working files/);
  assert.match(workflow, /Remove-Item -LiteralPath/);
  assert.doesNotMatch(workflow.match(/Upload sanitized reconciliation evidence only[\s\S]*$/)[0], /ephemeral-qnsa-raw|ephemeral-correction-records|ephemeral-fx/);
  assert.doesNotMatch(workflow, /Write-Output.*raw_payload|Tee-Object.*ephemeral-qnsa-raw/);
});

test('canary proves exact zero staging-row delta and durable audit membership', () => {
  assert.match(workflow, /staging_row_delta/);
  assert.match(workflow, /staging_row_delta -ne 0/);
  assert.match(workflow, /audit_rows -ne 100/);
  assert.match(workflow, /mariadb_price_policy_correction_audit/);
  assert.match(workflow, /duplicate_staging_rows_created -ne 0/);
});

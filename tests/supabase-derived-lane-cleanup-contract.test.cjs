'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflow = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'supabase-derived-lane-cleanup.yml'),
  'utf8',
);

test('derived-lane cleanup is manual, production-gated, and project-pinned', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /APPROVE_QNSA_DERIVED_LANE_CLEANUP/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /SUPABASE_PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.doesNotMatch(workflow, /schedule:/);
});

test('cleanup requires exact audited counts and locks the operation', () => {
  assert.match(workflow, /EXPECTED_STAGING_LISTINGS/);
  assert.match(workflow, /EXPECTED_PROCESSING_JOBS/);
  assert.match(workflow, /EXPECTED_PAYLOAD_VERSIONS/);
  assert.match(workflow, /EXPECTED_PAYLOADS/);
  assert.match(workflow, /pg_advisory_xact_lock/);
  assert.match(workflow, /Derived-lane counts changed after audit/);
});

test('cleanup targets only the four reconstructable derived tables', () => {
  const truncate = workflow.match(/TRUNCATE TABLE([\s\S]*?);/i)?.[1] || '';
  assert.match(truncate, /staging\.listings/);
  assert.match(truncate, /jobs\.processing_jobs/);
  assert.match(truncate, /raw\.payload_versions/);
  assert.match(truncate, /raw\.payloads/);
  assert.doesNotMatch(truncate, /public\.raw_messages/);
  assert.doesNotMatch(truncate, /public\.raw_message_versions/);
  assert.doesNotMatch(truncate, /CASCADE/i);
});

test('immutable raw evidence must reconcile before and after cleanup', () => {
  assert.match(workflow, /v_raw_message_versions <> v_raw_messages/);
  assert.match(workflow, /v_import_errors <> 0/);
  assert.match(workflow, /Immutable evidence changed during derived-lane cleanup/);
  assert.match(workflow, /raw_messages[^\n]*SELECT count\(\*\) FROM public\.raw_messages/);
  assert.match(workflow, /raw_message_versions[^\n]*SELECT count\(\*\) FROM public\.raw_message_versions/);
});

test('management query is explicitly write-enabled only in the guarded cleanup step', () => {
  assert.match(workflow, /read_only = \$false/);
  assert.doesNotMatch(workflow, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(workflow, /DATABASE_URL/);
});

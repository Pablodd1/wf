'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflow = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'supabase-targeted-exact-review-migration.yml'),
  'utf8',
);

test('exact-review deployment is manual, allowlisted, and record-neutral', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /APPLY_EXACT_REVIEW_SCHEMA/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /20260726181000_exact_seller_lineage_review\.sql/);
  assert.doesNotMatch(workflow, /supabase db push|--include-all/);
  assert.match(workflow, /Exact-review schema prerequisites are missing/);
  assert.match(workflow, /WATCH_DEALERS_BEFORE/);
  assert.match(workflow, /SELLER_APPLIED_BEFORE/);
  assert.match(workflow, /IMAGE_VERIFIED_BEFORE/);
  assert.match(workflow, /test "\$watch_dealers_after" = "\$WATCH_DEALERS_BEFORE"/);
  assert.match(workflow, /test "\$seller_applied_after" = "\$SELLER_APPLIED_BEFORE"/);
  assert.match(workflow, /test "\$image_verified_after" = "\$IMAGE_VERIFIED_BEFORE"/);
});

test('exact-review deployment verifies private service-role-only controls', () => {
  assert.match(workflow, /seller_lineage_review_events/);
  assert.match(workflow, /seller_lineage_review_queue/);
  assert.match(workflow, /apply_seller_lineage_review_decision\(bigint,text,uuid,text,text,text\)/);
  assert.match(workflow, /relrowsecurity/);
  assert.match(workflow, /has_table_privilege\('anon'/);
  assert.match(workflow, /has_table_privilege\('authenticated'/);
  assert.match(workflow, /has_table_privilege\('service_role'/);
  assert.match(workflow, /has_function_privilege/);
  assert.match(workflow, /ORDER BY lineage_id LIMIT 5/);
});

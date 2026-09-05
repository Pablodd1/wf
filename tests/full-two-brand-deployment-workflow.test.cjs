'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflow = fs.readFileSync(path.join(
  __dirname,
  '..',
  '.github',
  'workflows',
  'supabase-targeted-full-two-brand-release.yml',
), 'utf8');

test('full two-brand deployment is manual, allowlisted, and privacy-verified', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /APPLY_FULL_TWO_BRAND_RELEASE/);
  assert.match(workflow, /20260727190000_full_rolex_patek_release\.sql/);
  assert.doesNotMatch(workflow, /supabase db push/);
  assert.match(workflow, /has_table_privilege\('anon', 'public\.two_brand_verified_trading_release', 'SELECT'\)/);
  assert.match(workflow, /two_brand_identity_review_queue/);
  assert.match(workflow, /ORDER BY record_id DESC[\s\S]*LIMIT 100/);
  assert.match(workflow, /synchronous global disposition scan is intentionally excluded/);
  assert.match(workflow, /Full Rolex and Patek release census/);
  assert.match(workflow, /tee -a "\$GITHUB_STEP_SUMMARY"/);
});

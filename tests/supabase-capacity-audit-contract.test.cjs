'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'supabase-capacity-audit.yml'), 'utf8');

test('capacity audit remains explicitly read-only and pinned to the production pipeline project', () => {
  assert.match(workflow, /SUPABASE_PROJECT_REF:\s*qnsafosakvonzgfcsphh/);
  assert.match(workflow, /runs-on:\s*windows-latest/);
  assert.match(workflow, /read_only\s*=\s*\$true/);
  assert.doesNotMatch(workflow, /\b(?:DELETE|TRUNCATE|DROP|ALTER|UPDATE|INSERT)\b/i);
});

test('capacity audit measures staging lineage, statuses, media leakage, and rating claims', () => {
  assert.match(workflow, /staging_lineage/);
  assert.match(workflow, /staging_statuses/);
  assert.match(workflow, /children_with_media/);
  assert.match(workflow, /rows_claiming_exactly_five_rating/);
  assert.match(workflow, /raw_payload_versions/);
  assert.match(workflow, /staging_source_submission_column_present/);
  assert.match(workflow, /eligible_without_catalog_confirmation/);
  assert.match(workflow, /eligible_child_rows/);
  assert.match(workflow, /raw_platforms/);
  assert.match(workflow, /job_statuses/);
});

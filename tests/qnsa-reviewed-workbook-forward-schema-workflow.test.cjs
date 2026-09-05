'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(path.join(
  root, '.github/workflows/qnsa-reviewed-workbook-forward-schema.yml',
), 'utf8');
const migrationPaths = [
  'supabase/migrations/20260817013000_reviewed_workbook_multi_parent_type.sql',
  'supabase/migrations/20260817020000_reviewed_workbook_dealer_links.sql',
];

test('workflow is pinned to QNSA Management API and exact audit/apply confirmations', () => {
  assert.match(workflow, /SUPABASE_PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.match(workflow, /SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/);
  assert.match(workflow, /options: \[audit, apply\]/);
  assert.match(workflow, /AUDIT_QNSA_REVIEWED_WORKBOOK_FORWARD_SCHEMA/);
  assert.match(workflow, /APPLY_QNSA_REVIEWED_WORKBOOK_FORWARD_SCHEMA/);
  assert.match(workflow, /CONFIRMATION -cne \$expectedConfirmation/);
  assert.match(workflow, /api\.supabase\.com\/v1\/projects\/\$env:SUPABASE_PROJECT_REF\/database\/query/);
});

test('workflow compiles by rollback and applies both forward migrations atomically', () => {
  for (const migrationPath of migrationPaths) assert.ok(workflow.includes(migrationPath));
  assert.match(workflow, /\$compileSql = "BEGIN;`n\$forwardBody`nROLLBACK;"/);
  assert.match(workflow, /\$applySql = "BEGIN;`n\$forwardBody`nCOMMIT;"/);
  assert.match(workflow, /if \(\$env:MODE -eq 'apply'\)/);
  assert.match(workflow, /Nested transaction control remains/);
});

test('workflow verifies inventory immutability and complete private sidecar schema', () => {
  assert.match(workflow, /Inventory row count changed during schema workflow/);
  assert.match(workflow, /reviewed_workbook_inventory_listing_type_check/);
  assert.match(workflow, /reviewed_workbook_dealer_link_evidence_no_contact/);
  assert.match(workflow, /idx_reviewed_workbook_dealer_links_profile/);
  assert.match(workflow, /relrowsecurity/);
  assert.match(workflow, /NOT has_table_privilege\('anon', to_regclass/);
  assert.match(workflow, /NOT has_table_privilege\('authenticated', to_regclass/);
  assert.match(workflow, /has_table_privilege\('service_role', to_regclass/);
  assert.match(workflow, /contype = 'f'/);
  assert.match(workflow, /Workbook import: not run/);
});

test('allowlisted forward migrations and workflow contain no inventory DML or importer', () => {
  for (const migrationPath of migrationPaths) {
    const sql = fs.readFileSync(path.join(root, migrationPath), 'utf8')
      .replace(/^\s*--.*$/gm, '');
    assert.doesNotMatch(sql, /\b(?:INSERT\s+INTO|UPDATE\s+[^;]+\s+SET|DELETE\s+FROM|TRUNCATE|COPY)\b/i);
  }
  assert.doesNotMatch(workflow, /import-approved-admission-workbook|import-reviewed-workbook-inventory|npm run import:/i);
  assert.match(workflow, /Inventory DML is forbidden/);
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260817000000_qnsa_reviewed_workbook_inventory_bootstrap.sql'), 'utf8');
const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'qnsa-reviewed-workbook-bootstrap.yml'), 'utf8');
const checkpointMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260817001000_qnsa_reviewed_workbook_checkpoint_bootstrap.sql'), 'utf8');

test('forward bootstrap is isolated, service-only, and indexed', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.reviewed_workbook_inventory/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL[\s\S]*PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE[\s\S]*service_role/);
  assert.match(migration, /idx_reviewed_workbook_inventory_brand_image_price/);
  assert.match(migration, /idx_reviewed_workbook_verified_reference_wts/);
  assert.doesNotMatch(migration, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+(?:public\.)?(?:watch_records|raw_messages)|(?:INSERT INTO|UPDATE|DELETE FROM)\s+staging\.listings/i);
});

test('checkpoint bootstrap restores the existing summary dependency without touching inventory rows', () => {
  assert.match(checkpointMigration, /CREATE TABLE IF NOT EXISTS public\.reviewed_workbook_import_checkpoints/);
  assert.match(checkpointMigration, /reviewed_workbook_checkpoint_reconciles/);
  assert.match(checkpointMigration, /ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(checkpointMigration, /INSERT INTO|UPDATE public\.reviewed_workbook_inventory|DELETE FROM/i);
  assert.match(workflow, /20260817001000_qnsa_reviewed_workbook_checkpoint_bootstrap\.sql/);
});

test('workflow is QNSA-pinned, confirmation-gated, and read-only in audit mode', () => {
  assert.match(workflow, /SUPABASE_PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.match(workflow, /AUDIT_QNSA_WORKBOOK_BOOTSTRAP/);
  assert.match(workflow, /APPLY_QNSA_WORKBOOK_BOOTSTRAP/);
  assert.match(workflow, /if \(\$env:MODE -eq 'apply' -and -not \$before\[0\]\.table_name\)/);
  assert.match(workflow, /read_only = \$readOnly/);
});

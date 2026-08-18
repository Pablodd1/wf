'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflow = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'supabase-capacity-audit.yml'),
  'utf8',
);

test('capacity audit is manual, read-only, production-scoped, and secret-safe', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /AUDIT_SUPABASE_CAPACITY/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /SUPABASE_PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.match(workflow, /read_only = \$true/);
  assert.match(workflow, /pg_database_size\(current_database\(\)\)/);
  assert.match(workflow, /pg_total_relation_size/);
  assert.match(workflow, /mariadb_raw_import_checkpoints/);
  assert.doesNotMatch(workflow, /api-keys\?reveal|service_role|DATABASE_URL|PGPASSWORD/);
  assert.doesNotMatch(workflow, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE)\b/i);
  assert.doesNotMatch(workflow, /pull_request:|push:/);
});

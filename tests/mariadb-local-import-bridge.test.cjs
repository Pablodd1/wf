'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'supabase-local-immutable-raw-import.yml'), 'utf8');
const proxy = fs.readFileSync(path.join(root, 'tools', 'mariadb-live', 'postgres-rpc-proxy.py'), 'utf8');

test('local import workflow is manual, production-scoped, and uniquely self-hosted', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /IMPORT_IMMUTABLE_MARIADB_RAW/);
  assert.match(workflow, /runs-on: \[self-hosted, Windows, X64, watchfacts-raw-import\]/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /EXPECTED_PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.match(workflow, /SUPABASE_PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.doesNotMatch(workflow, /SUPABASE_PROJECT_REF:\s*\$\{\{\s*secrets\./);
  assert.match(workflow, /api-keys\?reveal=true/);
  assert.match(workflow, /::add-mask::\$env:SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(workflow, /20260810104500_self_contained_immutable_mariadb_raw_import\.sql/);
  assert.match(workflow, /20260810110000_compact_mariadb_raw_envelopes\.sql/);
  assert.match(workflow, /pg_database_size\(current_database\(\)\)/);
  assert.doesNotMatch(workflow, /20260810100000_immutable_mariadb_raw_import\.sql/);
  assert.doesNotMatch(workflow, /20260810103000_complete_immutable_mariadb_raw_import\.sql/);
  assert.match(workflow, /database\/query/);
  assert.match(workflow, /NOTIFY pgrst, 'reload schema'/);
  assert.match(workflow, /\$migrationSql = \[string\]\(Get-Content -Raw/);
  assert.doesNotMatch(workflow, /SUPABASE_DB_PASSWORD|PGPASSWORD/);
  assert.doesNotMatch(workflow, /pull_request:|push:/);
});

test('workflow requires a complete reconciled collector before any import', () => {
  assert.match(workflow, /sourceCheckpoint\.complete -ne \$true/);
  assert.match(workflow, /sourceCheckpoint\.input_rows -ne \[long\]\$sourceCheckpoint\.output_rows/);
  assert.match(workflow, /sourceCheckpoint\.error_rows -ne 0/);
  assert.match(workflow, /Collector is incomplete or unreconciled/);
});

test('workflow proves zero customer and normalization writes', () => {
  assert.match(workflow, /watch_records changed during immutable raw import/);
  assert.match(workflow, /reconciliation\.watch_records_writes -ne 0/);
  assert.match(workflow, /reconciliation\.normalization_writes -ne 0/);
  assert.match(workflow, /reconciliation\.reconciled -ne \$true/);
});

test('database bridge is localhost-only, token-protected, and RPC allowlisted', () => {
  assert.match(proxy, /ThreadingHTTPServer\(\("127\.0\.0\.1", port\)/);
  assert.match(proxy, /LOCAL_RPC_TOKEN/);
  assert.match(proxy, /api_key == expected and bearer == f"Bearer \{expected\}"/);
  assert.match(proxy, /ingest_mariadb_raw_batch/);
  assert.match(proxy, /complete_mariadb_raw_import/);
  assert.match(proxy, /raise ValueError\("RPC is not allowed"\)/);
  assert.doesNotMatch(proxy, /watch_records\s+(?:SET|VALUES)|(?:INSERT|UPDATE|DELETE).*watch_records/i);
});

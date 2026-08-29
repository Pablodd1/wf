'use strict';
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/qnsa-zenith-exact-trading-release.yml'), 'utf8');

test('Zenith exact release is QNSA-pinned, allowlisted, compiled, and consent-smoked', () => {
  assert.match(workflow, /PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.match(workflow, /20260815121500_qnsa_zenith_exact_reference_rows\.sql/);
  assert.match(workflow, /BEGIN;`n\$migration`nROLLBACK;/);
  assert.match(workflow, /03\.2522\.400/);
  assert.match(workflow, /unconsented_phone/);
  assert.match(workflow, /\$migration = \[string\]\(Get-Content -Raw -LiteralPath \$env:MIGRATION_FILE\)/);
  assert.doesNotMatch(workflow, /supabase db push|--include-all|migration repair/i);
});

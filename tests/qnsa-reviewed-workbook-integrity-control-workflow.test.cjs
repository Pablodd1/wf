'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(path.join(
  root, '.github/workflows/qnsa-reviewed-workbook-integrity-control.yml',
), 'utf8');

test('integrity control workflow is serialized, QNSA pinned, and explicitly authorized', () => {
  assert.match(workflow, /group: qnsa-reviewed-workbook-integrity-control/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /SUPABASE_PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.match(workflow, /APPLY_QNSA_REVIEWED_WORKBOOK_CANARY/);
  assert.match(workflow, /APPLY_QNSA_REVIEWED_WORKBOOK_FULL_AFTER_CANARY/);
  assert.match(workflow, /Canary must request 1\.\.10 total exact rows/);
  assert.match(workflow, /max_legacy/);
  assert.match(workflow, /max_residual/);
  assert.match(workflow, /--residual-identity-manifest/);
  assert.match(workflow, /--run-sha/);
});

test('write modes retrieve a masked service credential through management authorization', () => {
  assert.match(workflow, /SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/);
  assert.match(workflow, /api-keys\?reveal=true/);
  assert.match(workflow, /::add-mask::/);
  assert.match(workflow, /if: inputs\.mode != 'audit'/);
});

test('full mode proves PITR or captures an exact recovery snapshot before correction', () => {
  assert.match(workflow, /Verify QNSA recovery or capture exact pre-change snapshot/);
  assert.match(workflow, /\/database\/backups/);
  assert.match(workflow, /pitr_enabled -ne \$true/);
  assert.match(workflow, /snapshot-reviewed-workbook-integrity\.cjs/);
  assert.match(workflow, /Exact pre-change recovery snapshot failed/);
  assert.match(workflow, /recovery-proof\.json/);
  assert.match(workflow, /recovery-snapshot\.json/);
});

test('untrusted dispatch inputs are passed through step env and management token is narrowly scoped', () => {
  const lines = workflow.split(/\r?\n/);
  const scripts = [];
  let current = null;
  for (const line of lines) {
    if (/^        run: \|$/.test(line)) { current = []; scripts.push(current); continue; }
    if (current && (/^      - /.test(line) || (/^        [A-Za-z_-]+:/.test(line) && !/^          /.test(line)))) current = null;
    else if (current) current.push(line);
  }
  assert.doesNotMatch(scripts.flat().join('\n'), /\$\{\{\s*inputs\./);
  const jobEnv = workflow.slice(workflow.indexOf('    env:'), workflow.indexOf('    steps:'));
  assert.doesNotMatch(jobEnv, /SUPABASE_ACCESS_TOKEN/);
  assert.equal((workflow.match(/SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/g) || []).length, 3);
});

test('full mode downloads and binds a successful prior workflow receipt', () => {
  assert.match(workflow, /prior_canary_run_id/);
  assert.match(workflow, /gh run view/);
  assert.match(workflow, /gh run download/);
  assert.match(workflow, /execution-report\.json/);
  assert.match(workflow, /--canary-report/);
  assert.match(workflow, /actions: read/);
});

test('workflow persists exact plan, receipt, and checkpoint artifacts', () => {
  assert.match(workflow, /control-plan\.json/);
  assert.match(workflow, /execution-checkpoint\.json/);
  assert.match(workflow, /execution-report\.json/);
  assert.match(workflow, /if: always\(\)/);
});

test('checked three-brand control manifests are PII-free and exact sized', () => {
  const fixtures = [
    ['identity-conflicts-245.csv', 245],
    ['three-brand-price-regressions-36.csv', 36],
    ['legacy-ledger-price-drift-252.csv', 252],
    ['residual-identity-conflicts-84.csv', 84],
  ];
  for (const [file, expectedRows] of fixtures) {
    const content = fs.readFileSync(path.join(root, 'data/reviewed-workbook-integrity', file), 'utf8');
    const lines = content.trim().split(/\r?\n/);
    assert.equal(lines.length - 1, expectedRows);
    assert.doesNotMatch(lines[0], /raw|phone|name|message|dealer|seller/i);
    assert.match(lines[0], /listing_id/);
    assert.match(lines[0], /source_payload_sha256/);
    assert.match(lines[0], /action/);
    assert.match(lines[0], /expected_status/);
    assert.match(lines[0], /new_status/);
  }
});

test('legacy drift manifest preserves all rows while nulling only no-price evidence', () => {
  const content = fs.readFileSync(path.join(
    root, 'data/reviewed-workbook-integrity/legacy-ledger-price-drift-252.csv',
  ), 'utf8');
  const rows = content.trim().split(/\r?\n/).slice(1);
  assert.equal(rows.filter(row => row.includes(',"true","LEGACY_PRICE_NULL",')).length, 81);
  assert.equal(rows.filter(row => row.includes(',"false","LEGACY_PRICE_RETAIN",')).length, 171);
});

test('fixed canary metadata covers every required correction class including dual action', () => {
  const directory = path.join(root, 'data/reviewed-workbook-integrity');
  const combined = [
    'identity-conflicts-245.csv',
    'residual-identity-conflicts-84.csv',
    'three-brand-price-regressions-36.csv',
    'legacy-ledger-price-drift-252.csv',
  ].map(file => fs.readFileSync(path.join(directory, file), 'utf8')).join('\n');
  for (const category of [
    'RAW_BRAND_CONFLICT', 'CATALOG_BRAND_CONFLICT', 'YEAR_TOKEN_REFERENCE',
    'DUAL_IDENTITY_PRICE', 'THREE_BRAND_CURRENCY_REGRESSION',
    'LEGACY_PRICE_NULL', 'LEGACY_PRICE_RETAIN',
    'RESIDUAL_TAG_RM_DUAL', 'RESIDUAL_BREGUET_JLC_DUAL', 'RESIDUAL_CATALOG_CONFLICT',
  ]) assert.match(combined, new RegExp(category));
  const identity = fs.readFileSync(path.join(directory, 'identity-conflicts-245.csv'), 'utf8');
  assert.equal((identity.match(/,"true",/g) || []).length, 2);
  const residual = fs.readFileSync(path.join(directory, 'residual-identity-conflicts-84.csv'), 'utf8');
  assert.equal((residual.match(/,LIVE_QUALIFIED,/g) || []).length, 3);
  assert.equal((residual.match(/,PRIOR_CONTROL,/g) || []).length, 19);
});

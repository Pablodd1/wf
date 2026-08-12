'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(
  __dirname,
  '..',
  'supabase',
  'migrations',
  '20260812210000_qnsa_audemars_piguet_reviewed_release.sql',
), 'utf8');

const workflow = fs.readFileSync(path.join(
  __dirname,
  '..',
  '.github',
  'workflows',
  'qnsa-audemars-piguet-reviewed-release.yml',
), 'utf8');

test('forward migration extends both existing release-control constraints', () => {
  assert.match(migration, /DROP CONSTRAINT IF EXISTS qnsa_two_brand_release_brand_check/);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS qnsa_two_brand_release_ledger_brand_check/);
  assert.match(migration, /'Rolex', 'Patek Philippe', 'Audemars Piguet'/);
});

test('Audemars Piguet control is installed fail-closed', () => {
  assert.match(migration, /VALUES \(\s*'Audemars Piguet',\s*false,\s*false,/s);
  assert.match(migration, /ON CONFLICT \(canonical_brand\) DO NOTHING/);
});

test('compatibility base preserves immutable lineage and strict single-watch gates', () => {
  assert.match(migration, /CREATE OR REPLACE VIEW public\.qnsa_rolex_patek_reviewed_release_base/);
  assert.match(migration, /JOIN public\.raw_message_versions AS rv/);
  assert.match(migration, /rv\.id = l\.raw_message_version_id/);
  assert.match(migration, /rv\.source_record_id = l\.source_record_id/);
  assert.match(migration, /rv\.source_hash = l\.source_hash/);
  assert.match(migration, /l\.parent_id IS NULL/);
  assert.match(migration, /COALESCE\(l\.is_bundle, false\) = false/);
  assert.match(migration, /'SINGLE_CANDIDATE'/);
  assert.match(migration, /bundle_child_pending_review/);
  assert.match(migration, /suppressed_exact_duplicate/);
});

test('Audemars Piguet receives reference and price-RPC access indexes', () => {
  for (const indexName of [
    'idx_staging_qnsa_ap_release_brand_posted',
    'idx_staging_qnsa_ap_reference_price_order',
    'idx_staging_qnsa_ap_price_reference_rpc',
  ]) {
    assert.match(migration, new RegExp(`CREATE INDEX IF NOT EXISTS ${indexName}`));
  }
  assert.match(migration, /brand_normalized = 'Audemars Piguet'/);
});

test('migration is forward-only and never mutates retired or source-fact data', () => {
  assert.doesNotMatch(migration, /(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?public\.watch_records/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+(?:staging\.listings|public\.raw_message_versions)/i);
  assert.doesNotMatch(migration, /TRUNCATE/i);
});

test('workflow requires explicit audit or enable authorization and stays disabled during audit', () => {
  assert.match(workflow, /AUDIT_QNSA_AUDEMARS/);
  assert.match(workflow, /ENABLE_QNSA_AUDEMARS/);
  assert.match(workflow, /SUPABASE_PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.match(workflow, /trading_floor_enabled = false/);
  assert.match(workflow, /price_research_enabled = false/);
  assert.match(workflow, /if: inputs\.mode == 'enable'/);
});

test('workflow gates release on completed normalization, usable WTS and clean lineage', () => {
  assert.match(workflow, /NORMALIZATION_STAGED/);
  assert.match(workflow, /priced_wts_total/);
  assert.match(workflow, /lineage_failures/);
  assert.match(workflow, /bundle_or_child_leaks/);
  assert.match(workflow, /qnsa_rolex_patek_trading_floor_source/);
  assert.match(workflow, /qnsa_rolex_patek_price_research_source/);
  assert.match(workflow, /qnsa_rolex_patek_wtb_demand_source/);
  assert.match(workflow, /\$armSql = @"/);
  assert.match(workflow, /\$armed = Invoke-RestMethod/);
  assert.doesNotMatch(workflow, /WITH checkpoint AS \([\s\S]*?\), armed AS \(/);
  assert.match(workflow, /EXISTS \(SELECT 1 FROM public\.qnsa_rolex_patek_trading_floor_source/);
  assert.doesNotMatch(workflow, /count\(\*\) FROM public\.qnsa_rolex_patek_trading_floor_source/);
});

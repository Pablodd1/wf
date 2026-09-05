'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(path.join(
  __dirname,
  '..',
  '.github',
  'workflows',
  'qnsa-rolex-patek-reviewed-release.yml',
), 'utf8');

test('workflow is pinned to QNSA and exact reconciled staging totals', () => {
  assert.match(workflow, /SUPABASE_PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.match(workflow, /EXPECTED_SOURCE_ROWS: '1394269'/);
  assert.match(workflow, /EXPECTED_STAGED_ROWS: '603678'/);
  assert.match(workflow, /EXPECTED_DEFERRED_ROWS: '790591'/);
  assert.match(workflow, /NORMALIZATION_STAGED/);
});

test('audit and enable require different exact confirmation phrases', () => {
  assert.match(workflow, /AUDIT_QNSA_ROLEX_PATEK/);
  assert.match(workflow, /ENABLE_QNSA_ROLEX_PATEK/);
  assert.match(workflow, /inputs\.mode == 'enable'/);
});

test('workflow applies only the reviewed release migrations', () => {
  assert.match(workflow, /pg_get_viewdef\('public\.qnsa_rolex_patek_reviewed_release_base'/);
  assert.match(workflow, /already installed/);
  assert.match(workflow, /20260811190000_qnsa_rolex_patek_reviewed_release\.sql/);
  assert.match(workflow, /20260811220000_qnsa_source_backed_public_fields\.sql/);
  assert.match(workflow, /legacy watch_records write/);
});

test('audit proves release stays dark before enablement', () => {
  assert.match(workflow, /SET statement_timeout = '10min'/);
  assert.match(workflow, /FROM staging\.listings AS l/);
  assert.match(workflow, /has_trading_candidate/);
  assert.match(workflow, /has_priced_wts_candidate/);
  assert.match(workflow, /trading_floor_enabled -eq \$true/);
  assert.match(workflow, /price_research_enabled -eq \$true/);
  assert.match(workflow, /Reviewed-release candidate audit failed/);
});

test('enabled verification requires both brands in trading and price views', () => {
  assert.match(workflow, /Both Rolex and Patek must be present in Trading Floor and Price Research/);
  assert.match(workflow, /qnsa_rolex_patek_trading_floor_source/);
  assert.match(workflow, /qnsa_rolex_patek_price_research_source/);
  assert.match(workflow, /ARRAY\['116500LN', '116500'\]/);
  assert.match(workflow, /'5712\/1A-001'/);
  assert.match(workflow, /WITH brands\(brand, ref_set\)/);
  assert.match(workflow, /p\.reference = ANY\(brands\.ref_set\)/);
  assert.match(workflow, /t\.normalized_reference = ANY\(brands\.ref_set\)/);
  assert.doesNotMatch(workflow, /WITH brands\(brand, references\)/);
  assert.doesNotMatch(workflow, /p\.canonical_brand/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'vercel-qnsa-cutover.yml'), 'utf8');
const releaseWorkflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'qnsa-rolex-patek-reviewed-release.yml'), 'utf8');

test('cutover is pinned and explicitly authorized', () => {
  assert.match(workflow, /CUTOVER_VERCEL_TO_QNSA/);
  assert.match(workflow, /SUPABASE_PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.match(workflow, /input_rows -ne 1394269/);
});

test('cutover requires both release controls enabled', () => {
  assert.match(workflow, /trading_floor_enabled -ne \$true/);
  assert.match(workflow, /price_research_enabled -ne \$true/);
});

test('secrets are retrieved and masked without artifacts', () => {
  assert.match(workflow, /api-keys\?reveal=true/);
  assert.match(workflow, /::add-mask::/);
  assert.doesNotMatch(workflow, /QNSA_SERVICE_KEY.*Upload/);
});

test('production variables and reviewed two-brand gates are updated', () => {
  for (const name of [
    'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY', 'PUBLICATION_BRANDS', 'PUBLICATION_REFERENCES',
    'TRADING_FLOOR_SOURCE_VIEW', 'PRICE_RESEARCH_SOURCE_VIEW',
  ]) assert.match(workflow, new RegExp(`Set-VercelEnv '${name}'`));
  assert.match(workflow, /Rolex\|Patek Philippe/);
  assert.match(workflow, /ALL_REVIEWED/);
  assert.match(workflow, /qnsa_rolex_patek_trading_floor_source/);
  assert.match(workflow, /qnsa_rolex_patek_price_research_source/);
});

test('cutover snapshots and restores old production values on failure', () => {
  assert.match(workflow, /env pull \.env\.vercel\.rollback/);
  assert.match(workflow, /restoring the validated previous production environment/);
  assert.match(workflow, /foreach \(\$name in \$names\)/);
  assert.match(workflow, /\$rollbackReady = \$old\['SUPABASE_URL'\] -match/);
  assert.match(workflow, /retaining the complete QNSA environment instead of restoring blank credentials/);
});

test('post-deploy smoke tests cover QNSA health, Rolex trading and Patek price research', () => {
  assert.match(workflow, /api\/health/);
  assert.match(workflow, /database_project_ref/);
  assert.match(workflow, /rolex\.records/);
  assert.match(workflow, /brand=Rolex&reference=116500/);
  assert.match(workflow, /brand=Patek%20Philippe&reference=5712/);
});

test('reviewed release installs bounded QNSA customer-query indexes', () => {
  assert.match(releaseWorkflow, /20260811230000_qnsa_release_query_indexes\.sql/);
  assert.match(releaseWorkflow, /idx_staging_qnsa_release_reference_posted/);
  assert.match(releaseWorkflow, /20260811233000_qnsa_reference_family_pattern_indexes\.sql/);
  assert.match(releaseWorkflow, /idx_staging_qnsa_release_reference_family/);
  assert.match(releaseWorkflow, /20260811234500_qnsa_release_feed_indexes\.sql/);
  assert.match(releaseWorkflow, /idx_staging_qnsa_release_global_feed/);
  assert.match(releaseWorkflow, /idx_staging_qnsa_release_brand_feed/);
  assert.match(releaseWorkflow, /20260811235500_qnsa_release_feed_indexes_v2\.sql/);
  assert.match(releaseWorkflow, /idx_staging_qnsa_release_global_feed_v2/);
  assert.match(releaseWorkflow, /idx_staging_qnsa_release_brand_feed_v2/);
});

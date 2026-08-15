'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migration = fs.readFileSync(path.join(__dirname,
  '../supabase/migrations/20260815223000_qnsa_non_watch_exact_phone_linkage.sql'), 'utf8');
const planFence = fs.readFileSync(path.join(__dirname,
  '../supabase/migrations/20260815234500_qnsa_non_watch_linkage_plan_fence.sql'), 'utf8');
const workflow = fs.readFileSync(path.join(__dirname,
  '../.github/workflows/qnsa-non-watch-dealer-linkage.yml'), 'utf8');
const runner = fs.readFileSync(path.join(__dirname,
  '../tools/dealer-directory/run-non-watch-exact-linkage.cjs'), 'utf8');

test('non-watch linkage is exact-lineage, singleton-only, and never name inferred', () => {
  assert.match(migration, /raw_version\.source_record_id = listing\.source_record_id/);
  assert.match(migration, /raw_version\.source_hash = listing\.source_hash/);
  assert.match(migration, /normalize_seller_phone_identity[\s\S]*raw_data,from_number/);
  assert.match(migration, /identity\.verification_status = 'VERIFIED'/);
  assert.match(migration, /dealer\.status = 'VERIFIED'/);
  assert.match(migration, /upper\(COALESCE\(listing\.category, ''\)\) IN \('HANDBAG', 'JEWELRY', 'ACCESSORY'\)/);
  assert.match(migration, /listing\.parent_id IS NULL/);
  assert.match(migration, /COALESCE\(listing\.is_bundle, false\) = false/);
  assert.match(migration, /bundle_status' = 'SINGLE_CANDIDATE'/);
  assert.doesNotMatch(migration, /seller_name\s*=/i);
  assert.doesNotMatch(migration, /display_name\s*=/i);
});

test('non-watch linkage preserves raw/staging and keeps contact private and consent gated', () => {
  assert.doesNotMatch(migration, /UPDATE\s+(?:public\.raw|staging\.listings)/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM/i);
  assert.match(migration, /INSERT INTO public\.dealer_listing_links/);
  assert.match(migration, /'contact_value_private', true/);
  assert.match(migration, /'public_contact_requires_dealer_consent', true/);
  assert.match(migration, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(migration, /RETURNS TABLE[\s\S]*(?:phone|contact)/i);
});

test('workflow offers read-only audit and requires explicit capped write confirmations', () => {
  assert.match(workflow, /options: \[audit, canary, full\]/);
  assert.match(workflow, /AUDIT_QNSA_NON_WATCH_LINKAGE/);
  assert.match(workflow, /CANARY_QNSA_NON_WATCH_LINKAGE/);
  assert.match(workflow, /FULL_QNSA_NON_WATCH_LINKAGE/);
  assert.match(workflow, /NON_WATCH_LINKAGE_CANARY_LIMIT: '10'/);
  assert.match(workflow, /if \(\$env:NON_WATCH_LINKAGE_MODE -ne 'audit'\)/);
  assert.match(workflow, /read_only = \$true/);
  assert.match(workflow, /qnsa_market_feed_count_snapshot/);
  assert.match(workflow, /orphan_link_exists[\s\S]*NOT EXISTS/);
  assert.match(workflow, /duplicate_verified_phone_exists[\s\S]*HAVING count\(DISTINCT dealer_id\)>1/);
  assert.doesNotMatch(workflow,
    /count\s*\(\*\)[\s\S]{0,240}FROM\s+(?:staging\.listings|public\.dealer_listing_links)/i);
  assert.doesNotMatch(workflow,
    /FROM\s+public\.dealer_listing_links[\s\S]{0,240}GROUP BY/i);
  assert.doesNotMatch(workflow,
    /JOIN\s+staging\.listings[\s\S]{0,240}count\s*\(/i);
  assert.match(workflow, /inputs\.install_contract && inputs\.mode != 'audit'/);
  assert.match(workflow, /SUPABASE_PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.doesNotMatch(workflow, /raw_payload\s+AS\s+evidence|raw_message\s+AS\s+evidence/i);
  assert.doesNotMatch(workflow, /matched_phone[\s\S]*Set-Content/i);
});

test('audit uses split bounded evidence instead of population-wide aggregate joins', () => {
  assert.match(workflow, /Invoke-ReadOnlyAuditQuery \$controlSql/);
  assert.match(workflow, /Invoke-ReadOnlyAuditQuery \$identitySql/);
  assert.match(workflow, /Invoke-ReadOnlyAuditQuery \$ledgerSql/);
  assert.match(workflow, /link_ledger_estimated_rows[\s\S]*reltuples/);
  assert.doesNotMatch(workflow, /released_singletons_by_category/);
  assert.doesNotMatch(workflow, /existing_links_by_category/);
});

test('runner reconciles applied deltas and requires full cursor exhaustion', () => {
  assert.match(runner, /Canary write cap was exceeded/);
  assert.match(runner, /Full linkage cannot complete before cursor exhaustion/);
  assert.match(runner, /totals\.scanned !== finalCount/);
  assert.match(runner, /applied_non_watch_links[\s\S]*totals\.applied/);
  assert.match(runner, /raw_text_logged: false, pii_logged: false/);
  assert.match(runner, /EXPLAIN \(FORMAT TEXT, COSTS TRUE\)/);
  assert.match(runner, /raw_message_versions_pkey/);
  assert.match(runner, /idx_staging_mariadb_raw_version/);
  assert.match(runner, /Nested Loop/);
  assert.ok(runner.indexOf('const before = await reconciliation')
    < runner.indexOf('while (!cursorExhausted)'));
});

test('runner input validation is bounded and QNSA pinned', () => {
  const { EXPECTED_PROJECT, boundedInteger, safeUuid } = require(
    '../tools/dealer-directory/run-non-watch-exact-linkage.cjs');
  assert.equal(EXPECTED_PROJECT, 'qnsafosakvonzgfcsphh');
  assert.equal(boundedInteger('10', 1, 1, 10, 'limit'), 10);
  assert.throws(() => boundedInteger('11', 1, 1, 10, 'limit'));
  assert.equal(safeUuid('123e4567-e89b-12d3-a456-426614174000'),
    '123e4567-e89b-12d3-a456-426614174000');
  assert.throws(() => safeUuid('not-a-uuid'));
});

test('forward repair fences raw pages and removes unbounded reconciliation', () => {
  assert.match(planFence, /LIMIT v_limit/);
  assert.match(planFence, /JOIN LATERAL/);
  assert.match(planFence, /idx_staging_mariadb_raw_version/);
  assert.match(planFence, /OFFSET 0/);
  assert.match(planFence, /COALESCE\(p_limit, 500\), 1\), 1000/);
  const reconciliation = planFence.match(
    /CREATE OR REPLACE FUNCTION public\.qnsa_non_watch_dealer_linkage_reconciliation\(\)[\s\S]*?\n\$\$;/)?.[0] || '';
  assert.match(reconciliation, /source_system='QNSA_NON_WATCH_RELEASE_GATED_RAW_LINEAGE'/);
  assert.doesNotMatch(reconciliation, /qnsa_market_feed_control/);
  assert.doesNotMatch(reconciliation, /JOIN staging\.listings/);
  assert.doesNotMatch(reconciliation, /eligible_released_non_watch/);
  assert.match(workflow, /20260815234500_qnsa_non_watch_linkage_plan_fence\.sql/);
  assert.match(workflow, /NON_WATCH_LINKAGE_PAGE_SIZE: '500'/);
  assert.match(workflow, /non_watch_lane_link_exists/);
  for (const marker of ['old_limit', 'old_page', 'old_identity']) {
    const oldContract = planFence.match(new RegExp(`\\$${marker}\\$([\\s\\S]*?)\\$${marker}\\$`))?.[1];
    assert.ok(oldContract && migration.includes(oldContract),
      `${marker} repair fence must match the installed base contract exactly`);
  }
});

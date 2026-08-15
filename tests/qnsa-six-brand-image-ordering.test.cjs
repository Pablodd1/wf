'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations',
  '20260815110000_qnsa_six_brand_image_lane_page.sql'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows',
  'qnsa-six-brand-image-ordering.yml'), 'utf8');

test('six-brand lane function is forward-only and reuses the existing image-order index', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.qnsa_six_brand_image_lane_page/);
  assert.match(migration, /idx_qnsa_listing_global_image_price_order_20260813/);
  assert.match(migration, /SET enable_sort = off/i);
  assert.doesNotMatch(migration, /CREATE\s+(?:UNIQUE\s+)?INDEX|REINDEX|ANALYZE|VACUUM/i);
  assert.doesNotMatch(migration,
    /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+(?:public\.raw_messages|public\.raw_message_versions|staging\.listings)/i);
});

test('enabled release controls bound the exact six-brand cohort', () => {
  for (const brand of ['Rolex', 'Patek Philippe', 'Audemars Piguet', 'Richard Mille', 'Cartier', 'Zenith']) {
    assert.match(migration, new RegExp(brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(migration, /control\.trading_floor_enabled = true/);
  assert.match(migration, /l\.normalization_run_key = enabled\.enabled_run_key/);
  assert.match(migration, /l\.brand_normalized = enabled\.canonical_brand/);
});

test('candidate scan is bounded before immutable lineage and identity joins', () => {
  const candidateStart = migration.indexOf('per_brand_candidates AS MATERIALIZED');
  const eligibleStart = migration.indexOf('eligible AS MATERIALIZED');
  assert.ok(candidateStart >= 0 && eligibleStart > candidateStart);
  const candidates = migration.slice(candidateStart, eligibleStart);
  const eligible = migration.slice(eligibleStart);
  assert.match(candidates, /LIMIT v_scan_limit \+ 1/);
  assert.doesNotMatch(candidates, /JOIN public\.raw_message_versions/);
  assert.match(eligible, /JOIN public\.raw_message_versions/);
  assert.match(eligible, /rv\.id = l\.raw_message_version_id/);
  assert.match(eligible, /rv\.source_record_id = l\.source_record_id/);
  assert.match(eligible, /rv\.source_hash = l\.source_hash/);
  assert.match(migration, /p_scan_limit INTEGER DEFAULT 500/);
  assert.match(migration, /LEAST\(GREATEST\(COALESCE\(p_scan_limit, 500\), 50\), 500\)/);
});

test('bundle, duplicate, status and brand-specific identity gates fail closed before publication', () => {
  assert.match(migration, /l\.parent_id IS NULL/);
  assert.match(migration, /COALESCE\(l\.is_bundle, false\) = false/);
  assert.match(migration, /provenance_metadata->>'bundle_status' = 'SINGLE_CANDIDATE'/);
  assert.doesNotMatch(migration, /COALESCE\(l\.provenance_metadata->>'bundle_status',\s*'SINGLE_CANDIDATE'\)/);
  for (const status of ['bundle_child_pending_review', 'bundle_pending_separation', 'suppressed_exact_duplicate']) {
    assert.match(migration, new RegExp(status));
  }
  assert.match(migration, /reference_key ~ '\^RM\[0-9\]\{3,6\}\[A-Z\]\{0,3\}\$'/);
  assert.match(migration, /reference_key ~ '\^W\[A-Z0-9\]\{5,18\}\$'/);
  assert.match(migration, /l\.brand_normalized = 'Rolex'[\s\S]*reference_key ~ '\^\[0-9\]\{4,6\}\[A-Z\]\{0,4\}\$'/);
  assert.match(migration, /l\.brand_normalized = 'Patek Philippe'[\s\S]*\^\[3-8\]\[0-9\]\{3\}/);
  assert.match(migration, /l\.brand_normalized = 'Audemars Piguet'[\s\S]*reference_key ~ '\^\[0-9\]\{5\}/);
  assert.match(migration, /reviewed_workbook_reference_is_price_token_v2/);
  assert.match(migration, /raw_message_text[\s\S]*LIKE '%' \|\| normalized\.reference_key \|\| '%'/);
  assert.match(migration, /qnsa_zenith_identity_reconciliation_audit/);
  assert.match(migration, /identity_reconciliation_status'[\s\S]*RELEASE_SAFE_EXACT_SOURCE_REFERENCE/);
});

test('media contract is exact, consent-gated, and never emits a no-image frame URL', () => {
  assert.match(migration, /\~\* '\^https\?:\/\/\[\^\[:space:\]\]\+\$'\) = p_has_image/);
  assert.match(migration, /'user_image_url', CASE WHEN p_has_image[\s\S]*ELSE NULL|THEN btrim\([\s\S]*END/);
  assert.match(migration, /'has_exact_source_image', p_has_image/);
  assert.match(migration, /CASE WHEN COALESCE\(l\.contact_consent, false\)/);
  assert.match(migration, /'contact_publication_approved', COALESCE\(l\.contact_consent, false\)/);
});

test('non-USD verified prices require complete dated FX evidence including source', () => {
  const fxConditions = migration.match(/l\.conversion_rate > 0[\s\S]{0,180}?NULLIF\(btrim\(l\.conversion_source\), ''\) IS NOT NULL/g) || [];
  assert.equal(fxConditions.length, 3,
    'status, verified amount, and verified-price boolean must all require rate, timestamp, and source');
});

test('keyset cursor is stable and reports exact consumed candidate position', () => {
  assert.match(migration, /p_after_has_price BOOLEAN/);
  assert.match(migration, /p_after_created_at TIMESTAMPTZ/);
  assert.match(migration, /p_after_id UUID/);
  assert.match(migration, /l\.created_at < p_after_created_at/);
  assert.match(migration, /l\.created_at = p_after_created_at AND l\.id < p_after_id/);
  assert.match(migration, /WHEN metrics\.selected_count = v_limit THEN metrics\.selected_last_position/);
  assert.match(migration, /ELSE metrics\.scanned_count END/);
  assert.match(migration, /'next_cursor'[\s\S]*'has_price'[\s\S]*'created_at'[\s\S]*'id'/);
});

test('targeted workflow is pinned to QNSA and has audit-only plus explicit apply modes', () => {
  assert.match(workflow, /PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.match(workflow, /options: \[audit, apply\]/);
  assert.match(workflow, /APPLY_QNSA_IMAGE_ORDER/);
  assert.match(workflow, /if: inputs\.mode == 'apply'/);
  assert.match(workflow, /\$migration = \[string\]\(Get-Content -Raw -LiteralPath \$env:MIGRATION_FILE\)/);
  assert.match(workflow, /Compile the forward migration and roll it back/);
  assert.match(workflow, /BEGIN;`n\$bodySql`nROLLBACK;/);
  assert.match(workflow, /rolled_back = \$true/);
  assert.match(workflow, /existing_order_index/);
  assert.match(workflow, /EXPLAIN \(FORMAT JSON, COSTS true\)/);
  assert.match(workflow, /Representative candidate query did not choose a proven bounded image-order index/);
  assert.match(workflow, /idx_qnsa_listing_\(global\|reference\)_image_price_order_20260813/);
  assert.match(workflow, /Audit configured six-brand media-lane scope/);
  assert.match(workflow, /source_rows_scanned',0/);
  assert.match(workflow, /enabled_brands -ne 6/);
  assert.match(workflow, /lane_entries -ne 12/);
  assert.match(workflow, /image_contract_violations/);
  assert.match(workflow, /no_image_frame_violations/);
  assert.match(workflow, /bundle_or_child_leaks/);
  assert.match(workflow, /cross_page_duplicate_ids/);
  assert.match(workflow, /max_candidate_scan/);
  assert.doesNotMatch(workflow, /bptrvfncppbjnchsaxtb/);
});

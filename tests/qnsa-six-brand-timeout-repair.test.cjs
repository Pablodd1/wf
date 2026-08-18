'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations',
  '20260815141000_qnsa_six_brand_candidate_bound_fix.sql'), 'utf8');
const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows',
  'qnsa-six-brand-image-ordering.yml'), 'utf8');
const candidateStart = sql.indexOf('per_brand_candidates AS MATERIALIZED');
const eligibleStart = sql.indexOf('eligible AS MATERIALIZED');
const candidates = sql.slice(candidateStart, eligibleStart);
const eligible = sql.slice(eligibleStart);

test('timeout repair is forward-only, storage-neutral, and forces a custom indexed plan', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.qnsa_six_brand_image_lane_page/);
  assert.match(sql, /SET plan_cache_mode = force_custom_plan/);
  assert.match(sql, /idx_qnsa_listing_global_image_price_order_20260813/);
  assert.doesNotMatch(sql, /CREATE\s+(?:UNIQUE\s+)?INDEX|REINDEX|ANALYZE|VACUUM/i);
  assert.doesNotMatch(sql,
    /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+(?:public\.raw_messages|public\.raw_message_versions|staging\.listings)/i);
});

test('candidate branch performs only index-prefix, parent, media and keyset work before LIMIT', () => {
  assert.ok(candidateStart >= 0 && eligibleStart > candidateStart);
  assert.match(candidates, /l\.normalization_run_key = enabled\.enabled_run_key/);
  assert.match(candidates, /l\.brand_normalized = enabled\.canonical_brand/);
  assert.match(candidates, /l\.parent_id IS NULL/);
  assert.match(candidates, /COALESCE\(l\.is_bundle, false\) = false/);
  assert.match(candidates, /\) = p_has_image/);
  assert.match(candidates, /LIMIT v_scan_limit \+ 1/);
  assert.doesNotMatch(candidates, /category|bundle_status|listing_type|trading_floor_status|publication_review_status|raw_message_versions|reference_is_price_token/i);
});

test('all fail-closed gates remain after the bounded candidate window and before output', () => {
  assert.match(eligible, /JOIN public\.raw_message_versions/);
  assert.match(eligible, /upper\(COALESCE\(l\.category, ''\)\) = 'WATCH'/);
  assert.match(eligible, /provenance_metadata->>'bundle_status' = 'SINGLE_CANDIDATE'/);
  assert.match(eligible, /upper\(COALESCE\(l\.listing_type, l\.intent, ''\)\) IN \('WTS', 'WTB'\)/);
  assert.match(eligible, /bundle_child_pending_review/);
  assert.match(eligible, /suppressed_exact_duplicate/);
  assert.match(eligible, /reviewed_workbook_reference_is_price_token_v2/);
  assert.match(eligible, /qnsa_zenith_identity_reconciliation_audit/);
  assert.match(eligible, /LIMIT v_limit/);
});

test('keyset accounting advances by the exact selected-or-scanned candidate boundary', () => {
  assert.match(sql, /WHEN metrics\.selected_count = v_limit THEN metrics\.selected_last_position/);
  assert.match(sql, /ELSE metrics\.scanned_count END/);
  assert.match(sql, /'next_cursor'[\s\S]*'has_price'[\s\S]*'created_at'[\s\S]*'id'/);
  assert.match(sql, /LEAST\(GREATEST\(COALESCE\(p_scan_limit, 500\), 50\), 500\)/);
});

test('QNSA workflow audits and applies only the new forward timeout repair', () => {
  assert.match(workflow,
    /MIGRATION_FILE: supabase\/migrations\/20260815150000_qnsa_first_three_singleton_compat\.sql/);
  assert.match(workflow,
    /price_token_helper'[\s\S]*reviewed_workbook_reference_is_price_token_v2\(text,numeric,text\)/);
  assert.match(workflow, /Compile the forward migration and roll it back/);
  assert.match(workflow, /EXPLAIN \(FORMAT JSON, COSTS true\)/);
  assert.match(workflow, /source_rows_scanned',0/);
  assert.doesNotMatch(workflow, /qnsa_six_brand_image_lane_page\(NULL/);
  assert.match(workflow,
    /@\('Rolex','Patek Philippe','Audemars Piguet','Richard Mille','Cartier','Zenith'\)/);
  assert.match(workflow, /foreach \(\$brand in \$brands\)/);
  assert.match(workflow, /qnsa_six_brand_image_lane_page\('\$brandSql',true/);
  assert.match(workflow, /qnsa_six_brand_image_lane_page\('\$brandSql',false/);
  assert.doesNotMatch(workflow, /bptrvfncppbjnchsaxtb/);
});

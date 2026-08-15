'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const repair = fs.readFileSync(path.join(root, 'supabase', 'migrations',
  '20260815150000_qnsa_first_three_singleton_compat.sql'), 'utf8');
const provenTwoBrand = fs.readFileSync(path.join(root, 'supabase', 'migrations',
  '20260812012000_qnsa_trading_floor_page_rows.sql'), 'utf8');
const provenAp = fs.readFileSync(path.join(root, 'supabase', 'migrations',
  '20260812210000_qnsa_audemars_piguet_reviewed_release.sql'), 'utf8');

test('repair matches the proven first-three historical singleton convention', () => {
  assert.match(provenTwoBrand,
    /COALESCE\(l\.provenance_metadata->>'bundle_status', 'SINGLE_CANDIDATE'\) = 'SINGLE_CANDIDATE'/);
  assert.match(provenAp,
    /COALESCE\(l\.provenance_metadata->>'bundle_status', 'SINGLE_CANDIDATE'\) = 'SINGLE_CANDIDATE'/);
  assert.match(repair, /WHEN l\.brand_normalized IN \(\s*'Rolex', 'Patek Philippe', 'Audemars Piguet'\s*\) THEN COALESCE\(\s*l\.provenance_metadata->>'bundle_status', 'SINGLE_CANDIDATE'\s*\)/);
});

test('later brands still require an explicit singleton decision', () => {
  assert.match(repair,
    /ELSE l\.provenance_metadata->>'bundle_status'\s*END = 'SINGLE_CANDIDATE'/);
  assert.doesNotMatch(repair,
    /WHEN l\.brand_normalized IN \([^)]*Richard Mille[^)]*\) THEN COALESCE/);
});

test('parent, bundle, immutable lineage, duplicate, and release gates remain fail closed', () => {
  const candidate = repair.slice(repair.indexOf('per_brand_candidates AS MATERIALIZED'),
    repair.indexOf('candidate_window AS MATERIALIZED'));
  const eligible = repair.slice(repair.indexOf('eligible AS MATERIALIZED'),
    repair.indexOf('selected AS MATERIALIZED'));
  assert.match(candidate, /l\.parent_id IS NULL/);
  assert.match(candidate, /COALESCE\(l\.is_bundle, false\) = false/);
  assert.match(eligible, /JOIN public\.raw_message_versions AS rv[\s\S]*rv\.source_hash = l\.source_hash/);
  assert.match(eligible, /l\.source_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(eligible, /l\.source_candidate_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(eligible, /bundle_child_pending_review[\s\S]*bundle_pending_separation[\s\S]*suppressed_exact_duplicate/);
  assert.match(eligible, /publication_review_status[\s\S]*PENDING_REVIEW[\s\S]*APPROVED[\s\S]*READY_FOR_PUBLICATION_REVIEW/);
});

test('repair remains storage-neutral and preserves bounded indexed keyset pagination', () => {
  assert.doesNotMatch(repair, /\b(?:CREATE\s+INDEX|DROP\s+INDEX|ALTER\s+TABLE|UPDATE|INSERT|DELETE|ANALYZE|VACUUM)\b/i);
  assert.match(repair, /idx_qnsa_listing_global_image_price_order_20260813/);
  assert.match(repair, /SET plan_cache_mode = force_custom_plan/);
  assert.match(repair, /LIMIT v_scan_limit \+ 1/);
  assert.match(repair, /p_after_has_price[\s\S]*p_after_created_at[\s\S]*p_after_id/);
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260812030000_qnsa_bounded_price_research_rpc.sql'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/qnsa-bounded-price-research-rpc.yml'), 'utf8');

test('bounded RPC is pinned to released single Rolex/Patek evidence', () => {
  assert.match(migration, /normalization_run_key[\s\S]*qnsa_two_brand_release_control/);
  assert.match(migration, /parent_id IS NULL/);
  assert.match(migration, /COALESCE\(l\.is_bundle, false\) = false/);
  assert.match(migration, /suppressed_exact_duplicate/);
  assert.match(migration, /PENDING_REVIEW', 'APPROVED'/);
  assert.match(migration, /upper\(p_listing_type\) = 'WTB'/i);
  assert.match(migration, /reference_normalized = ANY \(p_references\)/);
  assert.match(migration, /l\.price_usd > 0/);
  assert.match(migration, /raw_message_versions AS rv/);
  assert.match(migration, /source_media_url_candidate/);
  assert.match(migration, /seller_phone[\s\S]*raw_data,from_number/);
  assert.match(migration, /seller_rating[\s\S]*raw_data,dealer_rating/);
  assert.doesNotMatch(migration, /public_image_eligible AND/);
  assert.match(migration, /LEAST\(GREATEST\(COALESCE\(p_limit, 1000\), 1\), 2500\)/);
});

test('production workflow pins QNSA and smoke tests bundle leakage', () => {
  assert.match(workflow, /qnsafosakvonzgfcsphh/g);
  assert.match(workflow, /APPLY_QNSA_BOUNDED_PRICE_RESEARCH_RPC/);
  assert.match(workflow, /bundle_leakage/);
  assert.match(workflow, /read_only = \$false/);
});

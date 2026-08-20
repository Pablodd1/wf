'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'tools/audit/qnsa-tudor-release-census.cjs'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/qnsa-tudor-release-census.yml'), 'utf8');

test('Tudor census is read-only, QNSA-pinned, and exact-source gated', () => {
  assert.match(script, /qnsafosakvonzgfcsphh/);
  assert.match(script, /read_only: true/);
  assert.match(script, /l\.brand_normalized = 'Tudor'/);
  assert.match(script, /raw_message_version_id IS NOT NULL/);
  assert.match(script, /source_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(script, /source_candidate_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(script, /parent_id IS NULL/);
  assert.match(script, /is_bundle, false\) = false/);
  assert.match(script, /seller_candidate_rank = 1/);
});

test('Tudor census separates intent, price, image, dealer, and missing identity counts', () => {
  for (const field of [
    'release_unique_individual_listings', 'release_duplicates_excluded',
    'release_wts_rows', 'release_wtb_rows', 'release_other_rows',
    'release_explicit_usd_usdt_wts_rows', 'release_dated_fx_wts_rows',
    'release_owner_assumed_usd_candidates', 'release_price_not_supplied',
    'release_exact_image_claim_rows', 'release_exact_dealer_linked_rows',
    'release_missing_reference_rows', 'release_missing_model_rows', 'release_missing_dial_rows',
    'release_listing_ids_sha256',
  ]) assert.match(script, new RegExp(field));
});

test('Tudor census workflow requires exact manual authorization', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /AUDIT_QNSA_TUDOR_RELEASE/);
  assert.match(workflow, /qnsafosakvonzgfcsphh/);
  assert.match(workflow, /SUPABASE_ACCESS_TOKEN/);
  assert.match(workflow, /qnsa-tudor-release-census\.cjs/);
});

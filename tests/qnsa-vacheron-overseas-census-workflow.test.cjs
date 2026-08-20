'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflow = fs.readFileSync(path.join(
  __dirname,
  '..',
  '.github',
  'workflows',
  'qnsa-vacheron-overseas-census.yml',
), 'utf8');

test('Vacheron Overseas census is manual, exact-confirmed, and QNSA pinned', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /AUDIT_QNSA_VACHERON_OVERSEAS/);
  assert.match(workflow, /SUPABASE_PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /INPUT_CONFIRMATION: \$\{\{ inputs\.confirmation \}\}/);
  assert.doesNotMatch(workflow, /run: \|[\s\S]*['\"]\$\{\{\s*inputs\./);
});

test('Vacheron Overseas census cannot mutate production data', () => {
  assert.match(workflow, /read_only = \$true/);
  assert.doesNotMatch(workflow, /read_only = \$false/);
  assert.doesNotMatch(workflow, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT|REVOKE)\s+(?:INTO\s+|FROM\s+|TABLE\s+|FUNCTION\s+|ON\s+)?(?:public|staging)\./i);
  assert.match(workflow, /Census SQL is not read-only/);
});

test('Vacheron Overseas census reports the required source and cohort boundaries', () => {
  for (const field of [
    'vacheron_source_rows',
    'normalized_model_exact_rows',
    'raw_overseas_mention_rows',
    'catalog_overseas_reference_rows',
    'catalog_reference_only_rows',
    'raw_or_model_and_catalog_rows',
    'overseas_union_rows',
    'overseas_unique_source_hashes',
    'overseas_unique_source_candidate_pairs',
    'overseas_unique_seller_candidate_pairs',
    'exact_source_candidate_repost_rows',
    'seller_candidate_repost_rows',
    'release_unique_individual_listings',
    'release_duplicates_excluded',
    'release_wts_rows',
    'release_wtb_rows',
    'release_priced_wts_rows',
    'release_exact_image_rows',
    'release_exact_dealer_linked_rows',
    'release_listing_ids_sha256',
    'explicit_wts_rows',
    'explicit_wtb_rows',
    'missing_or_other_intent_rows',
    'explicit_usd_usdt_wts_rows',
    'dated_fx_wts_rows',
    'stored_price_currency_unconfirmed_wts_rows',
    'https_media_claim_rows',
    'valid_lineage_rows',
    'listing_ids_sha256',
    'source_candidate_hashes_sha256',
  ]) {
    assert.match(workflow, new RegExp(field));
  }
  assert.match(workflow, /top_references/);
  assert.match(workflow, /models/);
  assert.doesNotMatch(workflow, /\), references AS \(/);
  assert.match(workflow, /extensions\.digest\(convert_to\(/);
  assert.match(workflow, /public\/catalog-source-v1\.json/);
  assert.match(workflow, /__OVERSEAS_KEYS__/);
  assert.match(workflow, /\^\[A-Z0-9\]\{3,50\}\$/);
  assert.doesNotMatch(workflow, /original_timestamp/);
  assert.doesNotMatch(workflow, /source_created_on/);
  assert.match(workflow, /\) \|\| jsonb_build_object\(/);
});

test('management credential is scoped only to the census step', () => {
  assert.doesNotMatch(workflow, /jobs:[\s\S]{0,500}\benv:\s*\n\s+SUPABASE_ACCESS_TOKEN:/);
  assert.match(workflow, /Run count-only production census[\s\S]*SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/);
});

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
    'overseas_union_rows',
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
});

test('management credential is scoped only to the census step', () => {
  assert.doesNotMatch(workflow, /jobs:[\s\S]{0,500}\benv:\s*\n\s+SUPABASE_ACCESS_TOKEN:/);
  assert.match(workflow, /Run count-only production census[\s\S]*SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/);
});

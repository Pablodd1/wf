'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'tools', 'audit', 'qnsa-cartier-release-census.cjs'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'qnsa-cartier-release-census.yml'), 'utf8');

test('Cartier census is QNSA-pinned, aggregate-only, and read-only', () => {
  assert.match(script, /qnsafosakvonzgfcsphh/);
  assert.match(script, /read_only: true/);
  assert.match(script, /release_listing_ids_sha256/);
  assert.doesNotMatch(script, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO|FROM)?\s*(?:public|staging)\./i);
  assert.match(workflow, /AUDIT_QNSA_CARTIER_RELEASE/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
});
test('Cartier census separates identity, intent, price, media, dealer, and missing fields', () => {
  for (const marker of [
    'identity_held_rows', 'release_duplicates_excluded', 'release_wts_rows', 'release_wtb_rows',
    'release_other_rows', 'release_explicit_usd_usdt_wts_rows', 'release_dated_fx_wts_rows',
    'release_owner_assumed_usd_candidates', 'release_named_currency_requires_dated_fx',
    'release_exact_image_claim_rows', 'release_exact_dealer_linked_rows', 'release_missing_reference_rows',
  ]) assert.match(script, new RegExp(marker));
});


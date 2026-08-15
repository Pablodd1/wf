'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations',
  '20260815150000_qnsa_first_three_singleton_compat.sql'), 'utf8');
const api = fs.readFileSync(path.join(__dirname, '..', 'api',
  'reviewed-market-inventory.js'), 'utf8');

test('compatibility repair is forward-only and changes no source or index state', () => {
  assert.match(migration,
    /CREATE OR REPLACE FUNCTION public\.qnsa_six_brand_image_lane_page/);
  assert.doesNotMatch(migration, /CREATE\s+(?:UNIQUE\s+)?INDEX|REINDEX|VACUUM|ANALYZE/i);
  assert.doesNotMatch(migration,
    /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+(?:public\.raw_messages|public\.raw_message_versions|staging\.listings)/i);
});

test('missing singleton provenance is compatible only for the first three reviewed brands', () => {
  assert.match(migration,
    /WHEN l\.brand_normalized IN \(\s*'Rolex', 'Patek Philippe', 'Audemars Piguet'\s*\) THEN COALESCE\(\s*l\.provenance_metadata->>'bundle_status', 'SINGLE_CANDIDATE'\s*\)/);
  assert.match(migration,
    /ELSE l\.provenance_metadata->>'bundle_status'\s*END = 'SINGLE_CANDIDATE'/);
  assert.doesNotMatch(migration,
    /WHEN l\.brand_normalized IN \([^)]*(?:Richard Mille|Cartier|Zenith)/);
});

test('database lineage, parent, status, duplicate and identity gates remain fail closed', () => {
  assert.match(migration, /l\.parent_id IS NULL/);
  assert.match(migration, /COALESCE\(l\.is_bundle, false\) = false/);
  assert.match(migration, /JOIN public\.raw_message_versions/);
  assert.match(migration, /rv\.source_hash = l\.source_hash/);
  assert.match(migration, /bundle_child_pending_review/);
  assert.match(migration, /bundle_pending_separation/);
  assert.match(migration, /suppressed_exact_duplicate/);
  assert.match(migration, /reviewed_workbook_reference_is_price_token_v2/);
  assert.match(migration, /regexp_replace\(upper\(COALESCE\(l\.raw_message_text/);
});

test('the customer API still applies deterministic immutable-raw multi-listing suppression', () => {
  assert.match(api, /const multiListing = isMultiListing\(row\)/);
  assert.match(api, /deterministicCandidateCount\(\{[\s\S]*raw_message:/);
  assert.match(api, /\.filter\(record =>[\s\S]*!record\.multi_listing\)/);
  assert.match(api, /if \(row\?\.parent_id \|\| row\?\.is_bundle === true\) return false/);
});

test('the repaired function remains service-only', () => {
  assert.match(migration,
    /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(migration,
    /GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role, postgres, supabase_admin/);
});

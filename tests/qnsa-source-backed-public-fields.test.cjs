'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(
  __dirname,
  '..',
  'supabase',
  'migrations',
  '20260811220000_qnsa_source_backed_public_fields.sql',
), 'utf8');

test('public fields come from the exact immutable raw version lineage', () => {
  assert.match(migration, /JOIN public\.raw_message_versions AS rv/);
  assert.match(migration, /rv\.id = l\.raw_message_version_id/);
  assert.match(migration, /rv\.source_record_id = l\.source_record_id/);
  assert.match(migration, /rv\.source_hash = l\.source_hash/);
  for (const field of ['from_name', 'from_number', 'phone_code', 'region', 'dealer_rating', 'company_id']) {
    assert.match(migration, new RegExp(`raw_data,${field}`));
  }
  assert.match(migration, /::varchar\(150\) AS seller_name/);
  assert.match(migration, /::varchar\(50\) AS contact_number/);
  assert.match(migration, /::numeric\(5,2\) AS dealer_rating/);
});

test('source image is admitted only behind the existing single-listing gates', () => {
  assert.match(migration, /l\.source_media_url_candidate/);
  assert.match(migration, /AS public_image_eligible/);
  assert.match(migration, /l\.parent_id IS NULL/);
  assert.match(migration, /COALESCE\(l\.is_bundle, false\) = false/);
  assert.match(migration, /'SINGLE_CANDIDATE'/);
  assert.match(migration, /bundle_child_pending_review/);
  assert.match(migration, /bundle_pending_separation/);
});

test('release remains limited to Rolex and Patek WTS or WTB rows', () => {
  assert.match(migration, /l\.brand_normalized IN \('Rolex', 'Patek Philippe'\)/);
  assert.match(migration, /IN \('WTS', 'WTB'\)/);
  assert.match(migration, /c\.status = 'NORMALIZATION_STAGED'/);
  assert.match(migration, /c\.error_rows = 0/);
});

test('migration is forward-only and never mutates source facts', () => {
  assert.match(migration, /CREATE OR REPLACE VIEW public\.qnsa_rolex_patek_reviewed_release_base/);
  assert.doesNotMatch(migration, /UPDATE\s+(staging\.listings|public\.raw_message_versions)/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM/i);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+public\.watch_records/i);
});

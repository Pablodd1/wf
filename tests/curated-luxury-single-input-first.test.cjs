'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root,
  'supabase/migrations/20260827170000_curated_luxury_single_input_first.sql'), 'utf8');
const shadowApi = fs.readFileSync(path.join(root, 'api/_lib/curated-luxury-shadow.cjs'), 'utf8');
const inventoryApi = fs.readFileSync(path.join(root, 'api/reviewed-market-inventory.js'), 'utf8');
const tradingFloor = fs.readFileSync(path.join(root, 'src/pages/TradingFloor.tsx'), 'utf8');
const workflow = fs.readFileSync(path.join(root,
  '.github/workflows/qnsa-rolex-evidence-restoration.yml'), 'utf8');

test('single-input lane is deterministically ahead of multi-source children', () => {
  assert.match(migration,
    /exact_child_text_sha256=c?\.?parent_raw_text_sha256 THEN 0 ELSE 1 END listing_lane/i);
  assert.match(migration,
    /ORDER BY listing_lane ASC,c?\.?source_timestamp DESC NULLS LAST,c?\.?current_listing_key DESC/i);
  assert.match(migration, /'next_lane'/i);
  assert.match(migration, /'key_lanes'/i);
  assert.match(migration, /p_listing_lane smallint DEFAULT NULL/i);
});

test('source-lane cursor binds lane, timestamp, key, and filter scope', () => {
  assert.match(shadowApi, /v: 4, p: page, l: normalizedListingLane\(listingLane\)/);
  assert.match(shadowApi, /listingLane: normalizedListingLane\(options\.listingLane\)/);
  assert.match(inventoryApi, /decoded\?\.v === 3 \|\| decoded\?\.v === 4/);
  assert.match(inventoryApi, /listingLane, sourceTimestamp/);
});

test('Trading Floor preserves lanes in newest, discovery, and all-inventory pagination', () => {
  assert.match(tradingFloor, /function listingSourceLane/);
  assert.match(tradingFloor, /listingSourceLane\(left\) - listingSourceLane\(right\)/);
  assert.match(tradingFloor, /function discoveryOrderWithinSourceLanes/);
  assert.match(tradingFloor, /params\.set\('sourceShape', listingLane\)/);
  assert.match(tradingFloor, /nextListingLane = !laneHasMore && listingLane === 'single' \? 'multi'/);
});

test('ordering migration is projection-only and does not rewrite cohort or raw/source data', () => {
  assert.doesNotMatch(migration,
    /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO\s+|FROM\s+)?public\.(?:curated_luxury_current_listings_shadow|raw_messages|raw_message_versions)/i);
  assert.match(migration, /status='COMPLETE'/i);
  assert.match(migration, /CURRENT_ACTIVE','CURRENT_LATEST_STATE/);
});

test('guarded QNSA schema workflow pins and installs the ordering contract atomically', () => {
  assert.match(workflow, /EXPECTED_ORDERING_MIGRATION_SHA256: [0-9a-f]{64}/);
  assert.match(workflow, /20260827170000_curated_luxury_single_input_first\.sql/);
  assert.match(workflow, /BEGIN;[\s\S]*\$migration[\s\S]*\$orderingMigration[\s\S]*COMMIT;/);
  assert.doesNotMatch(workflow, /ROLEX_EVIDENCE_OUTPUT:\s*\$\{\{\s*runner\.temp\s*\}\}/);
  assert.match(workflow, /ROLEX_EVIDENCE_OUTPUT:\s*\/tmp\/rolex-evidence-restoration\.json/);
});

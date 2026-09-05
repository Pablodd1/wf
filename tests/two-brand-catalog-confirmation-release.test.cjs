'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  ID_SHARDS,
  classifyTwoBrandIdentity,
  parseShard,
  scopeSource,
} = require('../tools/data-quality/stage-identity-review.cjs');

const root = path.join(__dirname, '..');
const workflow = fs.readFileSync(
  path.join(root, '.github', 'workflows', 'two-brand-catalog-confirmation-release.yml'),
  'utf8',
);
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260727220000_atomic_two_brand_catalog_staging.sql'),
  'utf8',
);
const worker = fs.readFileSync(
  path.join(root, 'tools', 'data-quality', 'stage-identity-review.cjs'),
  'utf8',
);

test('auto-confirms only raw-backed exact reference, model, and catalog dial matches', () => {
  const patek = classifyTwoBrandIdentity({
    id: 'patek',
    brand: 'Patek Philippe',
    model: 'Nautilus',
    reference: '5712/1A',
    dial_color: 'Blue',
    raw_message: 'Patek Philippe 5712/1A blue dial HKD 900000',
  });
  assert.equal(patek.status, 'CATALOG_CONFIRMED');
  assert.equal(patek.canonical_model, 'Nautilus');
  assert.equal(patek.canonical_reference, '5712/1A-001');
  assert.equal(patek.canonical_dial_color, 'Blue');
  assert.equal(patek.evidence.exact_reference_present_in_raw, true);
  assert.equal(patek.evidence.configuration_basis, 'EXACT_REFERENCE');

  const missingRawReference = classifyTwoBrandIdentity({
    id: 'missing-reference',
    brand: 'Rolex',
    model: 'Cosmograph Daytona',
    reference: '116500LN',
    dial_color: 'White',
    raw_message: 'Rolex Daytona white dial, price on request',
  });
  assert.equal(missingRawReference.status, 'UNVERIFIED');
  assert.equal(missingRawReference.reason, 'EXACT_REFERENCE_MISSING_FROM_RAW');

  const dialConflict = classifyTwoBrandIdentity({
    id: 'dial-conflict',
    brand: 'Rolex',
    model: 'Cosmograph Daytona',
    reference: '116500LN',
    dial_color: 'Purple',
    raw_message: 'Rolex 116500LN purple dial USD 25000',
  });
  assert.equal(dialConflict.status, 'CONFLICT');
  assert.equal(dialConflict.reason, 'CATALOG_DIAL_CONFLICT');

  const modelConflict = classifyTwoBrandIdentity({
    id: 'model-conflict',
    brand: 'Rolex',
    model: 'Submariner',
    reference: '116500LN',
    dial_color: 'White',
    raw_message: 'Rolex 116500LN white dial USD 25000',
  });
  assert.equal(modelConflict.status, 'CONFLICT');
  assert.equal(modelConflict.reason, 'CATALOG_MODEL_CONFLICT');
});

test('partial reference tokens and non-exact catalog matches fail closed', () => {
  const partialRaw = classifyTwoBrandIdentity({
    id: 'partial-raw',
    brand: 'Patek Philippe',
    model: 'Nautilus',
    reference: '5712/1A',
    dial_color: 'Blue',
    raw_message: 'Patek Philippe 5712/1A-999 blue dial',
  });
  assert.equal(partialRaw.status, 'UNVERIFIED');
  assert.equal(partialRaw.reason, 'EXACT_REFERENCE_MISSING_FROM_RAW');
});

test('two-brand source is bounded, sharded, and carries immutable raw evidence', () => {
  assert.deepEqual(ID_SHARDS, [
    { lower: null, upper: '4' },
    { lower: '4', upper: '8' },
    { lower: '8', upper: 'c' },
    { lower: 'c', upper: 'mysql_auction_watches_' },
    { lower: 'mysql_auction_watches_', upper: 'mysql_auction_watches_4' },
    { lower: 'mysql_auction_watches_4', upper: 'mysql_auction_watches_8' },
    { lower: 'mysql_auction_watches_8', upper: 'mysql_auction_watches_c' },
    { lower: 'mysql_auction_watches_c', upper: null },
  ]);
  assert.equal(parseShard('7'), 7);
  assert.throws(() => parseShard('8'), /0 through 7/);
  assert.deepEqual(scopeSource('TWO_BRANDS'), {
    table: 'watch_records',
    idColumn: 'id',
    select: 'id,brand,model,reference,dial_color,raw_message',
    brandFilter: 'in.("Rolex","Patek Philippe")',
  });
  assert.match(worker, /created_at\.is\.null,created_at\.lte\.\$\{SNAPSHOT_AT\}/);
  assert.match(workflow, /created_at IS NULL[\s\S]*created_at <= :'snapshot_at'/);
});

test('atomic RPC preserves reviewed decisions and checkpoints the batch transactionally', () => {
  assert.match(
    migration,
    /\^identity-stage:two_brands:v4:snapshot-\[a-f0-9\]\{12\}:partition-\[0-7\]\$/,
  );
  assert.match(worker, /:v4:snapshot-\$\{SNAPSHOT_KEY\}:partition-\$\{SHARD\}/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /v_checkpoint\.last_record_id IS DISTINCT FROM p_expected_last_record_id/);
  assert.match(migration, /reviewer_id IS NOT NULL OR r\.reviewed_at IS NOT NULL/);
  assert.match(migration, /last_batch_token/);
  assert.match(migration, /rows_scanned = rows_scanned \+ p_rows_scanned/);
  assert.match(migration, /status = EXCLUDED\.status/);
  assert.doesNotMatch(migration, /(?:UPDATE|INSERT INTO|DELETE FROM)\s+(?:public\.)?watch_records/i);
});

test('release workflow uses the validated four-worker batch-250 ceiling', () => {
  assert.match(workflow, /matrix:\s*\n\s*shard: \[0, 1, 2, 3, 4, 5, 6, 7\]/);
  assert.match(workflow, /max-parallel: 4/);
  assert.match(workflow, /IDENTITY_BATCH_SIZE: '250'/);
  assert.match(workflow, /APPLY_EXACT_TWO_BRAND_CATALOG_RELEASE/);
  assert.match(workflow, /20260727260000_include_unpriced_two_brand_trading\.sql/);
  assert.match(workflow, /Run read-only exact-match canary/);
  assert.match(workflow, /Require exact reconciliation and zero writes/);
  assert.match(workflow, /REFRESH MATERIALIZED VIEW public\.two_brand_verified_trading_release_cache/);
  assert.match(workflow, /FROM public\.two_brand_verified_trading_release_cache/);
  assert.match(workflow, /Expected eight indexed partition reports/);
});

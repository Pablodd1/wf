'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const { run, targetedRawSql } = require('../tools/audit/raw-first-observation-census-v3.cjs');
const { uuidShard, assertReadOnlySql } = require('../tools/audit/raw-first-rolex-patek-audit.cjs');

test('V3 target query is bounded, hash-targeted, latest-version, and SELECT-only', () => {
  const sql = targetedRawSql(uuidShard(2, 16),
    '20000000-0000-0000-0000-000000000001',
    '2fffffff-ffff-ffff-ffff-ffffffffffff', ['a'.repeat(64), 'b'.repeat(64)]);
  assert.doesNotThrow(() => assertReadOnlySql(sql));
  assert.match(sql, /extensions\.digest/);
  assert.match(sql, /rm\.id>'20000000-0000-0000-0000-000000000001'::uuid/);
  assert.match(sql, /rm\.id<='2fffffff-ffff-ffff-ffff-ffffffffffff'::uuid/);
  assert.match(sql, /ORDER BY v\.observed_at DESC NULLS LAST,v\.id DESC LIMIT 1/);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|CALL)\b/i);
});

test('V3 validation mode requires no credentials and preserves concurrency one', async () => {
  const result = await run({ validateOnly: true, env: {} });
  assert.equal(result.read_only, true);
  assert.equal(result.database_concurrency, 1);
  assert.deepEqual(result.target_classes, [
    'MULTI_WATCH_PARTIALLY_SPLITTABLE', 'MULTI_WATCH_UNSPLITTABLE',
  ]);
});

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

test('V3 end-to-end collapses identical blocks and retains unsplittable queue', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'raw-first-v3-e2e-'));
  const artifact = path.join(root, 'v2');
  const output = path.join(root, 'v3');
  const relative = 'resume-pages/raw-000-000001.json.gz';
  fs.mkdirSync(path.join(artifact, 'resume-pages'), { recursive: true });
  const parentA = '01000000-0000-4000-8000-000000000001';
  const parentB = '02000000-0000-4000-8000-000000000001';
  const versionA = '11000000-0000-4000-8000-000000000001';
  const versionB = '12000000-0000-4000-8000-000000000001';
  const child = { qualified_pr: true, dealer_linked: false, image_linked: false,
    country_resolved: false, image_status: 'SOURCE_IMAGE_UNAVAILABLE' };
  const records = [
    { parent_key: hash(parentA), version_key: hash(versionA), source_key: hash('source-a'), brand: 'Rolex',
      classification: 'MULTI_WATCH_PARTIALLY_SPLITTABLE', disposition: {}, current_tf: 0,
      children: [child, child] },
    { parent_key: hash(parentB), version_key: hash(versionB), source_key: hash('source-b'), brand: 'Rolex',
      classification: 'MULTI_WATCH_UNSPLITTABLE', disposition: {}, current_tf: 0, children: [] },
  ];
  const compressed = zlib.gzipSync(`${JSON.stringify(records)}\n`);
  fs.writeFileSync(path.join(artifact, relative), compressed);
  fs.writeFileSync(path.join(artifact, 'checkpoint.json'), JSON.stringify({
    contract: 'watchfacts-raw-first-rolex-patek-audit-v2', status: 'COMPLETE', shard_count: 1,
    page_files: { [relative]: { dataset: 'raw', shard: 0, page: 1, last_id: parentB,
      sanitized_rows: 2, sha256: hash(compressed.toString('base64')) } },
  }));
  fs.writeFileSync(path.join(artifact, 'summary.json'), JSON.stringify({ brands: {
    Rolex: { current_trading_floor_observations: 0, phase7b_verified_price_research_count: 0 },
    'Patek Philippe': { current_trading_floor_observations: 0, phase7b_verified_price_research_count: 0 },
  } }));
  const rows = [
    { id: versionA, raw_message_id: parentA, source_record_id: 'source-a', source_hash: 'a'.repeat(64),
      raw_text: 'Rolex WTS\n116500LN white USD 25,000\n116500LN white USD 25,000',
      raw_data: { brand: 'Rolex', type: 'sale', is_bundle: true }, media: [] },
    { id: versionB, raw_message_id: parentB, source_record_id: 'source-b', source_hash: 'b'.repeat(64),
      raw_text: 'Rolex bundle available', raw_data: { brand: 'Rolex', type: 'sale', is_bundle: true }, media: [] },
  ];
  try {
    const result = await run({ env: { RAW_FIRST_V2_ARTIFACT: artifact, RAW_FIRST_V3_OUTPUT: output },
      token: 'test-only', fetchImpl: async () => new Response(JSON.stringify(rows), { status: 200 }) });
    assert.equal(result.decision, 'NOT_READY_OBSERVATION_IDENTITY_GAPS');
    assert.equal(result.processed_target_parents, 2);
    assert.equal(result.brands.Rolex.raw_candidate_occurrences, 2);
    assert.equal(result.brands.Rolex.unique_market_observations, 1);
    assert.equal(result.brands.Rolex.repeated_identical_offer_occurrences, 1);
    assert.equal(result.brands.Rolex.genuinely_unsplittable_parents, 1);
    assert.equal(result.brands.Rolex.unique_observation_manifest_count, 1);
    assert.equal(result.brands.Rolex.raw_occurrence_manifest_reconciles, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

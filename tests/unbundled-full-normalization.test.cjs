'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { bucketFor, normalizeBatch } = require('../tools/multilisting/normalize-unbundled-batch.cjs');

test('routes normalized rows into explicit review buckets', () => {
  assert.equal(bucketFor({ review_status: 'READY_FOR_HUMAN_REVIEW' }), 'review-ready');
  assert.equal(bucketFor({ review_status: 'REQUIRES_HUMAN_CORRECTION' }), 'human-correction');
  assert.equal(bucketFor({ review_status: 'BLOCKED_PRICE_CURRENCY' }), 'held-price-currency');
  assert.equal(bucketFor({ review_status: 'BLOCKED_MULTI_WATCH' }), 'held-multi-watch');
  assert.equal(bucketFor({ review_status: 'BLOCKED_CATALOG' }), 'held-catalog');
});

test('streams shards and resumes without duplicating normalized children', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-full-unbundle-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const listings = path.join(directory, 'listings.csv');
  const parents = path.join(directory, 'parents.csv');
  const output = path.join(directory, 'output');
  fs.writeFileSync(listings, [
    'listing_id,source_record_id,candidate_index,brand,reference,raw_line,listing_type,dial_color,price_raw,price_currency,price_usd',
    'source-1_000,source-1,0,Rolex,116500LN,116500LN White 283K HKD,WTS,White,283000,HKD,36282',
    'source-2_000,source-2,0,Rolex,52506,52506 Blue 43000 USD,WTS,Blue,43000,USD,43000',
  ].join('\n'));
  fs.writeFileSync(parents, [
    'source_record_id,raw_message,listing_type,created_at,seller_name,seller_phone,dealer',
    'source-1,116500LN White 283K HKD,WTS,2026-07-01T00:00:00Z,Alice,123,Dealer A',
    'source-2,52506 Blue 43000 USD,WTS,2026-07-02T00:00:00Z,Bob,456,Dealer B',
  ].join('\n'));

  const first = await normalizeBatch({ listingsPath: listings, parentsPath: parents, outputDir: output, shardSize: 1, maxRows: 1 });
  assert.equal(first.processedRows, 1);
  const resumed = await normalizeBatch({ listingsPath: listings, parentsPath: parents, outputDir: output, shardSize: 1 });
  assert.equal(resumed.processedRows, 2);
  const outputFiles = resumed.files.map(file => file.path);
  assert.equal(new Set(outputFiles).size, outputFiles.length);
  assert.equal(outputFiles.length, 2);
});

test('reuses an identical shard when the checkpoint rename lagged behind it', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-full-unbundle-recovery-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const listings = path.join(directory, 'listings.csv');
  const parents = path.join(directory, 'parents.csv');
  const output = path.join(directory, 'output');
  fs.writeFileSync(listings, [
    'listing_id,source_record_id,candidate_index,brand,reference,raw_line,listing_type,dial_color,price_raw,price_currency,price_usd',
    'source-1_000,source-1,0,Rolex,116500LN,116500LN White 283K HKD,WTS,White,283000,HKD,36282',
  ].join('\n'));
  fs.writeFileSync(parents, [
    'source_record_id,raw_message,listing_type,created_at,seller_name,seller_phone,dealer',
    'source-1,116500LN White 283K HKD,WTS,2026-07-01T00:00:00Z,Alice,123,Dealer A',
  ].join('\n'));

  await normalizeBatch({
    listingsPath: listings,
    parentsPath: parents,
    outputDir: output,
    shardSize: 1,
  });
  fs.writeFileSync(path.join(output, 'checkpoint.json'), JSON.stringify({
    processedRows: 0,
    completedShards: 0,
    counts: {
      status: {},
      bucket: {},
      intent: {},
      blockers: {},
      reviewReasons: {},
      sellerCoverage: { sellerName: 0, sellerPhone: 0, dealer: 0 },
    },
    files: [],
  }));

  const recovered = await normalizeBatch({
    listingsPath: listings,
    parentsPath: parents,
    outputDir: output,
    shardSize: 1,
  });
  assert.equal(recovered.processedRows, 1);
  assert.equal(recovered.files.length, 1);
});

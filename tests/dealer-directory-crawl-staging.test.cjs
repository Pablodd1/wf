'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  normalizeRow,
  rowsFromFile,
  run,
} = require('../tools/dealer-lineage/stage-rated-dealers-export.cjs');

test('source crawl object is flattened with immutable provenance and rank', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-dealer-crawl-'));
  const inputPath = path.join(directory, 'crawl.json');
  fs.writeFileSync(inputPath, JSON.stringify({
    source: 'https://watchfacts.com/market-discovery?tab=top-rated',
    crawled_at: '2026-08-09',
    profiles: [
      { id: '916', name: 'Federico Maman', profile_url: 'https://watchfacts.com/user/916/profile' },
      { id: '3435', name: 'Jaztime Watches', profile_url: 'https://watchfacts.com/user/3435/profile' },
    ],
  }));

  const rows = await rowsFromFile(inputPath);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].source_rank, 1);
  assert.equal(rows[1].source_rank, 2);
  assert.equal(rows[0].source_crawled_at, '2026-08-09');
  assert.equal(rows[0].source_snapshot_url, 'https://watchfacts.com/market-discovery?tab=top-rated');
});

test('crawl profile normalizes public source facts without inventing a rating', () => {
  const normalized = normalizeRow({
    id: '3435',
    name: 'Jaztime Watches',
    profile_url: 'https://watchfacts.com/user/3435/profile',
    whatsapp_url: 'https://wa.me/13055550123?text=',
    country: 'USA',
    region: 'North America',
    profile_rating_count: '18',
    common_groups: '22',
    source_rank: 2,
    source_crawled_at: '2026-08-09',
  }, 2);

  assert.equal(normalized.source_id, '3435');
  assert.equal(normalized.display_name, 'Jaztime Watches');
  assert.equal(normalized.phone_normalized, '13055550123');
  assert.equal(normalized.review_count, 18);
  assert.equal(normalized.whatsapp_group_count, 22);
  assert.equal(normalized.rating, null);
  assert.equal(normalized.raw_payload.source_rank, 2);
});

test('repository crawl dry-run stages all profiles privately and changes no production rows', async () => {
  const root = path.join(__dirname, '..');
  const inputPath = path.join(root, 'data', 'dealer-directory', 'full-crawl-2026-08-09.json');
  const summary = await run({ inputPath, apply: false });

  assert.equal(summary.inputRows, 25);
  assert.equal(summary.validRows, 25);
  assert.equal(summary.rejectedRows, 0);
  assert.equal(summary.duplicateSourceIds, 0);
  assert.equal(summary.target, 'dealer_directory_import_staging');
  assert.equal(summary.productionDealersChanged, 0);
  assert.equal(summary.productionListingsChanged, 0);
});

'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const { analyzeArtifact, distributionBucket, percentile } = require('../tools/audit/validate-raw-first-child-counts.cjs');

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

test('child count validator reconciles unique identities and detects page overlap', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'raw-first-child-validation-'));
  const relative = 'resume-pages/raw-000-000001.json.gz';
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const childA = hash('child-a');
  const childB = hash('child-b');
  const rows = [
    { parent_key: hash('parent-a'), version_key: hash('version-a'), source_key: hash('source-a'),
      brand: 'Rolex', classification: 'MULTI_WATCH_PARTIALLY_SPLITTABLE',
      children: [{ child_key: childA, reference_key: '116500LN' },
        { child_key: childB, reference_key: '116500LN' }] },
    { parent_key: hash('parent-b'), version_key: hash('version-b'), source_key: hash('source-a'),
      brand: 'Patek Philippe', classification: 'SINGLE_WATCH',
      children: [{ child_key: childA, reference_key: '5712/1A' }] },
  ];
  const compressed = zlib.gzipSync(`${JSON.stringify(rows)}\n`);
  fs.writeFileSync(file, compressed);
  fs.writeFileSync(path.join(root, 'checkpoint.json'), JSON.stringify({
    contract: 'watchfacts-raw-first-rolex-patek-audit-v2', decision: 'NOT_READY_RAW_SOURCE_GAPS',
    page_files: { [relative]: { dataset: 'raw', shard: 0, page: 1,
      last_id: '10000000-0000-0000-0000-000000000001', sanitized_rows: 2,
      sha256: hash(compressed.toString('base64')) } },
  }));
  try {
    const result = analyzeArtifact(root);
    assert.equal(result.unique_raw_parent_ids, 2);
    assert.equal(result.unique_source_record_ids, 1);
    assert.equal(result.duplicate_source_record_rows, 1);
    assert.equal(result.brands.Rolex.generated_child_count, 2);
    assert.equal(result.brands.Rolex.unique_child_count, 2);
    assert.equal(result.brands['Patek Philippe'].unique_child_count, 1);
    assert.equal(result.brands.Rolex.parents_with_repeated_reference_emission, 1);
    assert.equal(result.page_checksum_failures, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('distribution and nearest-rank percentiles retain exact requested buckets', () => {
  assert.equal(distributionBucket(1), '1');
  assert.equal(distributionBucket(7), '5-10');
  assert.equal(distributionBucket(101), '>100');
  assert.equal(percentile([1, 2, 3, 100], 0.95), 100);
});

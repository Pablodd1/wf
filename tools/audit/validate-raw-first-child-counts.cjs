'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const BRANDS = ['Rolex', 'Patek Philippe'];

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function percentile(sorted, fraction) {
  if (!sorted.length) return 0;
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function distributionBucket(count) {
  if (count <= 4) return String(count);
  if (count <= 10) return '5-10';
  if (count <= 20) return '11-20';
  if (count <= 50) return '21-50';
  if (count <= 100) return '51-100';
  return '>100';
}

function emptyBrand() {
  return {
    raw_parent_count: 0,
    generated_child_count: 0,
    unique_child_count: 0,
    duplicate_child_count: 0,
    max_children_per_parent: 0,
    median_children_per_parent: 0,
    p95_children_per_parent: 0,
    p99_children_per_parent: 0,
    child_count_distribution: {
      1: 0, 2: 0, 3: 0, 4: 0,
      '5-10': 0, '11-20': 0, '21-50': 0, '51-100': 0, '>100': 0,
    },
    parents_with_repeated_reference_emission: 0,
    repeated_reference_emissions: 0,
    high_cardinality_samples: [],
  };
}

function checkpointEntries(checkpoint, dataset) {
  return Object.entries(checkpoint.page_files || {})
    .filter(([, meta]) => meta.dataset === dataset)
    .sort(([, a], [, b]) => a.shard - b.shard || a.page - b.page);
}

function validatePageTopology(entries) {
  const seen = new Set();
  const lastPageByShard = new Map();
  const lastCursorByShard = new Map();
  let pageSequenceGaps = 0;
  let repeatedPageCoordinates = 0;
  let nonIncreasingCursors = 0;
  for (const [relative, meta] of entries) {
    const coordinate = `${meta.shard}:${meta.page}`;
    if (seen.has(coordinate)) repeatedPageCoordinates += 1;
    seen.add(coordinate);
    const priorPage = lastPageByShard.get(meta.shard) || 0;
    if (meta.page !== priorPage + 1) pageSequenceGaps += 1;
    const priorCursor = lastCursorByShard.get(meta.shard);
    if (priorCursor && meta.last_id && meta.last_id <= priorCursor) nonIncreasingCursors += 1;
    lastPageByShard.set(meta.shard, meta.page);
    if (meta.last_id) lastCursorByShard.set(meta.shard, meta.last_id);
    if (!relative.endsWith('.json.gz')) throw new Error(`Unexpected page file: ${relative}`);
  }
  return { page_sequence_gaps: pageSequenceGaps,
    repeated_page_coordinates: repeatedPageCoordinates, non_increasing_page_cursors: nonIncreasingCursors };
}

function bucketName(brand, childKey) {
  if (!/^[a-f0-9]{64}$/i.test(String(childKey || ''))) return false;
  const prefix = childKey.slice(0, 2).toLowerCase();
  return `${brand === 'Rolex' ? 'rolex' : 'patek'}-${prefix}.txt`;
}

function countUniqueBuckets(bucketDir, brands) {
  for (const brand of BRANDS) {
    const stem = brand === 'Rolex' ? 'rolex' : 'patek';
    for (let index = 0; index < 256; index += 1) {
      const prefix = index.toString(16).padStart(2, '0');
      const file = path.join(bucketDir, `${stem}-${prefix}.txt`);
      if (!fs.existsSync(file)) continue;
      const keys = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).sort();
      let unique = 0;
      let prior = null;
      for (const key of keys) {
        if (key !== prior) unique += 1;
        prior = key;
      }
      brands[brand].unique_child_count += unique;
      brands[brand].duplicate_child_count += keys.length - unique;
    }
  }
}

function analyzeArtifact(inputDir, options = {}) {
  const root = path.resolve(inputDir);
  const checkpoint = JSON.parse(fs.readFileSync(path.join(root, 'checkpoint.json'), 'utf8'));
  const entries = checkpointEntries(checkpoint, 'raw');
  if (!entries.length) throw new Error('Checkpoint has no raw resume pages');
  const topology = validatePageTopology(entries);
  const bucketDir = fs.mkdtempSync(path.join(options.temporaryRoot || os.tmpdir(), 'raw-first-child-keys-'));
  const brands = Object.fromEntries(BRANDS.map(brand => [brand, emptyBrand()]));
  const cardinalities = Object.fromEntries(BRANDS.map(brand => [brand, []]));
  const parentKeys = new Set();
  const versionKeys = new Set();
  const sourceKeys = new Set();
  let rawRows = 0;
  let duplicateParentRows = 0;
  let duplicateVersionRows = 0;
  let duplicateSourceRows = 0;
  let invalidChildKeys = 0;
  let checksumFailures = 0;
  let rowCountMismatches = 0;

  try {
    for (const [relative, meta] of entries) {
      const file = path.join(root, relative);
      const compressed = fs.readFileSync(file);
      if (sha256(compressed.toString('base64')) !== meta.sha256) checksumFailures += 1;
      const rows = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
      const bucketLines = new Map();
      if (rows.length !== Number(meta.sanitized_rows)) rowCountMismatches += 1;
      for (const record of rows) {
        rawRows += 1;
        if (parentKeys.has(record.parent_key)) duplicateParentRows += 1;
        if (versionKeys.has(record.version_key)) duplicateVersionRows += 1;
        if (sourceKeys.has(record.source_key)) duplicateSourceRows += 1;
        parentKeys.add(record.parent_key);
        versionKeys.add(record.version_key);
        sourceKeys.add(record.source_key);
        if (!BRANDS.includes(record.brand)) continue;
        const summary = brands[record.brand];
        const children = Array.isArray(record.children) ? record.children : [];
        summary.raw_parent_count += 1;
        summary.generated_child_count += children.length;
        cardinalities[record.brand].push(children.length);
        summary.child_count_distribution[distributionBucket(children.length)] += 1;

        const references = new Map();
        for (const child of children) {
          const bucket = bucketName(record.brand, child.child_key);
          if (!bucket) invalidChildKeys += 1;
          else {
            const lines = bucketLines.get(bucket) || [];
            lines.push(child.child_key);
            bucketLines.set(bucket, lines);
          }
          const reference = child.reference_key || '<unresolved>';
          references.set(reference, (references.get(reference) || 0) + 1);
        }
        const repeated = [...references.entries()].filter(([, count]) => count > 1);
        if (repeated.length) {
          summary.parents_with_repeated_reference_emission += 1;
          summary.repeated_reference_emissions += repeated.reduce((sum, [, count]) => sum + count - 1, 0);
        }
        if (children.length > 100) {
          const top = [...references.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
          summary.high_cardinality_samples.push({
            parent_key: record.parent_key,
            version_key: record.version_key,
            source_key: record.source_key,
            page_file: relative,
            classification: record.classification,
            child_count: children.length,
            distinct_reference_count: references.size,
            repeated_reference_count: children.length - references.size,
            most_repeated_references: Object.fromEntries(top),
          });
          summary.high_cardinality_samples.sort((a, b) => b.child_count - a.child_count);
          summary.high_cardinality_samples.length = Math.min(summary.high_cardinality_samples.length, 50);
        }
      }
      for (const [bucket, lines] of bucketLines) {
        fs.appendFileSync(path.join(bucketDir, bucket), `${lines.join('\n')}\n`);
      }
    }
    countUniqueBuckets(bucketDir, brands);
  } finally {
    fs.rmSync(bucketDir, { recursive: true, force: true });
  }

  for (const brand of BRANDS) {
    const values = cardinalities[brand].sort((a, b) => a - b);
    brands[brand].max_children_per_parent = values.at(-1) || 0;
    brands[brand].median_children_per_parent = percentile(values, 0.5);
    brands[brand].p95_children_per_parent = percentile(values, 0.95);
    brands[brand].p99_children_per_parent = percentile(values, 0.99);
    brands[brand].unique_generated_child_manifest_count = brands[brand].unique_child_count;
    brands[brand].identity_reconciliation_passed = brands[brand].unique_child_count
      === brands[brand].unique_generated_child_manifest_count;
  }

  return {
    contract: 'watchfacts-raw-first-child-count-validation-v1',
    source_contract: checkpoint.contract,
    source_decision: checkpoint.decision,
    artifact_root: root,
    raw_rows: rawRows,
    unique_raw_parent_ids: parentKeys.size,
    unique_raw_message_version_ids: versionKeys.size,
    unique_source_record_ids: sourceKeys.size,
    duplicate_raw_parent_rows: duplicateParentRows,
    duplicate_raw_message_version_rows: duplicateVersionRows,
    duplicate_source_record_rows: duplicateSourceRows,
    resume_page_overlap: topology.repeated_page_coordinates,
    checkpoint_overlap_or_double_counting: duplicateParentRows,
    page_topology: topology,
    page_checksum_failures: checksumFailures,
    page_row_count_mismatches: rowCountMismatches,
    invalid_child_identity_keys: invalidChildKeys,
    latest_authoritative_version_contract: 'one latest observed_at/id version selected per raw parent by rawSourceSql',
    artifact_limitation: 'Sanitized children omit raw child text and raw_child_sha256; repeated parser emissions cannot be safely collapsed into real-watch identities from this artifact alone.',
    brands,
  };
}

if (require.main === module) {
  const input = process.argv[2] || process.env.RAW_FIRST_ARTIFACT;
  const output = process.argv[3] || process.env.RAW_FIRST_CHILD_VALIDATION_OUTPUT;
  if (!input) throw new Error('Usage: node validate-raw-first-child-counts.cjs <artifact-directory> [output.json]');
  const result = analyzeArtifact(input);
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (output) {
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(path.resolve(output), json);
  }
  process.stdout.write(json);
}

module.exports = { analyzeArtifact, distributionBucket, percentile, validatePageTopology };

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { classifyRawPost } = require('./raw-first-rolex-patek-lib.cjs');
const { managementQuery, rawSourceSql, uuidShard } = require('./raw-first-rolex-patek-audit.cjs');

function sha256(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

function repeatedCount(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
}

function priorCursor(checkpoint, meta) {
  if (meta.page <= 1) return null;
  return Object.values(checkpoint.page_files || {}).find(item => item.dataset === 'raw'
    && item.shard === meta.shard && item.page === meta.page - 1)?.last_id || null;
}

async function sampleHighCardinality(artifactRoot, validationReport, options = {}) {
  const checkpoint = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'checkpoint.json'), 'utf8'));
  const report = typeof validationReport === 'string'
    ? JSON.parse(fs.readFileSync(validationReport, 'utf8')) : validationReport;
  const requested = [];
  for (const brand of ['Rolex', 'Patek Philippe']) {
    for (const sample of report.brands[brand].high_cardinality_samples.slice(0, options.perBrand || 5)) {
      requested.push({ brand, ...sample });
    }
  }
  const byPage = new Map();
  for (const sample of requested) {
    const list = byPage.get(sample.page_file) || [];
    list.push(sample);
    byPage.set(sample.page_file, list);
  }
  const results = [];
  for (const [pageFile, samples] of byPage) {
    const meta = checkpoint.page_files[pageFile];
    if (!meta) throw new Error(`Missing checkpoint metadata for ${pageFile}`);
    const bounds = uuidShard(meta.shard, checkpoint.shard_count);
    const rows = await managementQuery(rawSourceSql(bounds, priorCursor(checkpoint, meta), 5000),
      `high-cardinality-sample-${meta.shard}-${meta.page}`, options);
    const wanted = new Map(samples.map(sample => [sample.parent_key, sample]));
    for (const row of rows) {
      const key = sha256(row.raw_message_id);
      const requestedSample = wanted.get(key);
      if (!requestedSample) continue;
      const parsed = classifyRawPost(row);
      const childLineHashes = parsed.children.map(child => child.raw_child_sha256);
      const references = parsed.children.map(child => child.observed_reference_key || '<unresolved>');
      results.push({
        brand: requestedSample.brand,
        parent_key: key,
        version_key_matches_artifact: sha256(row.id) === requestedSample.version_key,
        source_key_matches_artifact: (row.source_record_id
          ? sha256(row.source_record_id) : `listing:${sha256(row.id)}`) === requestedSample.source_key,
        raw_text_sha256: parsed.parent.raw_text_sha256,
        raw_text_bytes: Buffer.byteLength(parsed.parent.raw_text, 'utf8'),
        classification: parsed.classification,
        generated_children: parsed.children.length,
        unique_child_line_hashes: new Set(childLineHashes).size,
        duplicate_child_line_emissions: repeatedCount(childLineHashes),
        distinct_references: new Set(references).size,
        repeated_reference_emissions: repeatedCount(references),
      });
    }
  }
  const rawTextCounts = new Map();
  for (const result of results) {
    rawTextCounts.set(result.raw_text_sha256, (rawTextCounts.get(result.raw_text_sha256) || 0) + 1);
  }
  return {
    contract: 'watchfacts-raw-first-high-cardinality-sample-v1',
    canonical_project_ref: 'qnsafosakvonzgfcsphh',
    read_only: true,
    production_writes: 0,
    requested_samples: requested.length,
    matched_samples: results.length,
    samples_with_artifact_version_match: results.filter(row => row.version_key_matches_artifact).length,
    samples_with_duplicate_child_line_emissions: results.filter(row => row.duplicate_child_line_emissions > 0).length,
    duplicate_child_line_emissions: results.reduce((sum, row) => sum + row.duplicate_child_line_emissions, 0),
    repeated_raw_texts_across_sampled_parents: [...rawTextCounts.values()]
      .reduce((sum, count) => sum + Math.max(0, count - 1), 0),
    samples: results,
  };
}

if (require.main === module) {
  const artifactRoot = process.argv[2];
  const report = process.argv[3];
  const output = process.argv[4];
  if (!artifactRoot || !report || !output) {
    throw new Error('Usage: node sample-raw-first-high-cardinality.cjs <artifact-root> <validation-report> <output.json>');
  }
  sampleHighCardinality(artifactRoot, report).then(result => {
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(path.resolve(output), `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch(error => {
    process.stderr.write(`${JSON.stringify({ read_only: true, production_writes: 0,
      error: String(error.message || error).slice(0, 500) })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { priorCursor, repeatedCount, sampleHighCardinality };

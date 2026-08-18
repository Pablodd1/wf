'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { atomicJson, boundedInteger, jsonLine, readJsonLines, sha256 } = require('./lib.cjs');
const { buildPublicationReview } = require('./publication-review.cjs');

function increment(map, key) {
  const normalized = key == null || key === '' ? '<NULL>' : String(key);
  map[normalized] = (map[normalized] || 0) + 1;
}

async function* proposalsFromManifest(manifest) {
  for (const segment of manifest.segments || []) {
    const file = path.join(segment.directory, 'normalization-proposals.jsonl');
    if (!fs.existsSync(file)) throw new Error(`Proposal segment missing: ${file}`);
    for await (const line of readJsonLines(file)) {
      if (line.trim()) yield JSON.parse(line);
    }
  }
}

function priorityFamily(reference, brand) {
  const key = String(reference || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const brandKey = String(brand || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (brandKey === 'PATEKPHILIPPE' && key.startsWith('5712')) return 'PATEK_5712_FAMILY';
  if (brandKey === 'ROLEX' && (key === '116500LN' || key === '116500')) return 'ROLEX_116500_FAMILY';
  return null;
}

async function run(options = {}) {
  const env = options.env || process.env;
  if (!env.MARIADB_PUBLICATION_RAW_INPUT) throw new Error('MARIADB_PUBLICATION_RAW_INPUT is required');
  if (!env.MARIADB_PUBLICATION_NORMALIZATION_MANIFEST) throw new Error('MARIADB_PUBLICATION_NORMALIZATION_MANIFEST is required');
  if (!env.MARIADB_PUBLICATION_AUDIT_OUTPUT) throw new Error('MARIADB_PUBLICATION_AUDIT_OUTPUT is required');
  const rawInput = path.resolve(env.MARIADB_PUBLICATION_RAW_INPUT);
  const manifestPath = path.resolve(env.MARIADB_PUBLICATION_NORMALIZATION_MANIFEST);
  const output = path.resolve(env.MARIADB_PUBLICATION_AUDIT_OUTPUT);
  const sampleLimit = boundedInteger(env.MARIADB_PUBLICATION_SAMPLE_LIMIT, 25, 1, 100, 'MARIADB_PUBLICATION_SAMPLE_LIMIT');
  const reportPath = path.join(output, 'publication-readiness-report.json');
  const samplesPath = path.join(output, 'publication-readiness-samples.jsonl');
  if (!fs.existsSync(rawInput)) throw new Error(`Raw input does not exist: ${rawInput}`);
  if (!fs.existsSync(manifestPath)) throw new Error(`Normalization manifest does not exist: ${manifestPath}`);
  if (fs.existsSync(reportPath) || fs.existsSync(samplesPath)) throw new Error('Publication audit output already exists');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.source_coverage_reconciled !== true || Number(manifest.difference) !== 0) {
    throw new Error('Normalization manifest is not fully reconciled');
  }
  if (Number(manifest.totals?.error_rows) !== 0) throw new Error('Publication audit refuses normalization errors');
  fs.mkdirSync(output, { recursive: true });

  const counts = {
    category: {},
    intent: {},
    bundle_status: {},
    review_disposition: {},
    trading_floor_status: {},
    price_research_status: {},
    media: {},
    seller: {},
    priority_reference: {},
  };
  const sampled = {};
  let sourceRows = 0;
  let reviewRows = 0;
  let bundleChildren = 0;
  const proposals = proposalsFromManifest(manifest)[Symbol.asyncIterator]();

  for await (const line of readJsonLines(rawInput)) {
    if (!line.trim()) continue;
    const source = JSON.parse(line);
    const proposalResult = await proposals.next();
    if (proposalResult.done) throw new Error(`Normalization proposals ended before source row ${sourceRows + 1}`);
    const review = buildPublicationReview(source, proposalResult.value);
    sourceRows += 1;
    reviewRows += 1;
    bundleChildren += review.review_children.length;
    increment(counts.category, review.category);
    increment(counts.intent, review.candidate?.listing_type || null);
    increment(counts.bundle_status, review.bundle_status);
    increment(counts.review_disposition, review.review_disposition);
    increment(counts.trading_floor_status, review.trading_floor_status);
    increment(counts.price_research_status, review.price_research_status);
    increment(counts.media, review.media.exact_source_lineage ? 'SOURCE_MEDIA_LINKED' : 'NO_SOURCE_MEDIA');
    increment(counts.media, review.media.public_image_eligible ? 'PUBLIC_IMAGE_ELIGIBLE' : 'PUBLIC_IMAGE_PENDING');
    increment(counts.seller, review.seller.public.name ? 'SOURCE_NAME_PRESENT' : 'SOURCE_NAME_MISSING');
    increment(counts.seller, review.seller.private_source_evidence.phone ? 'PRIVATE_PHONE_PRESENT' : 'PRIVATE_PHONE_MISSING');
    const family = priorityFamily(review.candidate?.reference, review.candidate?.brand);
    if (family) increment(counts.priority_reference, `${family}:${review.trading_floor_status}:${review.price_research_status}`);

    const sampleKey = `${review.category}:${review.trading_floor_status}:${review.price_research_status}`;
    if ((sampled[sampleKey] || 0) < sampleLimit) {
      fs.appendFileSync(samplesPath, jsonLine({
        source_record_id: review.source_record_id,
        source_hash: review.source_hash,
        category: review.category,
        intent: review.candidate?.listing_type || null,
        bundle_status: review.bundle_status,
        trading_floor_status: review.trading_floor_status,
        price_research_status: review.price_research_status,
        brand: review.candidate?.brand || null,
        reference: review.candidate?.reference || null,
        price: review.candidate?.price || null,
        raw_message_sha256: sha256(review.raw_message || ''),
        raw_evidence_ref: review.source_record_id,
        media_review_reason: review.media.review_reason,
        review_reasons: review.review_reasons,
      }));
      sampled[sampleKey] = (sampled[sampleKey] || 0) + 1;
    }
  }
  const extraProposal = await proposals.next();
  if (!extraProposal.done) throw new Error('Normalization proposals contain rows beyond the raw archive');
  if (sourceRows !== Number(manifest.source_rows) || reviewRows !== sourceRows) {
    throw new Error(`Publication audit row reconciliation failed: ${sourceRows}/${manifest.source_rows}`);
  }

  const report = {
    contract: 'wf-mariadb-publication-readiness-audit-v1',
    generated_at: new Date().toISOString(),
    source_rows: sourceRows,
    review_rows: reviewRows,
    bundle_child_review_rows: bundleChildren,
    difference: sourceRows - reviewRows,
    reconciled: true,
    counts,
    sample_rows: sampled,
    production_writes: 0,
    watch_records_writes: 0,
  };
  atomicJson(reportPath, report);
  return report;
}

if (require.main === module) {
  run().then(report => {
    process.stdout.write(`${JSON.stringify({ event: 'mariadb_publication_readiness_audit_complete', ...report })}\n`);
  }).catch(error => {
    process.stderr.write(`${JSON.stringify({
      event: 'mariadb_publication_readiness_audit_error',
      error_name: error.name || 'Error',
      error_message: error.message || String(error),
      production_writes: 0,
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { priorityFamily, proposalsFromManifest, run };

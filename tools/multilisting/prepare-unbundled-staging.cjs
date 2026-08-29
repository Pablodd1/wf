'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { deterministicUuid } = require('./bundle-cohort.cjs');
const { serializeJsonLine } = require('./json-line.cjs');

function text(value) {
  return String(value ?? '').trim();
}

function childPriceEvidenceScope(row) {
  const evidence = text(row.currency_evidence).toLowerCase();
  const hasPrice = Number.isFinite(Number(row.price_raw)) && Number(row.price_raw) > 0;
  if (!hasPrice) return 'NO_PRICE_EVIDENCE';
  if (evidence === 'explicit_line_currency') return 'EXPLICIT_CHILD_LINE';
  if (evidence === 'section_currency') return 'INHERITED_SECTION_CONTEXT';
  return 'REVIEW_REQUIRED';
}

function atomicJson(filePath, value) {
  const temporary = `${filePath}.partial`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
}

async function loadLineage(filePath) {
  const rows = new Map();
  if (!filePath || !fs.existsSync(filePath)) return rows;
  for await (const line of readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    rows.set(text(row.source_record_id), row);
  }
  return rows;
}

function stagingRow(row, lineage, batchId, sourceLabel = 'MANUAL_UNBUNDLE_BATCH_002') {
  const sourceDate = text(row.source_created_at) || text(lineage?.listing_date) || text(lineage?.source_created_at) || null;
  const flags = [
    'UNBUNDLED_CHILD',
    `UNBUNDLED_PARENT:${row.source_record_id}`,
    `UNBUNDLED_CHILD_INDEX:${row.child_index}`,
    `REVIEW_BUCKET:${row.review_bucket}`,
    ...((row.blockers || []).map(value => `BLOCKER:${value}`)),
    ...((row.review_reasons || []).map(value => `REVIEW:${value}`)),
  ];
  if (!lineage?.dealer_id && !lineage?.seller_phone) flags.push('DEALER_ATTRIBUTION_MISSING');
  return {
    id: deterministicUuid(`${row.parser_version}:${row.listing_id}`),
    batch_id: batchId,
    parent_source_id: text(row.source_record_id) || null,
    source_child_id: text(row.listing_id) || null,
    source_child_index: Number.isInteger(Number(row.child_index)) ? Number(row.child_index) : null,
    raw_child_line: text(row.raw_line) || null,
    price_evidence_scope: childPriceEvidenceScope(row),
    source_currency_evidence: text(row.currency_evidence) || null,
    raw_message: row.raw_line,
    brand: row.brand,
    reference: row.reference,
    dial_color: row.dial_color,
    condition: row.condition,
    year: null,
    price_raw: row.price_raw,
    price_usd: row.price_usd,
    currency: row.price_currency,
    source: sourceLabel,
    confidence: 0,
    verdict: 'PENDING',
    created_at: sourceDate,
    normalized_at: new Date().toISOString(),
    processed_at: null,
    parser_version: row.parser_version,
    listing_type: row.listing_type,
    human_edited: false,
    flags,
    field_confidence: {
      exact_raw_lineage: row.exact_raw_lineage === true,
      catalog_confirmed: row.catalog_confirmed === true,
      catalog_dial_confirmed: row.catalog_dial_confirmed,
      currency_evidence: row.currency_evidence,
      source_record_id: row.source_record_id,
      source_child_id: row.listing_id,
      source_child_index: Number.isInteger(Number(row.child_index)) ? Number(row.child_index) : null,
      source_created_at: sourceDate,
      dealer_id: lineage?.dealer_id || null,
      seller_name: lineage?.seller_name || null,
      seller_phone: lineage?.seller_phone || null,
      region: lineage?.region || null,
      review_bucket: row.review_bucket,
    },
    accessories: null,
    image_urls: [],
    thumbnail_url: null,
    has_images: false,
  };
}

async function prepare({ normalizedDir, lineagePath, outputDir, batchId, sourceLabel = 'MANUAL_UNBUNDLE_BATCH_002' }) {
  const report = JSON.parse(fs.readFileSync(path.join(normalizedDir, 'report.json'), 'utf8'));
  const lineage = await loadLineage(lineagePath);
  fs.mkdirSync(outputDir, { recursive: true });
  const manifestPath = path.join(outputDir, 'watch-staging.jsonl');
  const temporary = `${manifestPath}.partial`;
  const output = fs.createWriteStream(temporary, { encoding: 'utf8' });
  const ids = new Set();
  const result = {
    generatedAt: new Date().toISOString(), batchId, normalizedDir: path.resolve(normalizedDir),
    lineagePath: lineagePath ? path.resolve(lineagePath) : null, lineageParents: lineage.size,
    rows: 0, duplicateIds: 0, invalidRows: 0, sourceDates: 0, dealerAttribution: 0,
    reviewBuckets: {}, productionWrites: 0, target: 'watch_staging',
  };
  for (const file of report.files || []) {
    if (!['review-ready', 'human-correction'].includes(file.bucket)) continue;
    const input = readline.createInterface({ input: fs.createReadStream(file.path), crlfDelay: Infinity });
    for await (const line of input) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      const source = lineage.get(text(row.source_record_id));
      const staged = stagingRow(row, source, batchId, sourceLabel);
      result.rows += 1;
      result.reviewBuckets[file.bucket] = (result.reviewBuckets[file.bucket] || 0) + 1;
      if (ids.has(staged.id)) result.duplicateIds += 1;
      ids.add(staged.id);
      if (!staged.field_confidence.exact_raw_lineage || !staged.field_confidence.catalog_confirmed
        || staged.verdict !== 'PENDING' || staged.confidence !== 0) result.invalidRows += 1;
      if (staged.created_at) result.sourceDates += 1;
      if (staged.field_confidence.dealer_id || staged.field_confidence.seller_phone) result.dealerAttribution += 1;
      output.write(`${serializeJsonLine(staged)}\n`);
    }
  }
  await new Promise((resolve, reject) => output.end(error => error ? reject(error) : resolve()));
  fs.renameSync(temporary, manifestPath);
  result.manifestPath = manifestPath;
  result.passed = result.rows > 0 && result.duplicateIds === 0 && result.invalidRows === 0;
  atomicJson(path.join(outputDir, 'report.json'), result);
  return result;
}

async function main() {
  const normalizedDir = path.resolve(process.env.UNBUNDLED_NORMALIZED_OUTPUT || process.argv[2] || 'audit-output/unbundled/batch-002-normalized-v5');
  const lineagePath = process.env.UNBUNDLED_SOURCE_LINEAGE || process.argv[3] || null;
  const outputDir = path.resolve(process.env.UNBUNDLED_STAGING_OUTPUT || 'audit-output/unbundled/batch-002-staging');
  const batchId = text(process.env.UNBUNDLED_BATCH_ID);
  const sourceLabel = text(process.env.UNBUNDLED_SOURCE_LABEL || 'MANUAL_UNBUNDLE_BATCH_002');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(batchId)) {
    throw new Error('UNBUNDLED_BATCH_ID must be a UUID');
  }
  if (!/^MANUAL_UNBUNDLE_BATCH_\d{3}$/i.test(sourceLabel)) {
    throw new Error('UNBUNDLED_SOURCE_LABEL must match MANUAL_UNBUNDLE_BATCH_NNN');
  }
  const result = await prepare({ normalizedDir, lineagePath, outputDir, batchId, sourceLabel });
  process.stdout.write(`${JSON.stringify({ event: 'unbundled_staging_manifest_complete', ...result }, null, 2)}\n`);
  if (!result.passed) process.exitCode = 1;
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'unbundled_staging_manifest_error', error: error.message })}\n`);
  process.exitCode = 1;
});

module.exports = { childPriceEvidenceScope, loadLineage, prepare, stagingRow };

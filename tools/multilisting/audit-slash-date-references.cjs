'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const csv = require('csv-parser');
const { segmentDealerMessage } = require('../../api/_lib/normalization-v4.cjs');
const { confirmCatalogCandidate } = require('../shadow-reprocess/catalog-confirmation.cjs');

const HEADERS = [
  'listing_id', 'source_record_id', 'candidate_index', 'brand', 'reference', 'model',
  'raw_line', 'condition', 'price_raw', 'price_currency', 'price_usd', 'price_text',
  'listing_type', 'dial_color', 'set_status', 'listing_status', 'change_flags',
  'review_status', 'analyzed_at', 'source_created_at', 'source_type', 'seller_name',
  'seller_phone', 'dealer', 'exchange', 'image_url',
];
const DATE_REFERENCE = /^(?:19|20)\d{2}\/(?:0?[1-9]|1[0-2])$/;
const RG_PATTERN = '^[^,]*,[^,]*,[^,]*,[^,]*,(?:19|20)\\d{2}/(?:0?[1-9]|1[0-2]),';
const catalogCache = new Map();

function text(value) {
  return String(value ?? '').trim();
}

function primaryPrice(candidate) {
  return candidate?.prices?.find(price => price?.is_primary) || candidate?.prices?.[0] || null;
}

function catalogConfirmation(brand, reference) {
  const key = `${text(brand).toUpperCase()}|${text(reference).toUpperCase()}`;
  if (!catalogCache.has(key)) {
    catalogCache.set(key, confirmCatalogCandidate({ brand: text(brand), reference: text(reference) }));
  }
  return catalogCache.get(key);
}

function classifyRow(row) {
  const candidates = segmentDealerMessage(text(row.raw_line));
  const references = [...new Set(candidates
    .map(candidate => text(candidate.reference).toUpperCase())
    .filter(reference => reference && !DATE_REFERENCE.test(reference)))];
  const matching = references.length === 1
    ? candidates.find(candidate => text(candidate.reference).toUpperCase() === references[0])
    : null;
  const price = primaryPrice(matching);
  const catalog = references.length === 1
    ? catalogConfirmation(row.brand, references[0])
    : null;
  let decision = 'NO_RECOVERABLE_REFERENCE';
  if (references.length === 1) {
    decision = catalog?.confirmed
      ? 'CATALOG_CONFIRMED_CANDIDATE'
      : 'REVIEW_CATALOG_UNCONFIRMED';
  }
  if (references.length > 1) decision = 'REVIEW_MULTIPLE_REFERENCES';

  return {
    listing_id: text(row.listing_id),
    source_record_id: text(row.source_record_id),
    candidate_index: text(row.candidate_index),
    brand: text(row.brand),
    exported_reference: text(row.reference),
    proposed_reference: references.length === 1 ? references[0] : null,
    catalog_confirmed: catalog?.confirmed === true,
    catalog_reason: catalog?.reason || null,
    catalog_model: catalog?.match?.model || null,
    decision,
    raw_line: text(row.raw_line),
    exported_price_raw: text(row.price_raw),
    exported_currency: text(row.price_currency),
    exported_price_usd: text(row.price_usd),
    proposed_price_raw: price?.amount_original ?? null,
    proposed_currency: price?.currency_original ?? null,
    proposed_price_usd: price?.amount_usd ?? null,
    production_approved: false,
  };
}

function increment(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function csvValue(value) {
  const source = value == null ? '' : String(value);
  return /[",\r\n]/.test(source) ? `"${source.replace(/"/g, '""')}"` : source;
}

async function scanFile(filePath, onRow) {
  const process = spawn('rg', ['--no-filename', '--no-line-number', RG_PATTERN, '--', filePath], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  process.stderr.setEncoding('utf8');
  process.stderr.on('data', chunk => { stderr += chunk; });
  const completed = new Promise((resolve, reject) => {
    process.once('error', reject);
    process.once('close', resolve);
  });
  const parser = process.stdout.pipe(csv({ headers: HEADERS, strict: false }));
  for await (const row of parser) onRow(row);
  const code = await completed;
  if (code !== 0 && code !== 1) throw new Error(`rg failed for ${filePath}: ${stderr.trim()}`);
}

async function auditDirectory({ inputDir, outputDir, samplePerFile = 100 }) {
  const files = fs.readdirSync(inputDir)
    .filter(name => /listings_batch_\d+\.csv$/i.test(name))
    .sort();
  const counts = { decision: {}, brand: {}, file: {} };
  const samples = [];
  let total = 0;

  for (const name of files) {
    let fileRows = 0;
    let sampled = 0;
    await scanFile(path.join(inputDir, name), row => {
      const result = classifyRow(row);
      total += 1;
      fileRows += 1;
      increment(counts.decision, result.decision);
      increment(counts.brand, result.brand || 'UNKNOWN');
      if (sampled < samplePerFile) {
        samples.push({ input_file: name, ...result });
        sampled += 1;
      }
    });
    counts.file[name] = fileRows;
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const report = {
    generated_at: new Date().toISOString(),
    input_directory: path.resolve(inputDir),
    files_scanned: files.length,
    rows_with_slash_date_reference: total,
    counts,
    sample_rows: samples.length,
    production_writes: 0,
    release_gate: 'HUMAN_AND_CATALOG_REVIEW_REQUIRED',
  };
  fs.writeFileSync(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const columns = samples.length ? Object.keys(samples[0]) : [];
  const sampleCsv = [
    columns.join(','),
    ...samples.map(row => columns.map(column => csvValue(row[column])).join(',')),
  ].join('\n');
  fs.writeFileSync(path.join(outputDir, 'sample.csv'), `${sampleCsv}\n`);
  return report;
}

async function main() {
  const inputDir = path.resolve(process.env.UNBUNDLED_INPUT_DIR || process.argv[2] || '.');
  const outputDir = path.resolve(process.env.SLASH_DATE_AUDIT_OUTPUT || 'outputs/slash-date-reference-audit');
  const samplePerFile = Math.max(1, Math.min(Number(process.env.SLASH_DATE_SAMPLE_PER_FILE || 100), 1000));
  const report = await auditDirectory({ inputDir, outputDir, samplePerFile });
  process.stdout.write(`${JSON.stringify({ event: 'slash_date_reference_audit_complete', outputDir, ...report }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ event: 'slash_date_reference_audit_error', error: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { auditDirectory, classifyRow };

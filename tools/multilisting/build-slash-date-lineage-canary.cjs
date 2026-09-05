'use strict';

const fs = require('node:fs');
const path = require('node:path');
const csv = require('csv-parser');
const { buildCanaryRow } = require('./build-unbundled-canary.cjs');
const { serializeJsonLine } = require('./json-line.cjs');

function text(value) {
  return String(value ?? '').trim();
}

function increment(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function selectCanary(rows, limit = 100) {
  const eligible = rows
    .filter(row => row.decision === 'CATALOG_CONFIRMED_CANDIDATE')
    .sort((left, right) => `${left.input_file}|${left.listing_id}`.localeCompare(`${right.input_file}|${right.listing_id}`));
  const selected = [];
  const take = (brand, count) => {
    for (const row of eligible) {
      if (selected.length >= limit || count <= 0) break;
      if (text(row.brand).toUpperCase() !== brand || selected.includes(row)) continue;
      selected.push(row);
      count -= 1;
    }
  };
  take('PATEK PHILIPPE', 40);
  take('ROLEX', 40);
  for (const row of eligible) {
    if (selected.length >= limit) break;
    if (!selected.includes(row)) selected.push(row);
  }
  return selected;
}

function streamCsv(filePath, onRow) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', onRow)
      .on('end', resolve)
      .on('error', reject);
  });
}

async function loadParents(inputDir, selected) {
  const byFile = new Map();
  for (const row of selected) {
    const parentFile = text(row.input_file).replace('_listings_', '_raw_messages_');
    const ids = byFile.get(parentFile) || new Set();
    ids.add(text(row.source_record_id));
    byFile.set(parentFile, ids);
  }
  const parents = new Map();
  for (const [name, ids] of byFile) {
    await streamCsv(path.join(inputDir, name), row => {
      const id = text(row.source_record_id);
      if (ids.has(id)) parents.set(id, row);
    });
  }
  return parents;
}

async function buildLineageCanary({ samplePath, inputDir, outputDir, limit = 100 }) {
  const samples = [];
  await streamCsv(samplePath, row => samples.push(row));
  const selected = selectCanary(samples, limit);
  const parents = await loadParents(inputDir, selected);
  const rows = selected.map(row => buildCanaryRow({
    listing_id: row.listing_id,
    source_record_id: row.source_record_id,
    candidate_index: row.candidate_index,
    brand: row.brand,
    reference: row.exported_reference,
    raw_line: row.raw_line,
    price_raw: row.exported_price_raw,
    price_currency: row.exported_currency,
    price_usd: row.exported_price_usd,
  }, parents.get(text(row.source_record_id))));
  const counts = {
    status: {}, blockers: {}, reviewReasons: {}, brand: {},
    parentMatched: 0, exactLineage: 0, sellerName: 0, sellerPhone: 0, sourceDate: 0,
  };
  for (const row of rows) {
    increment(counts.status, row.review_status);
    increment(counts.brand, row.brand || 'UNKNOWN');
    for (const blocker of row.blockers) increment(counts.blockers, blocker);
    for (const reason of row.review_reasons) increment(counts.reviewReasons, reason);
    if (parents.has(row.source_record_id)) counts.parentMatched += 1;
    if (row.exact_raw_lineage) counts.exactLineage += 1;
    if (row.seller_name) counts.sellerName += 1;
    if (row.seller_phone) counts.sellerPhone += 1;
    if (row.source_created_at) counts.sourceDate += 1;
  }
  const report = {
    generated_at: new Date().toISOString(),
    source_sample: path.resolve(samplePath),
    selected_rows: rows.length,
    counts,
    production_writes: 0,
    release_gate: 'INDIVIDUAL_HUMAN_APPROVAL_REQUIRED',
  };
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'rows.jsonl'), `${rows.map(serializeJsonLine).join('\n')}\n`);
  fs.writeFileSync(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function main() {
  const samplePath = path.resolve(process.env.SLASH_DATE_SAMPLE_PATH || process.argv[2] || '');
  const inputDir = path.resolve(process.env.UNBUNDLED_INPUT_DIR || process.argv[3] || '.');
  const outputDir = path.resolve(process.env.SLASH_DATE_CANARY_OUTPUT || 'outputs/slash-date-lineage-canary');
  const limit = Math.max(1, Math.min(Number(process.env.SLASH_DATE_CANARY_ROWS || 100), 1000));
  if (!fs.existsSync(samplePath)) throw new Error('Provide the slash-date audit sample.csv path.');
  const report = await buildLineageCanary({ samplePath, inputDir, outputDir, limit });
  process.stdout.write(`${JSON.stringify({ event: 'slash_date_lineage_canary_complete', outputDir, ...report }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ event: 'slash_date_lineage_canary_error', error: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { buildLineageCanary, selectCanary };

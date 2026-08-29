'use strict';

// Read-only, PII-free manifest builder for exact legacy-ledger price evidence
// corrections. It regenerates rows with the current strict importer and reads
// only those exact IDs from canonical QNSA. It never writes to production.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const importer = require('./import-approved-admission-workbook.cjs');

const PROJECT_REF = 'qnsafosakvonzgfcsphh';
const TABLE = 'reviewed_workbook_inventory';
const TARGET_STATUSES = new Set([
  'PRICE_NOT_SUPPLIED',
  'PRICE_RESEARCH_ADMISSION_NOT_ELIGIBLE',
]);

function text(value) { return value === null || value === undefined ? '' : String(value).trim(); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function parseArgs(argv) {
  const ledgers = [];
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const value = argv[++index];
    if (key === '--ledger') ledgers.push(value);
    else values[key.slice(2)] = value;
  }
  if (!ledgers.length) throw new Error('at least one --ledger "Brand::path" is required');
  const parsedLedgers = ledgers.map(value => {
    const separator = value.indexOf('::');
    if (separator < 1) throw new Error('--ledger must use Brand::path');
    const brand = value.slice(0, separator).trim();
    const input = path.resolve(value.slice(separator + 2).trim());
    if (!brand || !input) throw new Error('--ledger must use Brand::path');
    if (!fs.existsSync(input)) throw new Error(`ledger not found: ${input}`);
    return { brand, input };
  });
  const batchSize = Number(values['batch-size'] || 100);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 200) {
    throw new Error('--batch-size must be 1 through 200');
  }
  const expectedRows = values['expect-manifest-rows'] === undefined
    ? null : Number(values['expect-manifest-rows']);
  if (expectedRows !== null && (!Number.isInteger(expectedRows) || expectedRows < 0)) {
    throw new Error('--expect-manifest-rows must be a non-negative integer');
  }
  return {
    ledgers: parsedLedgers,
    batchSize,
    expectedRows,
    outputDir: path.resolve(values['output-dir'] || path.join(
      'audit-output', `legacy-ledger-price-drift-${Date.now()}`,
    )),
    confirmProject: text(values['confirm-project']),
  };
}

function assertQnsa(url, confirmProject) {
  if (confirmProject !== PROJECT_REF) throw new Error('explicit QNSA project confirmation is required');
  const parsed = new URL(url);
  if (parsed.hostname !== `${PROJECT_REF}.supabase.co`) throw new Error('SUPABASE_URL is not canonical QNSA');
}

function buildLedgerCandidates({ brand, input }) {
  const workbook = importer.readAdmissionWorkbook(input);
  const fileName = path.basename(input);
  const candidates = [];
  workbook.sourceRows.forEach((source, index) => {
    const decision = workbook.decisions.get(text(source.listing_id));
    if (!decision) return;
    const row = importer.rowForImport({
      source,
      decision,
      expectedBrand: brand,
      fileName,
      fileSha256: workbook.fileSha256,
      rowNumber: index + 2,
      runId: 'legacy_price_drift_manifest',
      ownerUnbundled: true,
    });
    if (row) candidates.push(row);
  });
  const duplicateResolution = importer.canonicalizeExactDuplicates(candidates);
  return {
    candidates: duplicateResolution.canonical.map(row => ({
      id: row.id,
      source_payload_sha256: row.source_payload_sha256,
      price_evidence_status: row.price_evidence_status,
      workbook_price_usd: row.workbook_price_usd,
      brand,
    })),
    summary: {
      brand,
      source_file: path.resolve(input),
      source_file_sha256: workbook.fileSha256,
      source_rows: workbook.sourceRows.length,
      strict_candidates: duplicateResolution.canonical.length,
      exact_duplicates_excluded: duplicateResolution.excluded.length,
    },
  };
}

function buildManifestRows(candidates, currentRows) {
  const currentById = new Map(currentRows.map(row => [text(row.id), row]));
  const missingIds = [];
  const payloadMismatches = [];
  const manifestRows = [];
  for (const candidate of candidates) {
    const current = currentById.get(candidate.id);
    if (!current) { missingIds.push(candidate.id); continue; }
    if (text(current.source_payload_sha256).toLowerCase()
      !== text(candidate.source_payload_sha256).toLowerCase()) {
      payloadMismatches.push(candidate.id);
      continue;
    }
    if (current.price_evidence_status !== 'SOURCE_EXPLICIT_USD_MATCH'
      || candidate.price_evidence_status === 'SOURCE_EXPLICIT_USD_MATCH') continue;
    if (!TARGET_STATUSES.has(candidate.price_evidence_status)) {
      throw new Error(`unsupported strict target for ${candidate.id}: ${candidate.price_evidence_status}`);
    }
    manifestRows.push({
      listing_id: candidate.id,
      source_payload_sha256: candidate.source_payload_sha256,
      target_price_evidence_status: candidate.price_evidence_status,
      null_price: candidate.workbook_price_usd === null,
      brand: candidate.brand,
      drift_reason: `CURRENT_STRICT_IMPORTER_${candidate.price_evidence_status}`,
    });
  }
  manifestRows.sort((left, right) => left.listing_id.localeCompare(right.listing_id));
  return { manifestRows, missingIds, payloadMismatches };
}

function csvCell(value) {
  const content = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(content) ? `"${content.replaceAll('"', '""')}"` : content;
}

function manifestCsv(rows) {
  const headers = [
    'listing_id', 'source_payload_sha256', 'target_price_evidence_status',
    'null_price', 'brand', 'drift_reason',
  ];
  return `${[
    headers.join(','),
    ...rows.map(row => headers.map(header => csvCell(row[header])).join(',')),
  ].join('\n')}\n`;
}

async function readCurrentRows(client, candidates, batchSize) {
  const rows = [];
  for (let index = 0; index < candidates.length; index += batchSize) {
    const ids = candidates.slice(index, index + batchSize).map(row => row.id);
    const { data, error } = await client.from(TABLE)
      .select('id,source_payload_sha256,price_evidence_status,workbook_price_usd')
      .in('id', ids);
    if (error) throw error;
    rows.push(...(data || []));
  }
  return rows;
}

async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const url = process.env.SUPABASE_URL || '';
  assertQnsa(url, options.confirmProject);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('service-role credential is required for bounded read-only reconciliation');
  const client = createClient(url, key, { auth: { persistSession: false } });
  const candidates = [];
  const ledgerSummaries = [];
  // Ledgers are deliberately processed one at a time; these four inputs are
  // small and this avoids the memory failure mode of the unrelated V4 files.
  for (const ledger of options.ledgers) {
    const result = buildLedgerCandidates(ledger);
    candidates.push(...result.candidates);
    ledgerSummaries.push(result.summary);
  }
  const duplicateIds = candidates.filter((row, index) => (
    candidates.findIndex(other => other.id === row.id) !== index
  ));
  if (duplicateIds.length) throw new Error('duplicate exact IDs across ledgers');
  const currentRows = await readCurrentRows(client, candidates, options.batchSize);
  const result = buildManifestRows(candidates, currentRows);
  if (result.missingIds.length || result.payloadMismatches.length) {
    throw new Error(`exact reconciliation failed: missing=${result.missingIds.length}, payload_mismatch=${result.payloadMismatches.length}`);
  }
  if (options.expectedRows !== null && result.manifestRows.length !== options.expectedRows) {
    throw new Error(`manifest row count ${result.manifestRows.length} does not match expected ${options.expectedRows}`);
  }
  const csv = manifestCsv(result.manifestRows);
  const csvHash = sha256(csv);
  const countsByTarget = Object.fromEntries([...TARGET_STATUSES].map(status => [
    status, result.manifestRows.filter(row => row.target_price_evidence_status === status).length,
  ]));
  const nullPriceRows = result.manifestRows.filter(row => row.null_price).length;
  fs.mkdirSync(options.outputDir, { recursive: true });
  const manifestPath = path.join(options.outputDir, 'legacy-ledger-price-drift.csv');
  fs.writeFileSync(manifestPath, csv, 'utf8');
  const summary = {
    project_ref: PROJECT_REF,
    target_table: TABLE,
    read_only: true,
    database_writes: 0,
    source_ledgers: ledgerSummaries,
    exact_candidates_checked: candidates.length,
    exact_current_rows_found: currentRows.length,
    manifest_rows: result.manifestRows.length,
    target_status_counts: countsByTarget,
    null_price_rows: nullPriceRows,
    retain_existing_price_rows: result.manifestRows.length - nullPriceRows,
    manifest_file: path.resolve(manifestPath),
    manifest_sha256: csvHash,
    manifest_columns_pii_free: true,
  };
  fs.writeFileSync(path.join(options.outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  PROJECT_REF, assertQnsa, buildLedgerCandidates, buildManifestRows, manifestCsv, parseArgs, run,
};

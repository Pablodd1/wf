'use strict';

// Read-only exact-ID reconciliation for one owner-reviewed unbundled workbook.
// It builds the same deterministic rows as the admission importer, then checks
// QNSA without inserting, updating, or deleting anything.

const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const intake = require('./import-approved-admission-workbook.cjs');

const CANONICAL_PROJECT_REF = 'qnsafosakvonzgfcsphh';

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    values[argv[index].slice(2)] = argv[index + 1];
    index += 1;
  }
  if (!values.input || !values.brand) throw new Error('--input and --brand are required');
  return {
    input: path.resolve(values.input),
    brand: text(values.brand),
    runId: text(values['run-id']) || 'read_only_unbundled_reconciliation',
  };
}

function buildExpectedRows({ input, brand, runId = 'read_only_unbundled_reconciliation' }) {
  if (!intake.OWNER_UNBUNDLED_BRANDS.has(brand)) {
    throw new Error(`owner-unbundled reconciliation is not allowlisted for ${brand}`);
  }
  const workbook = intake.readAdmissionWorkbook(input);
  const candidates = [];
  const heldReasons = {};
  let missingDecisions = 0;
  workbook.sourceRows.forEach((source, index) => {
    const decision = workbook.decisions.get(text(source.listing_id));
    if (!decision) {
      missingDecisions += 1;
      return;
    }
    const admission = intake.classifyOwnerUnbundledRow(source, decision, brand);
    const importReasons = [
      ...admission.reasons.filter(reason => !intake.PRICE_RESEARCH_ONLY_REASONS.has(reason)),
      ...intake.additionalImportReasons(source, { allowNoImage: true, ownerUnbundled: true }),
      ...intake.admissionIdentityGateReasons(source, decision, brand),
    ];
    if (!admission.trading_floor_candidate || importReasons.length) {
      for (const reason of new Set(importReasons)) {
        heldReasons[reason] = (heldReasons[reason] || 0) + 1;
      }
      return;
    }
    const row = intake.rowForImport({
      source,
      decision,
      expectedBrand: brand,
      fileName: path.basename(input),
      fileSha256: workbook.fileSha256,
      rowNumber: index + 2,
      runId,
      ownerUnbundled: true,
    });
    if (row) candidates.push(row);
  });
  const duplicateResolution = intake.canonicalizeExactDuplicates(candidates);
  return {
    workbook,
    rows: duplicateResolution.canonical,
    duplicateExcluded: duplicateResolution.excluded,
    heldReasons,
    missingDecisions,
  };
}

function qnsaClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Supabase server credentials are required for read-only reconciliation');
  const expectedRef = process.env.EXPECTED_SUPABASE_PROJECT_REF || CANONICAL_PROJECT_REF;
  const actualRef = new URL(url).hostname.split('.')[0];
  if (actualRef !== expectedRef) {
    throw new Error(`Supabase project mismatch: expected ${expectedRef}, received ${actualRef}`);
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const plan = buildExpectedRows(options);
  const reconciliation = await intake.verifyImportedRows(qnsaClient(), plan.rows);
  const report = {
    mode: 'READ_ONLY_EXACT_ID_RECONCILIATION',
    project_ref: process.env.EXPECTED_SUPABASE_PROJECT_REF || CANONICAL_PROJECT_REF,
    source_file: path.basename(options.input),
    source_sha256: plan.workbook.fileSha256,
    brand: options.brand,
    source_rows: plan.workbook.sourceRows.length,
    expected_unique_candidates: plan.rows.length,
    expected_price_research_candidates: plan.rows.filter(row => (
      row.listing_type === 'WTS'
      && row.price_evidence_status === 'SOURCE_EXPLICIT_USD_MATCH'
    )).length,
    duplicate_candidates_excluded: plan.duplicateExcluded.length,
    missing_decisions: plan.missingDecisions,
    held_reasons: plan.heldReasons,
    reconciliation,
    database_writes: 0,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!reconciliation.ok) process.exitCode = 2;
  return report;
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({ status: 'error', error: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { CANONICAL_PROJECT_REF, buildExpectedRows, parseArgs, qnsaClient, run };

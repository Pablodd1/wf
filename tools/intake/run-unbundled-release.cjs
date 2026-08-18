'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const intake = require('./import-approved-admission-workbook.cjs');
const reconciliation = require('./reconcile-approved-unbundled-inventory.cjs');
const dealerLinkage = require('../dealer-lineage/reconcile-reviewed-workbook-dealer-links.cjs');
const { validateReleasePackage } = require('./unbundled-release-package.cjs');

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    values[argv[index].slice(2)] = argv[index + 1];
    index += 1;
  }
  if (!['audit', 'canary', 'full'].includes(values.mode)) throw new Error('--mode must be audit, canary, or full');
  if (!values.directory || !values.output) throw new Error('--directory and --output are required');
  return {
    mode: values.mode,
    directory: path.resolve(values.directory),
    output: path.resolve(values.output),
  };
}

function fieldHistogram(drift) {
  const result = {};
  for (const item of drift || []) {
    for (const field of item.fields || []) result[field] = (result[field] || 0) + 1;
  }
  return result;
}

function sanitizedReconciliation(result) {
  return {
    expected: result.expected,
    found: result.found,
    exact: result.exact,
    missing: result.missing_ids.length,
    drift: result.drift.length,
    drift_fields: fieldHistogram(result.drift),
    lineage_schema_ready: result.lineage_schema_ready,
    lineage_verified: result.lineage_verified,
    ok: result.ok,
  };
}

async function inspectPlans(client, packageInfo) {
  const lineageReady = process.env.UNBUNDLED_LINEAGE_SCHEMA_READY !== 'false';
  const plans = [];
  for (const file of packageInfo.files) {
    const plan = reconciliation.buildExpectedRows({ input: file.filePath, brand: file.brand });
    const live = await intake.verifyImportedRows(client, plan.rows, { lineageReady });
    plans.push({ file, plan, live });
  }
  return plans;
}

function selectGlobalCanaryRows(plans) {
  const candidates = plans
    .filter(entry => !entry.file.overlapHeld)
    .flatMap(entry => entry.plan.rows.map(row => ({ ...row, canary_brand: entry.file.brand })))
    .sort((left, right) => (
      String(left.canary_brand).localeCompare(String(right.canary_brand))
      || String(left.id).localeCompare(String(right.id))
    ));
  const selected = [];
  const selectedIds = new Set();
  const categories = [
    ['WTB', row => row.listing_type === 'WTB'],
    ['WTS', row => row.listing_type === 'WTS'],
    ['EXACT_REFERENCE', row => Boolean(row.normalized_reference)],
    ['NULL_REFERENCE', row => !row.normalized_reference],
    ['VERIFIED_MODEL', row => Boolean(row.model)],
    ['NULL_MODEL', row => !row.model],
    ['VERIFIED_DIAL', row => Boolean(row.dial_color)],
    ['NULL_DIAL', row => !row.dial_color],
  ];
  const coverage = [];
  for (const [category, predicate] of categories) {
    const row = candidates.find(candidate => !selectedIds.has(candidate.id) && predicate(candidate));
    if (!row) throw new Error(`global canary cannot cover ${category}`);
    selected.push(row);
    selectedIds.add(row.id);
    coverage.push(category);
  }
  for (const row of candidates) {
    if (selected.length === 10) break;
    if (selectedIds.has(row.id)) continue;
    if (selected.some(item => item.canary_brand === row.canary_brand)) continue;
    selected.push(row);
    selectedIds.add(row.id);
  }
  for (const row of candidates) {
    if (selected.length === 10) break;
    if (selectedIds.has(row.id)) continue;
    selected.push(row);
    selectedIds.add(row.id);
  }
  if (selected.length > 10) throw new Error('global canary exceeds 10 rows');
  if (selected.some(row => row.price_evidence_status === 'SOURCE_EXPLICIT_USD_MATCH')) {
    throw new Error('global unbundled canary must not contain Price Research rows');
  }
  return {
    selected: selected.map(({ canary_brand: _brand, ...row }) => row),
    coverage,
    brands: [...new Set(selected.map(row => row.canary_brand))],
  };
}

async function applyGlobalCanary(client, plans) {
  const { selected, coverage, brands } = selectGlobalCanaryRows(plans);
  const liveIds = new Set(plans.flatMap(entry => (
    entry.plan.rows.filter(row => !entry.live.missing_ids.includes(row.id)).map(row => row.id)
  )));
  const missingSelected = selected.filter(row => !liveIds.has(row.id));
  if (missingSelected.length) await intake.upsertBatch(client, missingSelected);
  const readback = await intake.verifyImportedRows(client, selected);
  if (!readback.ok) throw new Error(`global canary readback failed: ${JSON.stringify(sanitizedReconciliation(readback))}`);
  return {
    selected: selected.length,
    written: missingSelected.length,
    coverage,
    brands,
  };
}

async function applyFull(packageInfo) {
  process.env.APPLY_APPROVED_ADMISSION_IMPORT = 'true';
  process.env.REPLACE_APPROVED_ADMISSION_EXISTING = 'true';
  process.env.REVIEWED_WORKBOOK_INVENTORY_TABLE = intake.INVENTORY_TABLE;
  const privateOutput = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-unbundled-import-'));
  for (const file of packageInfo.files) {
    if (file.overlapHeld) continue;
    await intake.run([
      '--input', file.filePath,
      '--brand', file.brand,
      '--unbundled-no-image', 'true',
      '--replace-existing-exact', 'true',
      '--batch-size', '100',
      '--run-id', `encrypted_release_${file.sha256.slice(0, 16)}`,
      '--output-dir', path.join(privateOutput, file.sha256.slice(0, 16)),
    ]);
  }
  if (process.env.UNBUNDLED_DEALER_LINK_SCHEMA_READY !== 'true') {
    throw new Error('dealer link schema must be ready before full linkage');
  }
  if (!process.env.LINK_EVIDENCE_HMAC_KEY || process.env.LINK_EVIDENCE_HMAC_KEY.length < 32) {
    throw new Error('LINK_EVIDENCE_HMAC_KEY is required for full exact dealer linkage');
  }
  process.env.APPLY_REVIEWED_WORKBOOK_DEALER_LINKS = 'true';
  process.env.REVIEWED_WORKBOOK_DEALER_LINK_TABLE = dealerLinkage.LINK_TABLE;
  const dealerLinks = { matched: 0, held: 0, writes: 0 };
  for (const file of packageInfo.files) {
    if (file.overlapHeld) continue;
    const result = await dealerLinkage.run([
      '--input', file.filePath,
      '--brand', file.brand,
      '--unbundled-no-image', 'true',
      '--output', path.join(privateOutput, `dealer-link-${file.sha256.slice(0, 16)}.json`),
    ]);
    dealerLinks.matched += result.exact_unique_verified_matches;
    dealerLinks.held += result.held;
    dealerLinks.writes += result.writes;
  }
  return dealerLinks;
}

async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const packageInfo = validateReleasePackage(options.directory);
  const client = reconciliation.qnsaClient();
  const initial = await inspectPlans(client, packageInfo);
  let appliedCanary = { selected: 0, written: 0, coverage: [], brands: [] };
  let dealerLinks = { matched: 0, held: 0, writes: 0 };
  if (options.mode === 'canary') appliedCanary = await applyGlobalCanary(client, initial);
  if (options.mode === 'full') dealerLinks = await applyFull(packageInfo);
  const final = options.mode === 'audit' ? initial : await inspectPlans(client, packageInfo);
  const report = {
    mode: options.mode.toUpperCase(),
    project_ref: reconciliation.CANONICAL_PROJECT_REF,
    workbook_count: packageInfo.files.length,
    overlap_held_brands: packageInfo.files.filter(item => item.overlapHeld).map(item => item.brand),
    global_canary_rows_selected: appliedCanary.selected,
    global_canary_rows_applied: appliedCanary.written,
    global_canary_coverage: appliedCanary.coverage,
    global_canary_brands: appliedCanary.brands,
    dealer_linkage: dealerLinks,
    database_writes_requested: options.mode !== 'audit',
    lineage_schema_ready: process.env.UNBUNDLED_LINEAGE_SCHEMA_READY !== 'false',
    brands: final.map(entry => ({
      brand: entry.file.brand,
      filename: entry.file.filename,
      workbook_sha256: entry.file.sha256,
      overlap_held: entry.file.overlapHeld,
      source_rows: entry.plan.workbook.sourceRows.length,
      expected_unique_candidates: entry.plan.rows.length,
      expected_wts: entry.plan.rows.filter(row => row.listing_type === 'WTS').length,
      expected_wtb: entry.plan.rows.filter(row => row.listing_type === 'WTB').length,
      expected_price_research: entry.plan.rows.filter(row => (
        row.listing_type === 'WTS' && row.price_evidence_status === 'SOURCE_EXPLICIT_USD_MATCH'
      )).length,
      exact_reference: entry.plan.rows.filter(row => row.normalized_reference).length,
      verified_model: entry.plan.rows.filter(row => row.model).length,
      verified_dial: entry.plan.rows.filter(row => row.dial_color).length,
      duplicate_candidates_excluded: entry.plan.duplicateExcluded.length,
      reconciliation: sanitizedReconciliation(entry.live),
    })),
  };
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    mode: report.mode,
    workbook_count: report.workbook_count,
    global_canary_rows_applied: report.global_canary_rows_applied,
    output: options.output,
  })}\n`);
  return report;
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({ status: 'error', error: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  applyGlobalCanary,
  fieldHistogram,
  parseArgs,
  run,
  selectGlobalCanaryRows,
  sanitizedReconciliation,
};

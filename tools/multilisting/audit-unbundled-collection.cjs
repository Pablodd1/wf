'use strict';

const fs = require('node:fs');
const path = require('node:path');
const csv = require('csv-parser');

const FILE_PATTERN = /^unbundle_(\d+)_(listings|mapping|raw_messages)_batch_(\d{3})\.csv$/i;

function text(value) {
  return String(value ?? '').trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function atomicJson(filePath, value) {
  const temporary = `${filePath}.partial`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
}

function discoverBatches(inputDir) {
  const batches = new Map();
  for (const entry of fs.readdirSync(inputDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const match = entry.name.match(FILE_PATTERN);
    if (!match) continue;
    const [, exportPart, kind, batchNumber] = match;
    const key = `${exportPart}:${batchNumber}`;
    const batch = batches.get(key) || { key, exportPart: Number(exportPart), batchNumber, files: {} };
    batch.files[kind] = path.join(inputDir, entry.name);
    batches.set(key, batch);
  }
  return [...batches.values()].sort((left, right) => Number(left.batchNumber) - Number(right.batchNumber));
}

function auditPath(listingsPath, suffix) {
  return path.join(
    path.dirname(listingsPath),
    `${path.basename(listingsPath, path.extname(listingsPath))}_${suffix}.json`,
  );
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function inspectParents(filePath, parentIds, duplicateExamples) {
  let rows = 0;
  let declaredChildren = 0;
  let missingIds = 0;
  let invalidCandidateCounts = 0;

  await new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', row => {
        rows += 1;
        const sourceId = text(row.source_record_id);
        const candidateCount = number(row.candidate_count);
        if (!sourceId) missingIds += 1;
        else if (parentIds.has(sourceId)) {
          if (duplicateExamples.length < 25) duplicateExamples.push(sourceId);
        } else parentIds.add(sourceId);
        if (!Number.isInteger(candidateCount) || candidateCount < 0) invalidCandidateCounts += 1;
        else declaredChildren += candidateCount;
      })
      .on('end', resolve)
      .on('error', reject);
  });

  return { rows, declaredChildren, missingIds, invalidCandidateCounts };
}

async function auditCollection(inputDir) {
  const batches = discoverBatches(inputDir);
  const parentIds = new Set();
  const duplicateParentExamples = [];
  const result = {
    generatedAt: new Date().toISOString(),
    inputDir: path.resolve(inputDir),
    batchCount: batches.length,
    batches: [],
    totals: {
      listingRows: 0,
      mappingRows: 0,
      parentRows: 0,
      declaredChildren: 0,
      uniqueParentIds: 0,
      exactRawLineage: 0,
      parentIntentConflicts: 0,
      parentIntentUnusable: 0,
      missingBrand: 0,
      sellerNameCoverage: 0,
      sellerPhoneCoverage: 0,
      imageCoverage: 0,
    },
    issues: [],
    duplicateParentExamples,
    productionWrites: 0,
  };

  for (const batch of batches) {
    const missingKinds = ['listings', 'mapping', 'raw_messages'].filter(kind => !batch.files[kind]);
    if (missingKinds.length) {
      result.issues.push(`batch_${batch.batchNumber}_missing:${missingKinds.join(',')}`);
      result.batches.push({ ...batch, missingKinds });
      continue;
    }

    const intakePath = auditPath(batch.files.listings, 'intake_audit');
    const lineagePath = auditPath(batch.files.listings, 'lineage_audit');
    if (!fs.existsSync(intakePath) || !fs.existsSync(lineagePath)) {
      result.issues.push(`batch_${batch.batchNumber}_audit_missing`);
      result.batches.push({ ...batch, intakePath, lineagePath, auditsPresent: false });
      continue;
    }

    const intake = readJson(intakePath);
    const lineage = readJson(lineagePath);
    const parents = await inspectParents(batch.files.raw_messages, parentIds, duplicateParentExamples);
    const batchIssues = [];
    if (intake.rowsScanned !== lineage.listingRows) batchIssues.push('listing_audit_count_mismatch');
    if (lineage.listingRows !== lineage.mappingRows) batchIssues.push('mapping_count_mismatch');
    if (parents.rows !== lineage.parentRows) batchIssues.push('parent_count_mismatch');
    if (parents.declaredChildren !== lineage.listingRows) batchIssues.push('declared_child_count_mismatch');
    if (lineage.goNoGo?.decision !== 'LINEAGE_GATE_PASSED') batchIssues.push('lineage_gate_failed');
    if (parents.missingIds) batchIssues.push('parent_ids_missing');
    if (parents.invalidCandidateCounts) batchIssues.push('candidate_counts_invalid');

    result.batches.push({
      batch: batch.batchNumber,
      exportPart: batch.exportPart,
      files: Object.fromEntries(Object.entries(batch.files).map(([kind, filePath]) => [kind, {
        path: path.resolve(filePath), bytes: fs.statSync(filePath).size,
      }])),
      listingRows: lineage.listingRows,
      mappingRows: lineage.mappingRows,
      parentRows: lineage.parentRows,
      declaredChildren: parents.declaredChildren,
      exactRawLineage: lineage.exactRawLineage,
      parentIntentAgreement: lineage.rates?.parentIntentAgreement ?? null,
      sourceDateAgreement: lineage.rates?.sourceDateAgreement ?? null,
      parentIntentConflicts: number(lineage.issues?.parent_intent_conflict),
      parentIntentUnusable: number(lineage.issues?.parent_intent_unusable),
      missingBrand: number(intake.issues?.missing_brand),
      sellerNameCoverage: number(intake.coverage?.sellerName),
      sellerPhoneCoverage: number(intake.coverage?.sellerPhone),
      imageCoverage: number(intake.coverage?.imageUrl),
      intakeDecision: intake.goNoGo?.decision || null,
      lineageDecision: lineage.goNoGo?.decision || null,
      issues: batchIssues,
    });

    result.totals.listingRows += lineage.listingRows;
    result.totals.mappingRows += lineage.mappingRows;
    result.totals.parentRows += lineage.parentRows;
    result.totals.declaredChildren += parents.declaredChildren;
    result.totals.exactRawLineage += lineage.exactRawLineage;
    result.totals.parentIntentConflicts += number(lineage.issues?.parent_intent_conflict);
    result.totals.parentIntentUnusable += number(lineage.issues?.parent_intent_unusable);
    result.totals.missingBrand += number(intake.issues?.missing_brand);
    result.totals.sellerNameCoverage += number(intake.coverage?.sellerName);
    result.totals.sellerPhoneCoverage += number(intake.coverage?.sellerPhone);
    result.totals.imageCoverage += number(intake.coverage?.imageUrl);
  }

  result.totals.uniqueParentIds = parentIds.size;
  if (duplicateParentExamples.length) result.issues.push('cross_batch_duplicate_parent_ids');
  if (result.totals.uniqueParentIds !== result.totals.parentRows) result.issues.push('global_parent_count_mismatch');
  if (result.totals.declaredChildren !== result.totals.listingRows) result.issues.push('global_declared_child_count_mismatch');
  if (result.totals.mappingRows !== result.totals.listingRows) result.issues.push('global_mapping_count_mismatch');
  if (result.totals.exactRawLineage !== result.totals.listingRows) result.issues.push('global_raw_lineage_mismatch');

  result.decision = result.batchCount === 16 && result.issues.length === 0
    ? 'COLLECTION_LINEAGE_GATE_PASSED'
    : 'HOLD_FOR_COLLECTION_CORRECTION';
  result.nextGate = 'BOUNDED_NORMALIZATION_AND_HUMAN_REVIEW';
  return result;
}

async function main() {
  const inputDir = path.resolve(process.env.UNBUNDLED_COLLECTION_DIR || process.argv[2] || 'audit-output/unbundled');
  const outputPath = path.resolve(process.env.UNBUNDLED_COLLECTION_AUDIT
    || path.join(inputDir, 'unbundled-collection-audit.json'));
  const report = await auditCollection(inputDir);
  atomicJson(outputPath, report);
  process.stdout.write(`${JSON.stringify({
    event: 'unbundled_collection_audit_complete',
    outputPath,
    decision: report.decision,
    batchCount: report.batchCount,
    totals: report.totals,
    issues: report.issues,
  }, null, 2)}\n`);
  if (report.decision !== 'COLLECTION_LINEAGE_GATE_PASSED') process.exitCode = 1;
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'unbundled_collection_audit_error', error: error.message })}\n`);
  process.exitCode = 1;
});

module.exports = { auditCollection, discoverBatches, inspectParents };

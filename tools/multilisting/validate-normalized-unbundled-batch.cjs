'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const EXPECTED_BUCKETS = new Set([
  'review-ready', 'human-correction', 'held-lineage', 'held-non-watch',
  'held-price-currency', 'held-catalog', 'held-multi-watch',
]);

function atomicJson(filePath, value) {
  const temporary = `${filePath}.partial`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
}

async function validate(outputDir, expectedRows = null) {
  const reportPath = path.join(outputDir, 'report.json');
  if (!fs.existsSync(reportPath)) throw new Error(`Missing report: ${reportPath}`);
  const normalizationReport = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const ids = new Set();
  const result = {
    generatedAt: new Date().toISOString(),
    outputDir: path.resolve(outputDir),
    expectedRows: expectedRows ?? normalizationReport.processedRows,
    rowsRead: 0,
    duplicateListingIds: 0,
    missingListingIds: 0,
    invalidBuckets: 0,
    lineageFailuresOutsideHold: 0,
    productionApprovedRows: 0,
    reviewReadyWtsWithoutPrice: 0,
    reviewReadyWtsWithoutCurrency: 0,
    reviewReadyCatalogFailures: 0,
    fileRowsMatchReport: false,
    rowCountMatchesExpected: false,
    passed: false,
  };

  for (const file of normalizationReport.files || []) {
    if (!EXPECTED_BUCKETS.has(file.bucket)) result.invalidBuckets += file.rows || 1;
    const input = readline.createInterface({ input: fs.createReadStream(file.path), crlfDelay: Infinity });
    let fileRows = 0;
    for await (const line of input) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      fileRows += 1;
      result.rowsRead += 1;
      if (!row.listing_id) result.missingListingIds += 1;
      else if (ids.has(row.listing_id)) result.duplicateListingIds += 1;
      else ids.add(row.listing_id);
      if (row.production_approved) result.productionApprovedRows += 1;
      if (!row.exact_raw_lineage && row.review_bucket !== 'held-lineage') result.lineageFailuresOutsideHold += 1;
      if (row.review_bucket === 'review-ready') {
        if (!row.catalog_confirmed) result.reviewReadyCatalogFailures += 1;
        if (row.listing_type === 'WTS' && !row.price_raw) result.reviewReadyWtsWithoutPrice += 1;
        if (row.listing_type === 'WTS' && !row.price_currency) result.reviewReadyWtsWithoutCurrency += 1;
      }
    }
    if (fileRows !== file.rows) result.invalidBuckets += Math.abs(fileRows - file.rows);
  }

  result.fileRowsMatchReport = result.rowsRead === normalizationReport.processedRows;
  result.rowCountMatchesExpected = result.rowsRead === result.expectedRows;
  result.passed = result.fileRowsMatchReport
    && result.rowCountMatchesExpected
    && result.duplicateListingIds === 0
    && result.missingListingIds === 0
    && result.invalidBuckets === 0
    && result.lineageFailuresOutsideHold === 0
    && result.productionApprovedRows === 0
    && result.reviewReadyWtsWithoutPrice === 0
    && result.reviewReadyWtsWithoutCurrency === 0
    && result.reviewReadyCatalogFailures === 0;
  atomicJson(path.join(outputDir, 'validation.json'), result);
  return result;
}

async function main() {
  const outputDir = path.resolve(process.env.UNBUNDLED_NORMALIZED_OUTPUT || process.argv[2] || 'audit-output/unbundled/batch-002-normalized');
  const expectedRows = process.env.UNBUNDLED_EXPECTED_ROWS ? Number(process.env.UNBUNDLED_EXPECTED_ROWS) : null;
  const result = await validate(outputDir, expectedRows);
  process.stdout.write(`${JSON.stringify({ event: 'unbundled_normalization_validation', ...result }, null, 2)}\n`);
  if (!result.passed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ event: 'unbundled_normalization_validation_error', error: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { validate };

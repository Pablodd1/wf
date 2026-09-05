'use strict';

const fs = require('node:fs');
const path = require('node:path');
const csv = require('csv-parser');
const { analyzeRecord } = require('../shadow-reprocess/shadow-reprocess.cjs');
const { confirmCatalogCandidate } = require('../shadow-reprocess/catalog-confirmation.cjs');
const { adjacentDialClaim } = require('./bundle-cohort.cjs');
const { comparisonKey } = require('../../api/_lib/dial-normalization.cjs');
const { assessReferenceQuality } = require('../../api/_lib/reference-quality.cjs');

const REQUIRED_HEADERS = [
  'listing_id', 'source_record_id', 'candidate_index', 'brand', 'reference',
  'raw_line', 'listing_type', 'dial_color', 'source_created_at',
];
const EXAMPLE_LIMIT = 20;

function text(value) {
  return String(value ?? '').trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function comparable(value) {
  return text(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function sameText(left, right) {
  return comparable(left) === comparable(right);
}

function addExample(report, issue, row, detail = {}) {
  const examples = report.examples[issue] || [];
  if (examples.length >= EXAMPLE_LIMIT) return;
  examples.push({
    listingId: text(row.listing_id) || null,
    sourceRecordId: text(row.source_record_id) || null,
    candidateIndex: text(row.candidate_index) || null,
    rawLine: text(row.raw_line).slice(0, 500) || null,
    ...detail,
  });
  report.examples[issue] = examples;
}

function flag(report, issue, row, detail) {
  report.issues[issue] = (report.issues[issue] || 0) + 1;
  addExample(report, issue, row, detail);
}

function expectedListingId(row) {
  const index = Number.parseInt(text(row.candidate_index), 10);
  if (!text(row.source_record_id) || !Number.isInteger(index) || index < 0) return null;
  return `${text(row.source_record_id)}_${String(index).padStart(3, '0')}`;
}

function auditDetailedRow(row, report) {
  const exported = {
    id: text(row.listing_id),
    raw_message: text(row.raw_line),
    brand: text(row.brand) || null,
    reference: text(row.reference) || null,
    price_raw: number(row.price_raw),
    price_usd: number(row.price_usd),
    currency: text(row.price_currency) || null,
    listing_type: text(row.listing_type) || null,
    dial_color: text(row.dial_color) || null,
    parser_version: 'manual-unbundle-csv',
  };
  const analysis = analyzeRecord(exported);
  const referenceQuality = assessReferenceQuality({
    brand: exported.brand,
    reference: exported.reference,
    rawLine: exported.raw_message,
    priceRaw: exported.price_raw,
  });
  for (const reason of referenceQuality.reasons) {
    flag(report, `reference_${reason.toLowerCase()}`, row, {
      exported: exported.reference,
      proposed: referenceQuality.proposed_reference,
    });
  }
  const parsed = analysis.candidate_count === 1 ? analysis.proposed_candidates[0] : null;

  if (!parsed) {
    flag(report, analysis.candidate_count > 1 ? 'parser_multiple_candidates' : 'parser_no_candidate', row, {
      parserCandidateCount: analysis.candidate_count,
    });
    return;
  }

  if (!sameText(parsed.reference, exported.reference)) {
    flag(report, 'reference_conflict', row, { exported: exported.reference, parsed: parsed.reference });
  }
  if (parsed.brand && exported.brand && !sameText(parsed.brand, exported.brand)) {
    flag(report, 'brand_conflict', row, { exported: exported.brand, parsed: parsed.brand });
  }
  if (parsed.listing_type && exported.listing_type && !sameText(parsed.listing_type, exported.listing_type)) {
    flag(report, 'intent_conflict', row, { exported: exported.listing_type, parsed: parsed.listing_type });
  }
  if (parsed.condition && text(row.condition) && !sameText(parsed.condition, row.condition)) {
    flag(report, 'condition_conflict', row, { exported: text(row.condition), parsed: parsed.condition });
  }
  if (parsed.price_raw && exported.price_raw && Math.abs(parsed.price_raw - exported.price_raw) > 1) {
    flag(report, 'price_original_conflict', row, { exported: exported.price_raw, parsed: parsed.price_raw });
  }
  if (parsed.currency && exported.currency && !sameText(parsed.currency, exported.currency)) {
    flag(report, 'currency_conflict', row, { exported: exported.currency, parsed: parsed.currency });
  }
  if (parsed.price_usd && exported.price_usd && Math.abs(parsed.price_usd - exported.price_usd) > 2) {
    flag(report, 'price_usd_conflict', row, { exported: exported.price_usd, parsed: parsed.price_usd });
  }

  const rawDial = adjacentDialClaim(exported.raw_message, exported.reference);
  if (rawDial && exported.dial_color && comparisonKey(rawDial) !== comparisonKey(exported.dial_color)) {
    flag(report, 'dial_raw_source_conflict', row, { exported: exported.dial_color, rawClaim: rawDial });
  }
  if (parsed.dial_color && exported.dial_color
    && comparisonKey(parsed.dial_color) !== comparisonKey(exported.dial_color)) {
    flag(report, 'dial_parser_conflict', row, {
      exported: exported.dial_color,
      parsed: parsed.dial_color,
      evidence: parsed.dial_evidence,
    });
  }

  const catalog = confirmCatalogCandidate({
    brand: exported.brand,
    reference: exported.reference,
    dial_color: rawDial || exported.dial_color,
  });
  if (!catalog.confirmed) {
    flag(report, 'catalog_identity_unconfirmed', row, { reason: catalog.reason });
  } else {
    report.coverage.catalogConfirmed += 1;
    if ((rawDial || exported.dial_color) && catalog.dialConfirmed !== true) {
      flag(report, 'catalog_dial_unconfirmed', row, {
        proposed: rawDial || exported.dial_color,
        catalogDials: catalog.match?.dialColors || [],
        reason: catalog.dialReason,
      });
    } else {
      report.coverage.catalogDialConfirmed += 1;
    }
  }
}

function auditRow(row, report, detailedLimit) {
  report.rowsScanned += 1;
  const expectedId = expectedListingId(row);
  if (!expectedId || text(row.listing_id) !== expectedId) {
    flag(report, 'unstable_listing_id', row, { expected: expectedId, actual: text(row.listing_id) || null });
  }

  const listingId = text(row.listing_id);
  if (listingId) {
    if (report._listingIds.has(listingId)) flag(report, 'duplicate_listing_id', row);
    else report._listingIds.add(listingId);
  }
  const childKey = `${text(row.source_record_id)}|${text(row.candidate_index)}`;
  if (report._childKeys.has(childKey)) flag(report, 'duplicate_source_candidate_key', row);
  else report._childKeys.add(childKey);

  for (const field of ['source_record_id', 'candidate_index', 'raw_line', 'brand', 'reference', 'listing_type']) {
    if (!text(row[field])) flag(report, `missing_${field}`, row);
  }
  if (text(row.raw_line) && comparable(row.reference)
    && !comparable(row.raw_line).includes(comparable(row.reference))) {
    flag(report, 'raw_line_reference_missing', row, { reference: text(row.reference) });
  }

  if (text(row.seller_name)) report.coverage.sellerName += 1;
  if (text(row.seller_phone)) report.coverage.sellerPhone += 1;
  if (text(row.dealer)) report.coverage.dealer += 1;
  if (text(row.source_created_at)) report.coverage.sourceCreatedAt += 1;
  if (text(row.image_url)) report.coverage.imageUrl += 1;
  if (text(row.raw_line)) report.coverage.rawLine += 1;

  if (report.detailedRowsScanned < detailedLimit) {
    auditDetailedRow(row, report);
    report.detailedRowsScanned += 1;
  }
}

async function runCsvAudit(inputPath, options = {}) {
  const detailedLimit = Math.max(1, Number(options.detailedLimit || 1000));
  const report = {
    generatedAt: new Date().toISOString(),
    inputPath: path.resolve(inputPath),
    bytes: fs.statSync(inputPath).size,
    rowsScanned: 0,
    detailedRowsScanned: 0,
    headers: [],
    missingHeaders: [],
    contractWarnings: [],
    issues: {},
    examples: {},
    coverage: {
      rawLine: 0,
      sourceCreatedAt: 0,
      sellerName: 0,
      sellerPhone: 0,
      dealer: 0,
      imageUrl: 0,
      catalogConfirmed: 0,
      catalogDialConfirmed: 0,
    },
    _listingIds: new Set(),
    _childKeys: new Set(),
  };

  await new Promise((resolve, reject) => {
    fs.createReadStream(inputPath)
      .pipe(csv())
      .on('headers', headers => {
        report.headers = headers;
        report.missingHeaders = REQUIRED_HEADERS.filter(header => !headers.includes(header));
        if (headers.includes('candidate_index') && !headers.includes('child_index')) {
          report.contractWarnings.push('candidate_index is accepted as a legacy alias, but child_index is the reimport contract name.');
        }
      })
      .on('data', row => auditRow(row, report, detailedLimit))
      .on('end', resolve)
      .on('error', reject);
  });

  report.uniqueListingIds = report._listingIds.size;
  report.uniqueChildKeys = report._childKeys.size;
  delete report._listingIds;
  delete report._childKeys;
  report.goNoGo = {
    decision: report.missingHeaders.length === 0
      && !report.issues.duplicate_listing_id
      && !report.issues.duplicate_source_candidate_key
      && !report.issues.dial_raw_source_conflict
      && !report.issues.reference_conflict
      ? 'PROCEED_TO_PARENT_RECONCILIATION'
      : 'HOLD_FOR_CORRECTION',
    productionWritesAllowed: false,
    reasons: Object.entries(report.issues)
      .filter(([, count]) => count > 0)
      .map(([issue, count]) => `${issue}:${count}`),
  };
  return report;
}

async function main() {
  const inputPath = process.env.UNBUNDLED_CSV_PATH || process.argv[2];
  if (!inputPath) throw new Error('Provide UNBUNDLED_CSV_PATH or the CSV path as the first argument.');
  const outputPath = path.resolve(process.env.UNBUNDLED_AUDIT_OUTPUT
    || path.join(path.dirname(inputPath), `${path.basename(inputPath, path.extname(inputPath))}_intake_audit.json`));
  const report = await runCsvAudit(inputPath, {
    detailedLimit: process.env.UNBUNDLED_CANARY_ROWS || 1000,
  });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    event: 'unbundled_csv_audit_complete',
    inputPath: report.inputPath,
    outputPath,
    rowsScanned: report.rowsScanned,
    detailedRowsScanned: report.detailedRowsScanned,
    decision: report.goNoGo.decision,
    issues: report.issues,
  }));
}

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({ event: 'unbundled_csv_audit_error', error: error.message }));
    process.exitCode = 1;
  });
}

module.exports = { auditDetailedRow, auditRow, expectedListingId, runCsvAudit };

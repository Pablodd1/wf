'use strict';

const fs = require('node:fs');
const path = require('node:path');
const csv = require('csv-parser');

const SCHEMAS = {
  price: [
    'source_record_id', 'reference', 'raw_evidence_line', 'stored_price_usd',
    'proposed_price_usd', 'source_currency_status', 'recommendation', 'reason',
    'confidence', 'needs_human_review',
  ],
  watches: [
    'source_record_id', 'parent_source_id', 'raw_child_line', 'brand_raw',
    'brand_normalized', 'reference_raw', 'reference_normalized', 'model_normalized',
    'dial_raw', 'dial_normalized', 'condition_raw', 'condition_normalized',
    'price_raw', 'currency_raw', 'price_normalized', 'currency_normalized',
    'price_usd', 'intent', 'seller_name', 'seller_phone', 'original_posted_at',
    'catalog_status', 'bundle_status', 'duplicate_status', 'currency_status',
    'image_status', 'price_research_eligible', 'recommendation', 'review_reasons',
    'confidence', 'batch_id',
  ],
  images: [
    'source_record_id', 'source_message_id', 'image_key', 'public_url',
    'match_basis', 'url_reachable', 'recommendation', 'reason', 'batch_id',
  ],
  errors: [
    'source_record_id', 'batch_id', 'error_stage', 'error_type',
    'error_message', 'raw_value', 'retryable',
  ],
};

const ALLOWED = {
  recommendation: new Set(['KEEP', 'APPLY_CANDIDATE', 'SPLIT_REQUIRED', 'DUPLICATE_REVIEW', 'HUMAN_REVIEW', 'REJECT_CANDIDATE', 'DEFER_AMBIGUOUS']),
  priceRecommendation: new Set(['APPLY_CANDIDATE', 'REJECT_CANDIDATE', 'DEFER_AMBIGUOUS']),
  imageRecommendation: new Set(['SAFE_CANDIDATE', 'REJECT', 'DEFER']),
  currency: new Set(['VERIFIED', 'CURRENCY_UNVERIFIED', 'CURRENCY_AMBIGUOUS', 'CURRENCY_RATE_UNVERIFIED', 'PRICE_PARSE_FAILED']),
  catalog: new Set(['EXACT_MATCH', 'CONFIGURATION_CONFLICT', 'MULTIPLE_CANDIDATES', 'NOT_FOUND', 'UNVERIFIED']),
  bundle: new Set(['SINGLE_LISTING', 'SPLIT_REQUIRED', 'CHILD_LISTING', 'PARENT_ENVELOPE', 'UNVERIFIED']),
};

// Dealer messages commonly attach the ISO marker to the amount (for example, hkd57k).
// Accept that explicit syntax while continuing to reject a bare "$".
const explicitCurrency = /(?:\b(?:USD|USDT|HKD|HDK)\b|(?:USD|USDT|HKD|HDK)(?=\s*[$\d])|(?<=[\dKkMm])(?:USD|USDT|HKD|HDK)(?![A-Za-z])|US\$|U\$|HK\$|港币)/iu;
const truthy = value => /^(?:true|1|yes)$/i.test(String(value || '').trim());
const value = (row, key) => String(row[key] || '').trim();

function detectSchema(headers) {
  const available = new Set(headers);
  return Object.entries(SCHEMAS).find(([, required]) => required.every(column => available.has(column)))?.[0] || null;
}

function issue(issues, rowNumber, code) {
  issues.set(code, (issues.get(code) || 0) + 1);
  if (issues.samples.length < 100) issues.samples.push({ row: rowNumber, code });
}

function validatePrice(row, rowNumber, issues) {
  const recommendation = value(row, 'recommendation');
  if (!ALLOWED.priceRecommendation.has(recommendation)) issue(issues, rowNumber, 'INVALID_RECOMMENDATION');
  if (recommendation === 'APPLY_CANDIDATE') {
    if (value(row, 'source_currency_status') !== 'VERIFIED') issue(issues, rowNumber, 'APPLY_WITHOUT_VERIFIED_CURRENCY');
    if (!explicitCurrency.test(value(row, 'raw_evidence_line'))) issue(issues, rowNumber, 'APPLY_WITHOUT_EXPLICIT_CURRENCY_EVIDENCE');
    if (!(Number(value(row, 'proposed_price_usd')) > 0)) issue(issues, rowNumber, 'APPLY_WITHOUT_POSITIVE_PRICE');
  }
}

function validateWatch(row, rowNumber, issues) {
  const recommendation = value(row, 'recommendation');
  const currency = value(row, 'currency_status');
  const catalog = value(row, 'catalog_status');
  const bundle = value(row, 'bundle_status');
  if (!ALLOWED.recommendation.has(recommendation)) issue(issues, rowNumber, 'INVALID_RECOMMENDATION');
  if (!ALLOWED.currency.has(currency)) issue(issues, rowNumber, 'INVALID_CURRENCY_STATUS');
  if (!ALLOWED.catalog.has(catalog)) issue(issues, rowNumber, 'INVALID_CATALOG_STATUS');
  if (!ALLOWED.bundle.has(bundle)) issue(issues, rowNumber, 'INVALID_BUNDLE_STATUS');

  if (recommendation === 'APPLY_CANDIDATE') {
    if (currency !== 'VERIFIED') issue(issues, rowNumber, 'APPLY_WITHOUT_VERIFIED_CURRENCY');
    if (!explicitCurrency.test(`${value(row, 'currency_raw')} ${value(row, 'raw_child_line')}`)) issue(issues, rowNumber, 'APPLY_WITHOUT_EXPLICIT_CURRENCY_EVIDENCE');
    if (bundle === 'PARENT_ENVELOPE' || bundle === 'SPLIT_REQUIRED' || bundle === 'UNVERIFIED') issue(issues, rowNumber, 'APPLY_FROM_UNRESOLVED_BUNDLE');
  }

  if (truthy(row.price_research_eligible)) {
    if (value(row, 'intent') !== 'WTS') issue(issues, rowNumber, 'PRICE_RESEARCH_NON_WTS');
    if (currency !== 'VERIFIED') issue(issues, rowNumber, 'PRICE_RESEARCH_UNVERIFIED_CURRENCY');
    if (catalog !== 'EXACT_MATCH') issue(issues, rowNumber, 'PRICE_RESEARCH_UNVERIFIED_CATALOG');
    if (!['SINGLE_LISTING', 'CHILD_LISTING'].includes(bundle)) issue(issues, rowNumber, 'PRICE_RESEARCH_UNRESOLVED_BUNDLE');
    if (!(Number(value(row, 'price_usd')) > 0)) issue(issues, rowNumber, 'PRICE_RESEARCH_INVALID_PRICE');
  }
}

function validateImage(row, rowNumber, issues) {
  const recommendation = value(row, 'recommendation');
  if (!ALLOWED.imageRecommendation.has(recommendation)) issue(issues, rowNumber, 'INVALID_IMAGE_RECOMMENDATION');
  if (recommendation === 'SAFE_CANDIDATE') {
    if (!value(row, 'source_record_id') || !value(row, 'source_message_id')) issue(issues, rowNumber, 'SAFE_IMAGE_MISSING_LINEAGE_ID');
    if (!truthy(row.url_reachable)) issue(issues, rowNumber, 'SAFE_IMAGE_NOT_REACHABLE');
    if (!/^https:\/\//i.test(value(row, 'public_url'))) issue(issues, rowNumber, 'SAFE_IMAGE_INVALID_URL');
    if (!/exact|source|lineage|database[_ -]?id/i.test(value(row, 'match_basis'))) issue(issues, rowNumber, 'SAFE_IMAGE_WEAK_MATCH_BASIS');
  }
}

async function validate(filePath, options = {}) {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) throw new Error(`Input CSV not found: ${absolute}`);

  let schema = null;
  let rowCount = 0;
  const seen = new Set();
  const duplicateKeys = new Set();
  const counts = {};
  const issues = new Map();
  issues.samples = [];

  await new Promise((resolve, reject) => {
    fs.createReadStream(absolute)
      .pipe(csv({ strict: true }))
      .on('headers', headers => {
        schema = detectSchema(headers);
        if (!schema) reject(new Error(`Unsupported CSV schema. Headers: ${headers.join(',')}`));
      })
      .on('data', row => {
        rowCount += 1;
        if (!value(row, 'source_record_id')) issue(issues, rowCount, 'MISSING_SOURCE_RECORD_ID');
        const key = schema === 'images'
          ? `${value(row, 'source_record_id')}|${value(row, 'image_key')}`
          : `${value(row, 'source_record_id')}|${value(row, 'parent_source_id')}|${value(row, 'raw_child_line') || value(row, 'raw_evidence_line')}`;
        if (seen.has(key)) duplicateKeys.add(key);
        else seen.add(key);

        const recommendation = value(row, 'recommendation') || 'ERROR_ROW';
        counts[recommendation] = (counts[recommendation] || 0) + 1;
        if (schema === 'price') validatePrice(row, rowCount, issues);
        if (schema === 'watches') validateWatch(row, rowCount, issues);
        if (schema === 'images') validateImage(row, rowCount, issues);
      })
      .on('error', reject)
      .on('end', resolve);
  });

  if (options.expectedRows != null && rowCount !== options.expectedRows) {
    issue(issues, 0, 'EXPECTED_ROW_COUNT_MISMATCH');
  }
  if (duplicateKeys.size) issues.set('DUPLICATE_RECORD_KEYS', duplicateKeys.size);

  const issueCounts = Object.fromEntries([...issues.entries()]);
  const result = {
    status: Object.keys(issueCounts).length ? 'blocked' : 'accepted_for_primary_review',
    file: absolute,
    schema,
    rows: rowCount,
    expectedRows: options.expectedRows ?? null,
    recommendationCounts: counts,
    duplicateRecordKeys: duplicateKeys.size,
    issueCounts,
    issueSamples: issues.samples,
    productionDataChanged: false,
  };

  if (options.reportPath) {
    fs.mkdirSync(path.dirname(options.reportPath), { recursive: true });
    fs.writeFileSync(options.reportPath, `${JSON.stringify(result, null, 2)}\n`);
  }
  return result;
}

async function main() {
  const input = process.env.EXTERNAL_AUDIT_INPUT || process.argv[2];
  if (!input) throw new Error('Provide EXTERNAL_AUDIT_INPUT or a CSV path argument');
  const expected = process.env.EXTERNAL_AUDIT_EXPECTED_ROWS;
  const reportPath = process.env.EXTERNAL_AUDIT_REPORT ? path.resolve(process.env.EXTERNAL_AUDIT_REPORT) : null;
  const result = await validate(input, {
    expectedRows: expected ? Number(expected) : null,
    reportPath,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== 'accepted_for_primary_review') process.exitCode = 2;
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ event: 'external_audit_validation_error', error: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { detectSchema, validate };

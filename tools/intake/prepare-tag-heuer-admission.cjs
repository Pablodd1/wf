'use strict';

// TAG Heuer workbook intake is intentionally review-only. It preserves the
// supplied source file and produces a non-PII admission manifest; it never
// writes to Supabase or a public release table.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

const SHEET_NAME = 'TAG Heuer Inventory';
const REQUIRED_HEADERS = [
  'Listing ID', 'Date / Time', 'Intent (WTS/WTB)', 'Category', 'Brand',
  'Model', 'Reference Number', 'Dial Color', 'Asking Price', 'Currency',
  'Price (USD)', 'Condition', 'Box', 'Papers', 'Dealer / Seller Name',
  'WhatsApp Contact', 'Region', 'Full Image URL (DigitalOcean CDN)',
  'Image Key', 'Duplicate Status (Original / Repost)', 'First Seen Listing ID',
  'Listing Type', 'Trading Floor Status', 'Price Research Status',
  'Raw Post / Chat Message',
];

const KNOWN_NON_TAG_MODELS = /\b(?:daytona|submariner|datejust|day-date|gmt\s*master|oyster\s*perpetual|speedmaster|seamaster|pelagos|ranger|royal\s*oak|nautilus|aquanaut|overseas|panth[eè]re|tank|luminor)\b/i;
const CURRENCY_SUFFIX = /(?:USD|USDT|HKD|EUR|GBP|JPY|CNY)$/i;

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeReference(value) {
  return text(value).toUpperCase().replace(/[\s-]+/g, '') || null;
}

function sourceImageUrl(value, imageKey) {
  const supplied = text(value);
  const key = text(imageKey);
  const legacyPrefix = 'https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/';
  if (supplied.startsWith(legacyPrefix) && !supplied.startsWith(`${legacyPrefix}full/`) && key) {
    return `${legacyPrefix}full/${encodeURIComponent(key)}`;
  }
  return supplied || null;
}

function invalidReference(value) {
  const normalized = normalizeReference(value);
  return !normalized || /^UNSPECIFIED$/i.test(normalized) || CURRENCY_SUFFIX.test(normalized);
}

function classifyRow(source) {
  const category = text(source.Category).toUpperCase();
  const tradingStatus = text(source['Trading Floor Status']).toLowerCase();
  const rawReference = text(source['Reference Number']);
  const model = text(source.Model);
  const reasons = [];

  if (category !== 'WATCH') reasons.push('NON_WATCH_ROUTE_LUXURY_RESEARCH');
  if (tradingStatus === 'bundle_pending_separation') reasons.push('BUNDLE_PENDING_SEPARATION');
  if (invalidReference(rawReference)) reasons.push('REFERENCE_UNRESOLVED_OR_PRICE_TOKEN');
  if (KNOWN_NON_TAG_MODELS.test(model)) reasons.push('MODEL_BRAND_CONFLICT');
  if (!text(source['Raw Post / Chat Message'])) reasons.push('RAW_EVIDENCE_MISSING');
  if (!text(source['Listing ID'])) reasons.push('SOURCE_ID_MISSING');

  const rawImage = text(source['Full Image URL (DigitalOcean CDN)']);
  const imageUrl = sourceImageUrl(rawImage, source['Image Key']);
  if (!imageUrl) reasons.push('IMAGE_MISSING');
  else if (imageUrl !== rawImage) reasons.push('IMAGE_PATH_CORRECTED_AT_ADAPTER');

  const isWatchCandidate = category === 'WATCH'
    && tradingStatus !== 'bundle_pending_separation'
    && !invalidReference(rawReference)
    && !KNOWN_NON_TAG_MODELS.test(model);
  const intent = text(source['Intent (WTS/WTB)']).toUpperCase();
  const priceResearchStatus = text(source['Price Research Status']).toLowerCase();
  const priceCandidate = isWatchCandidate
    && intent === 'WTS'
    && priceResearchStatus === 'eligible';

  return {
    final_brand: isWatchCandidate ? 'TAG Heuer' : null,
    final_reference: isWatchCandidate ? normalizeReference(rawReference) : null,
    trading_floor_candidate: isWatchCandidate,
    price_research_candidate: priceCandidate,
    disposition: reasons.some(reason => !['IMAGE_PATH_CORRECTED_AT_ADAPTER'].includes(reason))
      ? 'HOLD_FOR_REVIEW'
      : 'REVIEW_REQUIRED',
    reasons,
    resolved_image_url: imageUrl,
  };
}

function readWorkbook(filePath) {
  const buffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = workbook.Sheets[SHEET_NAME];
  if (!sheet) throw new Error(`missing worksheet: ${SHEET_NAME}`);
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true })
    .filter(row => Object.values(row).some(value => text(value)));
  const headers = Object.keys(rows[0] || {});
  const missing = REQUIRED_HEADERS.filter(header => !headers.includes(header));
  if (missing.length) throw new Error(`missing TAG Heuer headers: ${missing.join(', ')}`);
  return { fileSha256: sha256(buffer), rows };
}

function decisionRow(source, rowNumber) {
  const decision = classifyRow(source);
  return {
    source_row_number: rowNumber,
    listing_id: text(source['Listing ID']) || null,
    source_brand: text(source.Brand) || null,
    source_model: text(source.Model) || null,
    source_reference: text(source['Reference Number']) || null,
    source_intent: text(source['Intent (WTS/WTB)']) || null,
    source_category: text(source.Category) || null,
    final_brand: decision.final_brand,
    final_reference: decision.final_reference,
    trading_floor_candidate: decision.trading_floor_candidate,
    price_research_candidate: decision.price_research_candidate,
    resolved_image_url: decision.resolved_image_url,
    disposition: decision.disposition,
    review_reasons: decision.reasons.join('|'),
  };
}

function csvCell(value) {
  const content = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(content) ? `"${content.replaceAll('"', '""')}"` : content;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith('--')) {
      options[argv[index].slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  if (!options.input) throw new Error('--input is required');
  return {
    input: path.resolve(options.input),
    outputDir: path.resolve(options['output-dir'] || path.join('audit-output', `tag-heuer-admission-${Date.now()}`)),
  };
}

function run() {
  const options = parseArgs(process.argv.slice(2));
  const input = readWorkbook(options.input);
  const decisions = input.rows.map((row, index) => decisionRow(row, index + 2));
  const counts = decisions.reduce((totals, row) => {
    totals[row.disposition] = (totals[row.disposition] || 0) + 1;
    if (row.trading_floor_candidate) totals.trading_floor_candidates += 1;
    if (row.price_research_candidate) totals.price_research_candidates += 1;
    for (const reason of row.review_reasons.split('|').filter(Boolean)) {
      totals[`reason:${reason}`] = (totals[`reason:${reason}`] || 0) + 1;
    }
    return totals;
  }, {
    trading_floor_candidates: 0,
    price_research_candidates: 0,
  });
  fs.mkdirSync(options.outputDir, { recursive: true });
  const headers = Object.keys(decisions[0] || {});
  const csv = [headers.join(','), ...decisions.map(row => headers.map(header => csvCell(row[header])).join(','))].join('\n');
  fs.writeFileSync(path.join(options.outputDir, 'tag-heuer-admission-decisions.csv'), `${csv}\n`);
  const manifest = {
    mode: 'LOCAL_REVIEW_ONLY',
    forbidden_targets: ['watch_records', 'staging.listings', 'public release views'],
    source_file: path.basename(options.input),
    source_sha256: input.fileSha256,
    input_rows: input.rows.length,
    decisions: counts,
    generated_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(options.outputDir, 'tag-heuer-admission-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: 'complete', output_dir: options.outputDir, manifest }, null, 2)}\n`);
}

if (require.main === module) {
  try { run(); } catch (error) { process.stderr.write(`${JSON.stringify({ status: 'error', error: error.message })}\n`); process.exitCode = 1; }
}

module.exports = {
  REQUIRED_HEADERS,
  classifyRow,
  decisionRow,
  invalidReference,
  normalizeReference,
  sourceImageUrl,
};

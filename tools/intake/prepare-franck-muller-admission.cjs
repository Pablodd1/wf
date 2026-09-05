'use strict';

// Franck Muller admission intake is intentionally review-only. It joins an
// immutable source sheet to the supplied decision ledger and produces a
// non-PII manifest. It never writes to QNSA, staging, or public release views.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

const SOURCE_SHEET = 'Trading Floor & Price Research';
const LEGACY_DECISION_SHEET = 'TAG Admission Decisions';
const SOURCE_HEADERS = [
  'listing_id', 'source_platform', 'source_group_id', 'source_message_id',
  'source_posted_at', 'ingested_at', 'raw_message', 'intent', 'category',
  'asking_price_raw', 'source_currency', 'normalized_price_usd', 'fx_source',
  'fx_rate_date', 'image_keys', 'image_urls_source', 'image_count_source',
  'duplicate_status_source', 'seller_source_id', 'seller_name_source',
];
const DECISION_HEADERS = [
  'listing_id', 'final_brand', 'final_model', 'final_reference', 'dial_normalized',
  'identity_status', 'bundle_status', 'image_status', 'duplicate_decision',
  'trading_floor_status', 'price_research_status', 'review_reason',
  'reviewed_by', 'reviewed_at',
];
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

function invalidReference(value) {
  const reference = normalizeReference(value);
  return !reference || /^UNSPECIFIED$/i.test(reference) || CURRENCY_SUFFIX.test(reference);
}

function admissionIntent(rawMessage, sourceIntent = '') {
  const raw = text(rawMessage);
  const supplied = text(sourceIntent).toUpperCase().replace(/[\s-]+/g, '_');
  const rawBuySide = /(?:\bWTB\b|\bNTQ\b|\bLTB\b|\bISO\b|\bLF\b|want\s+to\s+buy|looking\s+(?:for|to\s+buy)|\bneed(?:ed)?\b|seeking|wanted|\u6c42\u8d2d|\u6c42\u8cfc|\u6c42\u6536|\u6536\u8d2d|\u5bfb\u627e|\u5c0b\u627e|\u627e\u8868|\u627e\u8ca8)/i.test(raw);
  const rawSellSide = /(?:\bWTS\b|\bLTS\b|\bLQT\b|\bLTQ\b|\bFS\b|for\s+sale|want\s+to\s+sell|selling|\bavailable\b|stock\s+clearance|\bsale\b)/i.test(raw);
  // Intent is scoped to one already-separated child segment. The downstream
  // price extractor must still bind a positive amount to explicit USD/USDT;
  // this test only establishes that the same segment carries that evidence.
  const rawExplicitUsdPrice = /(?:\b(?:USD|USDT)\b|\bUS\s*\$|\bU\$)/i.test(raw) && /\d/.test(raw);
  const sourceBuySide = ['WTB', 'NTQ', 'LTB', 'ISO', 'LOOKING', 'NEED'].includes(supplied);
  const nonAskingPriceContext = /(?:\bMSRP\b|\bRRP\b|retail(?:\s+price)?|list\s+price|apprais(?:al|ed)|valu(?:ation|ed)|estimated\s+value)/i.test(raw);
  // Explicit buy-side language wins over a budget or a stray sale token. A
  // WTB with a price is demand, never inventory for sale.
  if (rawBuySide) return { intent: 'WTB', raw_buy_side: true, raw_sell_side: rawSellSide, basis: 'RAW_BUY_SIDE' };
  if (sourceBuySide) return { intent: 'WTB', raw_buy_side: false, raw_sell_side: rawSellSide, basis: 'SOURCE_BUY_INTENT' };
  if (rawSellSide) return { intent: 'WTS', raw_buy_side: false, raw_sell_side: true, basis: 'RAW_SELL_SIDE' };
  if (rawExplicitUsdPrice && !nonAskingPriceContext) {
    return {
      intent: 'WTS',
      raw_buy_side: false,
      raw_sell_side: true,
      basis: 'RAW_EXPLICIT_USD_PRICE',
    };
  }
  if (['WTS', 'LTS', 'LQT', 'LTQ', 'FS', 'FOR_SALE'].includes(supplied)) {
    return { intent: 'WTS', raw_buy_side: false, raw_sell_side: false, basis: 'SOURCE_INTENT' };
  }
  return { intent: 'OTHER', raw_buy_side: false, raw_sell_side: false, basis: 'UNRESOLVED' };
}

function requireHeaders(rows, headers, name) {
  const present = Object.keys(rows[0] || {});
  const missing = headers.filter(header => !present.includes(header));
  if (missing.length) throw new Error(`${name} is missing required headers: ${missing.join(', ')}`);
}

function readWorkbook(filePath) {
  const buffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sourceSheet = workbook.Sheets[SOURCE_SHEET];
  const decisionSheetName = workbook.SheetNames.find(name => name !== SOURCE_SHEET && /admission/i.test(name))
    || LEGACY_DECISION_SHEET;
  const decisionSheet = workbook.Sheets[decisionSheetName];
  if (!sourceSheet || !decisionSheet) {
    throw new Error(`admission workbook must contain both source and decision worksheets; found: ${workbook.SheetNames.join(', ') || '(none)'}`);
  }
  const sourceRows = XLSX.utils.sheet_to_json(sourceSheet, { defval: null, raw: true })
    .filter(row => Object.values(row).some(value => text(value)));
  const decisionRows = XLSX.utils.sheet_to_json(decisionSheet, { defval: null, raw: true })
    .filter(row => Object.values(row).some(value => text(value)));
  requireHeaders(sourceRows, SOURCE_HEADERS, SOURCE_SHEET);
  requireHeaders(decisionRows, DECISION_HEADERS, decisionSheetName);
  const decisions = new Map();
  for (const decision of decisionRows) {
    const listingId = text(decision.listing_id);
    if (!listingId || decisions.has(listingId)) throw new Error(`decision ledger has missing or duplicate listing_id: ${listingId || '(blank)'}`);
    decisions.set(listingId, decision);
  }
  return { fileSha256: sha256(buffer), sourceRows, decisions, decisionRows };
}

function classifyRow(source, decision, expectedBrand = 'Franck Muller') {
  const reasons = [];
  const finalBrand = text(decision.final_brand);
  const category = text(source.category).toUpperCase();
  const intentEvidence = admissionIntent(source.raw_message, source.intent);
  const reference = normalizeReference(decision.final_reference);
  const requestedPublish = text(decision.trading_floor_status).toUpperCase() === 'PUBLISH';

  if (finalBrand !== expectedBrand) reasons.push('BRAND_SCOPE_MISMATCH');
  if (category !== 'WATCH') reasons.push('NON_WATCH_ROUTE_LUXURY_RESEARCH');
  if (text(decision.identity_status) !== 'VERIFIED') reasons.push('IDENTITY_REVIEW_REQUIRED');
  if (text(decision.bundle_status) !== 'SINGLE_CANDIDATE') reasons.push('BUNDLE_PENDING_SEPARATION');
  if (text(decision.image_status) !== 'VERIFIED' || Number(source.image_count_source || 0) < 1) reasons.push('IMAGE_UNVERIFIED_OR_MISSING');
  if (text(decision.duplicate_decision) !== 'COUNT') reasons.push('REPOST_OR_DUPLICATE_EXCLUDED');
  if (invalidReference(decision.final_reference)) reasons.push('REFERENCE_UNRESOLVED_OR_PRICE_TOKEN');
  if (!text(decision.final_model) || !text(decision.dial_normalized)) reasons.push('MODEL_OR_DIAL_UNRESOLVED');
  if (!text(source.listing_id) || !text(source.source_message_id) || !text(source.raw_message)) reasons.push('IMMUTABLE_SOURCE_LINEAGE_MISSING');
  if (!text(source.source_posted_at)) reasons.push('SOURCE_POSTING_TIME_MISSING');
  if (!text(source.seller_source_id) || !text(source.seller_name_source)) reasons.push('SELLER_IDENTITY_MISSING');
  if (!requestedPublish) reasons.push('NOT_APPROVED_FOR_TRADING_FLOOR');

  const tradingFloorCandidate = reasons.length === 0;
  const priceResearchCandidate = Boolean(tradingFloorCandidate
    && intentEvidence.intent === 'WTS'
    && intentEvidence.raw_sell_side
    && text(decision.price_research_status).toUpperCase() === 'ELIGIBLE'
    && Number.isFinite(Number(source.normalized_price_usd))
    && Number(source.normalized_price_usd) > 0
    && text(source.source_currency)
    && text(source.fx_source)
    && text(source.fx_rate_date));

  if (tradingFloorCandidate && !priceResearchCandidate && text(decision.price_research_status).toUpperCase() === 'ELIGIBLE') {
    if (intentEvidence.intent === 'WTB') reasons.push('WTB_DEMAND_EXCLUDED_FROM_WTS_ANALYTICS');
    else if (intentEvidence.intent === 'WTS' && !intentEvidence.raw_sell_side) reasons.push('RAW_SELL_SIDE_LANGUAGE_MISSING');
    else reasons.push('PRICE_RESEARCH_EVIDENCE_INCOMPLETE');
  }
  return {
    final_brand: tradingFloorCandidate ? finalBrand : null,
    final_reference: tradingFloorCandidate ? reference : null,
    trading_floor_candidate: tradingFloorCandidate,
    price_research_candidate: priceResearchCandidate,
    resolved_intent: intentEvidence.intent,
    intent_basis: intentEvidence.basis,
    disposition: tradingFloorCandidate ? 'REVIEW_REQUIRED' : 'HOLD_FOR_REVIEW',
    reasons,
  };
}

function decisionRow(source, decision, rowNumber, expectedBrand = 'Franck Muller') {
  const admission = classifyRow(source, decision || {}, expectedBrand);
  return {
    source_row_number: rowNumber,
    listing_id: text(source.listing_id) || null,
    source_message_id: text(source.source_message_id) || null,
    source_brand: text(source.source_brand_text) || null,
    final_brand: admission.final_brand,
    final_model: text(decision?.final_model) || null,
    dial_normalized: text(decision?.dial_normalized) || null,
    final_reference: admission.final_reference,
    source_intent: text(source.intent) || null,
    resolved_intent: admission.resolved_intent,
    intent_basis: admission.intent_basis,
    source_category: text(source.category) || null,
    requested_trading_floor_status: text(decision?.trading_floor_status) || null,
    identity_status: text(decision?.identity_status) || null,
    bundle_status: text(decision?.bundle_status) || null,
    trading_floor_candidate: admission.trading_floor_candidate,
    price_research_candidate: admission.price_research_candidate,
    disposition: admission.disposition,
    review_reasons: admission.reasons.join('|'),
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
    outputDir: path.resolve(options['output-dir'] || path.join('audit-output', `franck-muller-admission-${Date.now()}`)),
    brand: text(options.brand) || 'Franck Muller',
  };
}

function run() {
  const options = parseArgs(process.argv.slice(2));
  const input = readWorkbook(options.input);
  const rows = input.sourceRows.map((source, index) => decisionRow(
    source,
    input.decisions.get(text(source.listing_id)),
    index + 2,
    options.brand,
  ));
  const missingDecisionCount = rows.filter(row => !input.decisions.has(text(row.listing_id))).length;
  const extraDecisionCount = [...input.decisions.keys()].filter(id => !input.sourceRows.some(row => text(row.listing_id) === id)).length;
  const counts = rows.reduce((totals, row) => {
    totals[row.disposition] = (totals[row.disposition] || 0) + 1;
    if (row.trading_floor_candidate) totals.trading_floor_candidates += 1;
    if (row.price_research_candidate) totals.price_research_candidates += 1;
    for (const reason of row.review_reasons.split('|').filter(Boolean)) totals[`reason:${reason}`] = (totals[`reason:${reason}`] || 0) + 1;
    return totals;
  }, { trading_floor_candidates: 0, price_research_candidates: 0 });
  fs.mkdirSync(options.outputDir, { recursive: true });
  const headers = Object.keys(rows[0] || {});
  fs.writeFileSync(path.join(options.outputDir, 'franck-muller-admission-decisions.csv'), `${[headers.join(','), ...rows.map(row => headers.map(header => csvCell(row[header])).join(','))].join('\n')}\n`);
  const manifest = {
    mode: 'LOCAL_REVIEW_ONLY',
    forbidden_targets: ['watch_records', 'staging.listings', 'public release views'],
    source_file: path.basename(options.input),
    source_sha256: input.fileSha256,
    expected_brand: options.brand,
    input_rows: input.sourceRows.length,
    decision_rows: input.decisionRows.length,
    missing_decisions: missingDecisionCount,
    extra_decisions: extraDecisionCount,
    decisions: counts,
    generated_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(options.outputDir, 'franck-muller-admission-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: 'complete', output_dir: options.outputDir, manifest }, null, 2)}\n`);
}

if (require.main === module) {
  try { run(); } catch (error) { process.stderr.write(`${JSON.stringify({ status: 'error', error: error.message })}\n`); process.exitCode = 1; }
}

module.exports = {
  SOURCE_HEADERS,
  DECISION_HEADERS,
  admissionIntent,
  classifyRow,
  decisionRow,
  invalidReference,
  normalizeReference,
};

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const csv = require('csv-parser');
const { adjacentDialClaim, exactLineage, specialDialClaim } = require('./bundle-cohort.cjs');
const { confirmCatalogCandidate } = require('../shadow-reprocess/catalog-confirmation.cjs');
const { segmentDealerMessage } = require('../../api/_lib/normalization-v4.cjs');
const { comparisonKey } = require('../../api/_lib/dial-normalization.cjs');
const { assessReferenceQuality } = require('../../api/_lib/reference-quality.cjs');

const DEFAULT_LIMIT = 1000;
const VERSION = 'manual-unbundle-canary-v3';
const MAX_CATALOG_CACHE_SIZE = 20_000;
const MAX_PARENT_CACHE_SIZE = 1_000;
const catalogConfirmationCache = new Map();
const parentSegmentationCache = new Map();

function setBoundedCache(cache, key, value, maximumSize) {
  cache.set(key, value);
  if (cache.size > maximumSize) {
    cache.delete(cache.keys().next().value);
  }
}

function text(value) {
  return String(value ?? '').trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function materiallyDifferent(left, right, tolerance = 1) {
  const a = numeric(left);
  const b = numeric(right);
  if (a == null || b == null) return a !== b;
  return Math.abs(a - b) > Math.max(tolerance, Math.min(a, b) * 0.01);
}

function primaryParsedPrice(candidate) {
  const prices = Array.isArray(candidate?.prices) ? candidate.prices : [];
  return prices.find(price => price?.is_primary) || prices[0] || null;
}

function parsedChildCandidate(row, parent) {
  if (parent && typeof parent === 'object' && text(parent.raw_message)) {
    if (!parentSegmentationCache.has(parent)) {
      setBoundedCache(
        parentSegmentationCache,
        parent,
        segmentDealerMessage(text(parent.raw_message)),
        MAX_PARENT_CACHE_SIZE,
      );
    }
    const parentCandidates = parentSegmentationCache.get(parent);
    const childIndex = Number.parseInt(text(row.candidate_index), 10);
    const indexed = Number.isInteger(childIndex) ? parentCandidates[childIndex] : null;
    if (indexed && text(indexed.rawLine) === text(row.raw_line)) return indexed;
    const exactMatches = parentCandidates.filter(candidate => text(candidate.rawLine) === text(row.raw_line));
    if (exactMatches.length === 1) return exactMatches[0];
  }
  const childCandidates = segmentDealerMessage(text(row.raw_line));
  return childCandidates.length === 1 ? childCandidates[0] : null;
}

function cachedCatalogConfirmation(candidate) {
  const key = [candidate.brand, candidate.reference, candidate.dial_color]
    .map(value => upper(value))
    .join('|');
  if (!catalogConfirmationCache.has(key)) {
    setBoundedCache(
      catalogConfirmationCache,
      key,
      confirmCatalogCandidate(candidate),
      MAX_CATALOG_CACHE_SIZE,
    );
  }
  return catalogConfirmationCache.get(key);
}

function explicitChildIntent(rawLine) {
  const source = ` ${text(rawLine).toLowerCase()} `;
  const wtb = /(?:^|\s)(?:wtb|want(?:ed)?\s+to\s+buy|looking\s+for|seeking|buying)(?:\s|:|-|$)/i.test(source);
  const wts = /(?:^|\s)(?:wts|for\s+sale|available\s+for\s+sale|selling)(?:\s|:|-|$)/i.test(source);
  if (wtb && wts) return 'MIXED';
  if (wtb) return 'WTB';
  if (wts) return 'WTS';
  return null;
}

function resolveIntent(row, parent) {
  const parentIntent = upper(parent?.listing_type);
  const childExplicit = explicitChildIntent(row.raw_line);
  if (childExplicit === 'MIXED') {
    return { value: null, evidence: 'child_mixed', blocker: 'CHILD_INTENT_MIXED' };
  }
  if (childExplicit) {
    return { value: childExplicit, evidence: 'explicit_child_text', blocker: null };
  }
  if (parentIntent === 'WTB' || parentIntent === 'WTS') {
    return { value: parentIntent, evidence: 'inherited_parent_context', blocker: null };
  }
  return { value: null, evidence: 'unusable_parent_context', blocker: 'PARENT_INTENT_UNUSABLE' };
}

function buildCanaryRow(row, parent) {
  const blockers = [];
  const reviewReasons = [];
  const lineageConfirmed = Boolean(parent && exactLineage(parent.raw_message, row.raw_line));
  if (!lineageConfirmed) blockers.push(parent ? 'RAW_LINEAGE_MISSING' : 'PARENT_NOT_FOUND');

  const intent = resolveIntent(row, parent);
  if (intent.blocker) blockers.push(intent.blocker);
  if (intent.value && intent.value !== upper(row.listing_type)) reviewReasons.push('INTENT_CORRECTED_FROM_PARENT_CONTEXT');

  const parsedCandidate = parsedChildCandidate(row, parent);
  const parsedPrice = primaryParsedPrice(parsedCandidate);
  const referenceQuality = assessReferenceQuality({
    brand: row.brand,
    reference: row.reference,
    rawLine: row.raw_line,
    priceRaw: numeric(row.price_raw) || numeric(parsedPrice?.amount_original),
  });
  const selectedReference = referenceQuality.proposed_reference || text(row.reference) || null;
  for (const reason of referenceQuality.reasons) {
    if (reason === 'REFERENCE_CORRECTION_AVAILABLE') reviewReasons.push(reason);
    else blockers.push(reason);
  }

  const explicitDial = adjacentDialClaim(row.raw_line, selectedReference) || specialDialClaim(row.raw_line);
  const exportedDial = text(row.dial_color) || null;
  const selectedDial = explicitDial || exportedDial;
  if (explicitDial && exportedDial && comparisonKey(explicitDial) !== comparisonKey(exportedDial)) {
    reviewReasons.push('DIAL_RAW_SOURCE_CONFLICT');
  }

  const catalog = cachedCatalogConfirmation({
    brand: text(row.brand) || null,
    reference: selectedReference,
    dial_color: selectedDial,
  });
  if (!catalog.confirmed) blockers.push(catalog.reason || 'CATALOG_NOT_CONFIRMED');
  if (selectedDial && catalog.confirmed && catalog.dialConfirmed !== true) {
    blockers.push(catalog.dialReason || 'CATALOG_DIAL_UNCONFIRMED');
  }

  const exportedPriceRaw = numeric(row.price_raw);
  const exportedPriceUsd = numeric(row.price_usd);
  const exportedCurrency = upper(row.price_currency) || null;
  if (!parsedCandidate) {
    const childSegments = segmentDealerMessage(text(row.raw_line));
    blockers.push(childSegments.length > 1 ? 'PARSER_MULTIPLE_CANDIDATES' : 'PARSER_NO_CANDIDATE');
  }

  const parsedPriceRaw = numeric(parsedPrice?.amount_original);
  const parsedPriceUsd = numeric(parsedPrice?.amount_usd);
  const parsedCurrency = upper(parsedPrice?.currency_original) || null;
  const currencyEvidence = text(parsedPrice?.currency_evidence) || null;
  const isWts = intent.value === 'WTS';

  if (isWts && !parsedPriceRaw) blockers.push('PRICE_PARSE_FAILED');
  if (isWts && !parsedCurrency) blockers.push('CURRENCY_AMBIGUOUS');
  if (isWts && ['source_record', 'source_record_currency'].includes(currencyEvidence)) {
    blockers.push('CURRENCY_REVIEW_REQUIRED');
  }
  if (parsedPriceRaw != null && exportedPriceRaw != null && materiallyDifferent(parsedPriceRaw, exportedPriceRaw)) {
    reviewReasons.push('PRICE_RAW_SOURCE_CONFLICT');
  }
  if (parsedCurrency && exportedCurrency && parsedCurrency !== exportedCurrency) {
    reviewReasons.push('CURRENCY_RAW_SOURCE_CONFLICT');
  }
  if (parsedPriceUsd != null && exportedPriceUsd != null && materiallyDifferent(parsedPriceUsd, exportedPriceUsd, 2)) {
    reviewReasons.push('PRICE_USD_SOURCE_CONFLICT');
  }

  const parserPriceIsExplicit = Boolean(parsedPriceRaw && parsedCurrency
    && !['source_record', 'source_record_currency'].includes(currencyEvidence));
  const selectedPriceRaw = parserPriceIsExplicit ? parsedPriceRaw : exportedPriceRaw;
  const selectedPriceUsd = parserPriceIsExplicit ? parsedPriceUsd : exportedPriceUsd;
  const selectedCurrency = parserPriceIsExplicit ? parsedCurrency : exportedCurrency;

  let reviewStatus = 'READY_FOR_HUMAN_REVIEW';
  if (blockers.some(flag => flag === 'PARENT_NOT_FOUND' || flag === 'RAW_LINEAGE_MISSING' || flag.includes('INTENT'))) {
    reviewStatus = 'BLOCKED_LINEAGE_CONTEXT';
  } else if (blockers.includes('MULTI_WATCH_STOCK_LIST')) {
    reviewStatus = 'BLOCKED_MULTI_WATCH';
  } else if (blockers.some(flag => ['ACCESSORY_NOT_WATCH', 'NON_WATCH_OR_WRONG_CATEGORY'].includes(flag))) {
    reviewStatus = 'BLOCKED_NOT_WATCH';
  } else if (blockers.some(flag => flag.includes('PRICE') || flag.includes('CURRENCY') || flag === 'PARSER_MULTIPLE_CANDIDATES')) {
    reviewStatus = 'BLOCKED_PRICE_CURRENCY';
  } else if (blockers.length) {
    reviewStatus = 'BLOCKED_CATALOG';
  } else if (reviewReasons.length) {
    reviewStatus = 'REQUIRES_HUMAN_CORRECTION';
  }

  return {
    listing_id: text(row.listing_id),
    source_record_id: text(row.source_record_id),
    child_index: Number.parseInt(text(row.candidate_index), 10),
    raw_line: text(row.raw_line),
    source_created_at: text(row.source_created_at) || text(parent?.created_at) || null,
    brand: text(row.brand) || null,
    reference: selectedReference,
    reference_exported: text(row.reference) || null,
    reference_evidence: referenceQuality.proposed_reference ? 'exact_raw_line' : 'manual_export',
    model: text(row.model) || catalog.match?.model || null,
    listing_type: intent.value,
    listing_type_exported: upper(row.listing_type) || null,
    intent_evidence: intent.evidence,
    dial_color: selectedDial,
    dial_color_exported: exportedDial,
    dial_evidence: explicitDial ? 'exact_raw_adjacent_to_reference' : (exportedDial ? 'manual_export' : null),
    condition: text(row.condition) || null,
    price_raw: selectedPriceRaw,
    price_currency: selectedCurrency,
    price_usd: selectedPriceUsd,
    price_text: text(row.price_text) || null,
    price_raw_exported: exportedPriceRaw,
    price_currency_exported: exportedCurrency,
    price_usd_exported: exportedPriceUsd,
    parsed_price_raw: parsedPriceRaw,
    parsed_price_currency: parsedCurrency,
    parsed_price_usd: parsedPriceUsd,
    currency_evidence: currencyEvidence,
    catalog_confirmed: catalog.confirmed,
    catalog_dial_confirmed: catalog.dialConfirmed,
    catalog: catalog.match || null,
    exact_raw_lineage: lineageConfirmed,
    seller_name: text(parent?.seller_name) || text(row.seller_name) || null,
    seller_phone: text(parent?.seller_phone) || text(row.seller_phone) || null,
    dealer: text(parent?.dealer) || text(row.dealer) || null,
    parser_version: VERSION,
    review_status: reviewStatus,
    blockers: [...new Set(blockers)],
    review_reasons: [...new Set(reviewReasons)],
    production_approved: false,
  };
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

async function buildCanary({ listingsPath, parentsPath, outputDir, limit = DEFAULT_LIMIT }) {
  const parents = new Map();
  await streamCsv(parentsPath, row => {
    parents.set(text(row.source_record_id), row);
  });

  const rows = [];
  await streamCsv(listingsPath, row => {
    if (rows.length >= limit) return;
    rows.push(buildCanaryRow(row, parents.get(text(row.source_record_id))));
  });

  const statusCounts = {};
  const blockerCounts = {};
  const reviewReasonCounts = {};
  const intentCounts = {};
  for (const row of rows) {
    statusCounts[row.review_status] = (statusCounts[row.review_status] || 0) + 1;
    intentCounts[row.listing_type || 'UNRESOLVED'] = (intentCounts[row.listing_type || 'UNRESOLVED'] || 0) + 1;
    for (const blocker of row.blockers) blockerCounts[blocker] = (blockerCounts[blocker] || 0) + 1;
    for (const reason of row.review_reasons) reviewReasonCounts[reason] = (reviewReasonCounts[reason] || 0) + 1;
  }

  const report = {
    generated_at: new Date().toISOString(),
    parser_version: VERSION,
    input: path.resolve(listingsPath),
    parent_input: path.resolve(parentsPath),
    rows: rows.length,
    status_counts: statusCounts,
    intent_counts: intentCounts,
    blocker_counts: blockerCounts,
    review_reason_counts: reviewReasonCounts,
    release_gate: {
      decision: 'HUMAN_REVIEW_REQUIRED',
      production_writes_allowed: false,
      target: 'local_staging_artifact',
      requirements: [
        'Exact raw parent lineage',
        'Usable parent or explicit child intent',
        'Exact catalog identity',
        'Catalog-confirmed dial when a dial is proposed',
        'Individual reviewer approval before publication',
      ],
    },
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'rows.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
  const reviewReady = rows.filter(row => row.review_status === 'READY_FOR_HUMAN_REVIEW');
  const held = rows.filter(row => row.review_status !== 'READY_FOR_HUMAN_REVIEW');
  fs.writeFileSync(path.join(outputDir, 'review-ready.jsonl'), reviewReady.map(row => JSON.stringify(row)).join('\n') + (reviewReady.length ? '\n' : ''));
  fs.writeFileSync(path.join(outputDir, 'held.jsonl'), held.map(row => JSON.stringify(row)).join('\n') + (held.length ? '\n' : ''));
  fs.writeFileSync(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return { rows, report };
}

async function main() {
  const listingsPath = process.env.UNBUNDLED_CSV_PATH || process.argv[2];
  const parentsPath = process.env.UNBUNDLED_PARENT_CSV_PATH || process.argv[3];
  if (!listingsPath || !parentsPath) throw new Error('Provide listings and parent raw-message CSV paths.');
  const outputDir = path.resolve(process.env.UNBUNDLED_CANARY_OUTPUT || 'audit-output/unbundled/batch-001-canary');
  const limit = Math.max(1, Math.min(Number(process.env.UNBUNDLED_CANARY_ROWS || DEFAULT_LIMIT), 10000));
  const { report } = await buildCanary({ listingsPath, parentsPath, outputDir, limit });
  process.stdout.write(`${JSON.stringify({ event: 'unbundled_canary_complete', outputDir, ...report }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ event: 'unbundled_canary_error', error: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { buildCanary, buildCanaryRow, explicitChildIntent, resolveIntent };

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const csv = require('csv-parser');
const { analyzeRecord } = require('../shadow-reprocess/shadow-reprocess.cjs');
const { confirmCatalogCandidate } = require('../shadow-reprocess/catalog-confirmation.cjs');
const { buildPromotionDecision } = require('../shadow-reprocess/promotion-policy.cjs');
const {
  classifyPair,
  signaturesFor,
  stripChatEnvelope,
  verifiedDealerIdentity,
} = require('../duplicate-audit/duplicate-signatures.cjs');
const { redactPublicSource } = require('../../api/_lib/source-redaction.cjs');

const VERSION = 'watches-only-report-v1+v4.2-line-condition';
const EXPECTED_HEADERS = [
  'id', 'origin', 'type', 'from_name', 'phone_code', 'from_number',
  'raw_message', 'brand', 'model', 'price', 'currency', 'usd_price',
  'date_time', 'id_tag', 'front_image', 'full_image_url',
];
const SAFE_CURRENCY_EVIDENCE = new Set([
  'explicit_line_currency',
  'section_context',
  'message_context',
]);
const DUPLICATE_RANK = {
  EXACT_SOURCE_ID: 6,
  EXACT_RAW_MESSAGE: 5,
  DATE_SHIFTED_REPOST: 4,
  EXACT_LISTING: 3,
  LIKELY_REPOST: 2,
  PRICE_UPDATE_REPOST: 1,
  POSSIBLE_SHARED_INVENTORY: 0,
};

function csvParser() {
  return csv({
    mapHeaders: ({ header }) => String(header || '').replace(/^\uFEFF/, ''),
  });
}

function text(value) {
  return String(value ?? '').trim();
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function upper(value) {
  return text(value).toUpperCase();
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value ?? '')).digest('hex');
}

function normalizePhone(code, number) {
  const digits = `${text(code)}${text(number)}`.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 16 ? digits : null;
}

function maskPhone(value) {
  const digits = text(value).replace(/\D/g, '');
  if (!digits) return null;
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function mapListingType(value) {
  const normalized = text(value).toLowerCase();
  if (normalized === 'sale' || normalized === 'wts') return 'WTS';
  if (normalized === 'search' || normalized === 'wtb') return 'WTB';
  return null;
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(text(value));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function imageBasename(value) {
  try {
    return path.posix.basename(new URL(text(value)).pathname);
  } catch {
    return '';
  }
}

function imageLineage(row) {
  const explicitKey = text(row.front_image);
  const explicitUrl = text(row.full_image_url);
  const relocatedKey = /\.(?:jpe?g|png|webp)(?:\?.*)?$/i.test(text(row.date_time))
    ? text(row.date_time)
    : '';
  const relocatedUrl = isHttpUrl(row.id_tag) ? text(row.id_tag) : '';
  const imageKey = explicitKey || relocatedKey || null;
  const publicUrl = explicitUrl || relocatedUrl || null;
  const urlPlaceholder = publicUrl != null && /\/0(?:\?.*)?$/.test(publicUrl);
  const basenameMatches = Boolean(
    imageKey
    && publicUrl
    && imageBasename(publicUrl).toLowerCase() === path.basename(imageKey).toLowerCase(),
  );

  let status = 'MISSING_SOURCE_IMAGE';
  if (urlPlaceholder) status = 'INVALID_IMAGE_PLACEHOLDER';
  else if (publicUrl && !isHttpUrl(publicUrl)) status = 'INVALID_IMAGE_URL';
  else if (imageKey && publicUrl && basenameMatches) status = 'SOURCE_LINKED_PENDING_VISUAL_REVIEW';
  else if (imageKey || publicUrl) status = 'IMAGE_LINEAGE_CONFLICT';

  return {
    image_key: imageKey,
    public_url: urlPlaceholder ? null : publicUrl,
    source_columns: explicitKey || explicitUrl
      ? ['front_image', 'full_image_url']
      : relocatedKey || relocatedUrl
        ? ['date_time', 'id_tag']
        : [],
    basename_matches: basenameMatches,
    status,
    reachable: null,
    content_type: null,
    http_status: null,
  };
}

function primaryPrice(candidate) {
  const prices = Array.isArray(candidate?.prices) ? candidate.prices : [];
  return prices.find(price => price?.is_primary) || prices[0] || null;
}

function compact(value) {
  return text(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function selectedParserCandidate(analysis, row) {
  const candidates = Array.isArray(analysis?.proposed_candidates)
    ? analysis.proposed_candidates
    : [];
  if (candidates.length === 1) {
    return { candidate: candidates[0], evidence: 'SINGLE_PARSER_CANDIDATE' };
  }
  if (candidates.length < 2) return { candidate: null, evidence: null };
  const sourceModel = compact(row.model);
  if (!sourceModel) return { candidate: null, evidence: null };
  const exactReferenceMatches = candidates.filter(candidate => (
    compact(candidate.reference) === sourceModel
  ));
  if (exactReferenceMatches.length === 1) {
    return {
      candidate: exactReferenceMatches[0],
      evidence: 'EXACT_SOURCE_MODEL_TO_PARSED_REFERENCE',
    };
  }
  return { candidate: null, evidence: null };
}

function sameNumber(left, right, tolerance = 0.01) {
  const a = numeric(left);
  const b = numeric(right);
  if (a == null || b == null) return a === b;
  return Math.abs(a - b) <= Math.max(1, Math.min(a, b) * tolerance);
}

function normalizeSourceRow(row, rowNumber) {
  const sourceRecordId = text(row.id);
  const rawMessage = text(row.raw_message);
  const sourceListingType = mapListingType(row.type);
  const sellerPhone = normalizePhone(row.phone_code, row.from_number);
  const image = imageLineage(row);
  const source = {
    id: sourceRecordId,
    raw_message: rawMessage,
    brand: text(row.brand) || null,
    // The supplied model is retained as a claim. It is not promoted to a
    // reference without exact raw/parser/catalog evidence.
    reference: null,
    price_raw: numeric(row.price),
    price_usd: numeric(row.usd_price),
    currency: upper(row.currency) || null,
    listing_type: sourceListingType,
    dial_color: null,
    parser_version: null,
  };
  const analysis = analyzeRecord(source);
  const selection = selectedParserCandidate(analysis, row);
  const candidate = selection.candidate;
  const decisionAnalysis = candidate && analysis.candidate_count > 1
    ? {
      ...analysis,
      candidate_count: 1,
      proposed_candidates: [candidate],
      change_flags: analysis.change_flags.filter(flag => flag !== 'BUNDLE_SPLIT_REQUIRED'),
    }
    : analysis;
  const price = primaryPrice(candidate);
  const catalog = candidate?.brand && candidate?.reference
    ? confirmCatalogCandidate({
      brand: candidate.brand,
      reference: candidate.reference,
      dial_color: candidate.dial_color,
    })
    : null;
  const promotion = buildPromotionDecision(decisionAnalysis, catalog);
  const blockers = new Set(
    promotion.disposition === 'READY_FOR_HUMAN_APPROVAL'
      ? []
      : promotion.reasons || [],
  );
  const reviewReasons = new Set();

  if (!sourceRecordId) blockers.add('SOURCE_ID_MISSING');
  if (!rawMessage) blockers.add('RAW_MESSAGE_MISSING');
  if (!sourceListingType) blockers.add('SOURCE_INTENT_UNSUPPORTED');
  if (analysis.candidate_count > 1 && !candidate) blockers.add('SOURCE_ROW_STILL_MULTI_WATCH');
  if (candidate?.listing_type && sourceListingType && candidate.listing_type !== sourceListingType) {
    blockers.add('INTENT_RAW_SOURCE_CONFLICT');
  }
  if (sourceListingType === 'WTS') {
    if (!price?.amount_original) blockers.add('ASK_PRICE_INCOMPLETE');
    if (!SAFE_CURRENCY_EVIDENCE.has(price?.currency_evidence)) {
      blockers.add('CURRENCY_EVIDENCE_INSUFFICIENT');
    }
  }
  if (price?.amount_original && source.price_raw && !sameNumber(price.amount_original, source.price_raw)) {
    reviewReasons.add('PRICE_RAW_SOURCE_CONFLICT');
  }
  if (price?.currency_original && source.currency
    && upper(price.currency_original) !== source.currency) {
    reviewReasons.add('CURRENCY_RAW_SOURCE_CONFLICT');
  }
  if (price?.amount_usd && source.price_usd && !sameNumber(price.amount_usd, source.price_usd, 0.02)) {
    reviewReasons.add('PRICE_USD_SOURCE_CONFLICT');
  }
  if (text(row.date_time) && image.source_columns.includes('date_time')) {
    blockers.add('SOURCE_DATE_MISSING_IMAGE_FIELD_REPURPOSED');
  } else if (!text(row.date_time)) {
    blockers.add('SOURCE_DATE_MISSING');
  }
  if (!sellerPhone) blockers.add('SELLER_PHONE_INVALID');
  if (image.status !== 'SOURCE_LINKED_PENDING_VISUAL_REVIEW') {
    reviewReasons.add(image.status);
  }

  let disposition = 'REVIEW_REQUIRED';
  if (promotion.disposition === 'READY_FOR_HUMAN_APPROVAL'
    && ![...blockers].some(reason => reason !== 'SOURCE_DATE_MISSING_IMAGE_FIELD_REPURPOSED'
      && reason !== 'SOURCE_DATE_MISSING')) {
    disposition = reviewReasons.size ? 'REVIEW_REQUIRED' : 'READY_FOR_HUMAN_APPROVAL';
  }

  const normalized = {
    source_record_id: sourceRecordId,
    source_row_number: rowNumber,
    source_row_sha256: sha256(JSON.stringify(row)),
    raw_message: rawMessage,
    raw_message_sha256: sha256(rawMessage),
    source_origin: text(row.origin) || null,
    source_category_id: text(row.category_id) || null,
    source_category_name: text(row.category_name) || null,
    source_type: text(row.type) || null,
    source_listing_type: sourceListingType,
    source_brand_claim: text(row.brand) || null,
    source_model_claim: text(row.model) || null,
    source_price_claim: source.price_raw,
    source_currency_claim: source.currency,
    source_usd_price_claim: source.price_usd,
    source_date: null,
    normalized_brand: candidate?.brand || null,
    normalized_reference: candidate?.reference || null,
    normalized_model: catalog?.match?.model || null,
    normalized_dial: candidate?.dial_color || null,
    normalized_condition: candidate?.condition || null,
    normalized_listing_type: candidate?.listing_type || null,
    normalized_price_raw: price?.amount_original || null,
    normalized_currency: price?.currency_original || null,
    normalized_price_usd: price?.amount_usd || null,
    currency_evidence: price?.currency_evidence || null,
    catalog_status: catalog?.confirmed ? 'CATALOG_CONFIRMED' : 'CATALOG_UNCONFIRMED',
    catalog_reason: catalog?.reason || null,
    parser_candidate_count: analysis.candidate_count,
    parser_candidate_selection_evidence: selection.evidence,
    parser_version: VERSION,
    parser_flags: analysis.change_flags,
    blockers: [...blockers].sort(),
    review_reasons: [...reviewReasons].sort(),
    disposition,
    duplicate: {
      status: 'UNIQUE_IN_CHECKED_BASELINES',
      scope: null,
      type: null,
      confidence: null,
      matched_record_id: null,
      suppress_from_use: false,
    },
    image,
    seller: {
      observed_name: text(row.from_name) || null,
      phone_normalized: sellerPhone,
      source_identity_sha256: sellerPhone ? sha256(sellerPhone) : null,
      contact_consent: false,
      dealer_verified: false,
      public_contact_eligible: false,
    },
    production_approved: false,
  };
  normalized._duplicate_record = {
    id: sourceRecordId,
    raw_message: rawMessage,
    brand: normalized.normalized_brand,
    reference: normalized.normalized_reference,
    dial_color: normalized.normalized_dial,
    condition: normalized.normalized_condition,
    listing_type: normalized.normalized_listing_type || sourceListingType,
    price_usd: normalized.normalized_price_usd,
    seller_name: normalized.seller.observed_name,
    seller_phone: normalized.seller.phone_normalized,
    source: normalized.source_origin,
  };
  return normalized;
}

function strongerDuplicate(current, next) {
  if (!current) return next;
  const currentRank = DUPLICATE_RANK[current.type] ?? -1;
  const nextRank = DUPLICATE_RANK[next.type] ?? -1;
  if (next.suppress_from_use !== current.suppress_from_use) {
    return next.suppress_from_use ? next : current;
  }
  if (nextRank !== currentRank) return nextRank > currentRank ? next : current;
  return Number(next.confidence || 0) > Number(current.confidence || 0) ? next : current;
}

function duplicateMatch(pair, scope, matchedRecordId) {
  return {
    status: pair.suppressFromAnalytics ? 'DUPLICATE_SUPPRESSED' : 'POSSIBLE_DUPLICATE_REVIEW',
    scope,
    type: pair.type,
    confidence: pair.confidence,
    matched_record_id: matchedRecordId || null,
    suppress_from_use: Boolean(pair.suppressFromAnalytics),
  };
}

function classifySafePair(canonical, candidate) {
  const pair = classifyPair(canonical, candidate);
  if (!pair) return null;
  if (['EXACT_LISTING', 'LIKELY_REPOST', 'PRICE_UPDATE_REPOST'].includes(pair.type)) {
    const completeIdentity = canonical.brand && canonical.reference
      && candidate.brand && candidate.reference;
    if (!completeIdentity) return null;
  }
  // Each supplied row carries separate source and image evidence. Even the same
  // seller/configuration or raw text can represent another physical watch or
  // another image for one listing. Preserve it and require merge/suppress review.
  return { ...pair, suppressFromAnalytics: false };
}

function applyInternalDuplicates(rows) {
  const indexes = {
    exactRaw: new Map(),
    dateAgnosticRaw: new Map(),
    exactListing: new Map(),
  };
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const signatures = signaturesFor(row._duplicate_record);
    const candidateIndexes = new Set();
    for (const key of Object.keys(indexes)) {
      const signature = signatures[key];
      if (!signature) continue;
      for (const prior of indexes[key].get(signature) || []) candidateIndexes.add(prior);
    }
    let best = null;
    for (const priorIndex of candidateIndexes) {
      const pair = classifySafePair(rows[priorIndex]._duplicate_record, row._duplicate_record);
      if (!pair) continue;
      best = strongerDuplicate(best, duplicateMatch(
        pair,
        'INPUT_FILE',
        rows[priorIndex].source_record_id,
      ));
    }
    if (best) row.duplicate = best;
    for (const key of Object.keys(indexes)) {
      const signature = signatures[key];
      if (!signature) continue;
      const members = indexes[key].get(signature) || [];
      members.push(index);
      indexes[key].set(signature, members);
    }
  }
}

function buildBaselineIndexes(rows) {
  const indexes = { sourceId: new Map(), exactRawText: new Map() };
  rows.forEach((row, index) => {
    indexes.sourceId.set(row.source_record_id, [index]);
    const normalizedRaw = stripChatEnvelope(row.raw_message);
    if (normalizedRaw) {
      const members = indexes.exactRawText.get(normalizedRaw) || [];
      members.push(index);
      indexes.exactRawText.set(normalizedRaw, members);
    }
  });
  return indexes;
}

async function reconcileBaseline(rows, baselinePath, onProgress = () => {}) {
  if (!baselinePath) {
    return { configured: false, path: null, sha256: null, rows: 0, parse_errors: 0 };
  }
  const indexes = buildBaselineIndexes(rows);
  const fileHash = crypto.createHash('sha256');
  const stream = fs.createReadStream(baselinePath);
  stream.on('data', chunk => fileHash.update(chunk));
  const parser = stream.pipe(csvParser());
  let baselineRows = 0;

  for await (const baseline of parser) {
    baselineRows += 1;
    const record = { id: text(baseline.id), raw_message: text(baseline.raw_message) };
    const candidateIndexes = new Set(indexes.sourceId.get(record.id) || []);
    const normalizedRaw = record.raw_message ? stripChatEnvelope(record.raw_message) : '';
    for (const index of indexes.exactRawText.get(normalizedRaw) || []) candidateIndexes.add(index);
    for (const index of candidateIndexes) {
      const row = rows[index];
      let match;
      if (record.id && record.id === row.source_record_id) {
        match = {
          status: 'DUPLICATE_SUPPRESSED',
          scope: 'EXISTING_BASELINE',
          type: 'EXACT_SOURCE_ID',
          confidence: 1,
          matched_record_id: record.id,
          suppress_from_use: true,
        };
      } else {
        if (!normalizedRaw || normalizedRaw !== stripChatEnvelope(row.raw_message)) continue;
        const baselineDealer = verifiedDealerIdentity(record);
        const candidateDealer = verifiedDealerIdentity(row._duplicate_record);
        const sameDealer = baselineDealer && baselineDealer === candidateDealer;
        match = {
          status: sameDealer ? 'DUPLICATE_SUPPRESSED' : 'POSSIBLE_DUPLICATE_REVIEW',
          scope: 'EXISTING_BASELINE',
          type: 'EXACT_RAW_MESSAGE',
          confidence: sameDealer ? 1 : 0.8,
          matched_record_id: record.id,
          suppress_from_use: Boolean(sameDealer),
        };
      }
      row.duplicate = strongerDuplicate(row.duplicate, match);
    }
    if (baselineRows % 50_000 === 0) onProgress({ event: 'baseline_progress', rows: baselineRows });
  }
  return {
    configured: true,
    path: path.resolve(baselinePath),
    sha256: fileHash.digest('hex'),
    rows: baselineRows,
    parse_errors: 0,
    match_policy: 'EXACT_SOURCE_ID_OR_EXACT_NORMALIZED_RAW; AUTO_SUPPRESS_REQUIRES_MATCHING_SELLER',
  };
}

async function headImage(url, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') || null;
    return {
      reachable: response.ok && /^image\//i.test(contentType || ''),
      content_type: contentType,
      http_status: response.status,
    };
  } catch {
    return { reachable: false, content_type: null, http_status: null };
  } finally {
    clearTimeout(timer);
  }
}

async function verifyImages(rows, options = {}) {
  const concurrency = Math.max(1, Math.min(Number(options.concurrency || 24), 64));
  const targets = rows.filter(row => (
    row.image.status === 'SOURCE_LINKED_PENDING_VISUAL_REVIEW'
    && row.image.public_url
    && !row.duplicate.suppress_from_use
  ));
  let cursor = 0;
  let completed = 0;
  const workers = Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
    while (cursor < targets.length) {
      const index = cursor;
      cursor += 1;
      const row = targets[index];
      const result = await headImage(row.image.public_url, options.timeoutMs);
      Object.assign(row.image, result);
      row.image.status = result.reachable
        ? 'READY_FOR_VISUAL_REVIEW'
        : 'IMAGE_URL_UNREACHABLE';
      completed += 1;
      if (completed % 250 === 0 || completed === targets.length) {
        options.onProgress?.({ event: 'image_progress', completed, total: targets.length });
      }
    }
  });
  await Promise.all(workers);
  return { checked: targets.length };
}

function csvCell(value) {
  const serialized = Array.isArray(value)
    ? value.join('|')
    : value && typeof value === 'object'
      ? JSON.stringify(value)
      : String(value ?? '');
  return /[",\r\n]/.test(serialized) ? `"${serialized.replace(/"/g, '""')}"` : serialized;
}

function writeCsv(filePath, headers, rows) {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(headers.map(header => csvCell(row[header])).join(','));
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

function increment(target, key) {
  const safeKey = key || 'UNSPECIFIED';
  target[safeKey] = (target[safeKey] || 0) + 1;
}

function cleanForOutput(row) {
  const copy = { ...row };
  delete copy._duplicate_record;
  return copy;
}

function buildReports(rows, errors, source, baseline, imageVerification) {
  const disposition = {};
  const duplicate = {};
  const image = {};
  const catalog = {};
  const intent = {};
  const currency = {};
  const blockers = {};
  let sellerPresent = 0;
  let publicContactEligible = 0;
  let notAutoSuppressed = 0;
  let eligibleAfterDuplicateGate = 0;

  for (const row of rows) {
    increment(disposition, row.disposition);
    increment(duplicate, row.duplicate.status);
    increment(image, row.image.status);
    increment(catalog, row.catalog_status);
    increment(intent, row.normalized_listing_type || row.source_listing_type);
    increment(currency, row.currency_evidence);
    for (const blocker of row.blockers) increment(blockers, blocker);
    if (row.seller.phone_normalized) sellerPresent += 1;
    if (row.seller.public_contact_eligible) publicContactEligible += 1;
    if (!row.duplicate.suppress_from_use) notAutoSuppressed += 1;
    if (row.duplicate.status === 'UNIQUE_IN_CHECKED_BASELINES') {
      eligibleAfterDuplicateGate += 1;
    }
  }

  const reconciled = source.rows === rows.length + errors.length;
  const dispositionTotal = Object.values(disposition).reduce((sum, value) => sum + value, 0);
  const duplicateTotal = Object.values(duplicate).reduce((sum, value) => sum + value, 0);
  const coverage = {
    generated_at: new Date().toISOString(),
    input_rows: source.rows,
    normalized_rows: rows.length,
    error_rows: errors.length,
    not_auto_suppressed: notAutoSuppressed,
    eligible_after_duplicate_gate: eligibleAfterDuplicateGate,
    seller_source_identity_present: sellerPresent,
    public_contact_eligible: publicContactEligible,
    disposition,
    duplicate,
    image,
    catalog,
    intent,
    currency,
    blockers,
    production_writes: 0,
  };
  const reconciliation = {
    equation: 'input_rows = normalized_rows + error_rows',
    input_rows: source.rows,
    normalized_rows: rows.length,
    error_rows: errors.length,
    difference: source.rows - rows.length - errors.length,
    disposition_total: dispositionTotal,
    duplicate_total: duplicateTotal,
    disposition_reconciles: dispositionTotal === rows.length,
    duplicate_reconciles: duplicateTotal === rows.length,
    reconciled: reconciled && dispositionTotal === rows.length && duplicateTotal === rows.length,
  };
  const manifest = {
    contract: 'watches-only-report-normalization-v1',
    generated_at: new Date().toISOString(),
    normalization_version: VERSION,
    source,
    duplicate_baseline: baseline,
    image_verification: imageVerification,
    safety: {
      immutable_source_read: true,
      local_outputs_only: true,
      production_writes: 0,
      watch_records_writes: 0,
      contacts_publicly_released: 0,
      images_attached_to_listings: 0,
      human_review_required: true,
    },
  };
  return { coverage, reconciliation, manifest };
}

async function sourceMetadata(sourcePath) {
  const hash = crypto.createHash('sha256');
  const input = fs.createReadStream(sourcePath);
  input.on('data', chunk => hash.update(chunk));
  let headers = [];
  let rows = 0;
  await new Promise((resolve, reject) => {
    input
      .pipe(csvParser())
      .on('headers', value => { headers = value; })
      .on('data', () => { rows += 1; })
      .on('end', resolve)
      .on('error', reject);
  });
  return {
    path: path.resolve(sourcePath),
    bytes: fs.statSync(sourcePath).size,
    sha256: hash.digest('hex'),
    rows,
    headers,
    missing_headers: EXPECTED_HEADERS.filter(header => !headers.includes(header)),
  };
}

async function readAndNormalize(sourcePath) {
  const rows = [];
  const errors = [];
  let rowNumber = 0;
  const input = fs.createReadStream(sourcePath).pipe(csvParser());
  for await (const sourceRow of input) {
    rowNumber += 1;
    try {
      rows.push(normalizeSourceRow(sourceRow, rowNumber));
    } catch (error) {
      errors.push({
        source_row_number: rowNumber,
        source_record_id: text(sourceRow.id) || null,
        reason: 'NORMALIZATION_EXCEPTION',
        error: error.message,
      });
    }
  }
  return { rows, errors };
}

async function runIntake(options) {
  const sourcePath = path.resolve(options.sourcePath);
  const baselinePath = options.baselinePath ? path.resolve(options.baselinePath) : null;
  const outputDir = path.resolve(options.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  const source = await sourceMetadata(sourcePath);
  if (source.missing_headers.length) {
    throw new Error(`Missing required source headers: ${source.missing_headers.join(', ')}`);
  }
  const { rows, errors } = await readAndNormalize(sourcePath);
  applyInternalDuplicates(rows);
  const baseline = await reconcileBaseline(rows, baselinePath, options.onProgress);
  const imageVerification = options.verifyImages
    ? await verifyImages(rows, {
      concurrency: options.imageConcurrency,
      timeoutMs: options.imageTimeoutMs,
      onProgress: options.onProgress,
    })
    : { checked: 0, skipped: true };

  for (const row of rows) {
    if (row.duplicate.suppress_from_use) row.disposition = 'DUPLICATE_SUPPRESSED';
    else if (row.duplicate.status === 'POSSIBLE_DUPLICATE_REVIEW') {
      row.disposition = 'DUPLICATE_REVIEW_REQUIRED';
    }
  }

  const reports = buildReports(rows, errors, source, baseline, imageVerification);
  const cleanRows = rows.map(cleanForOutput);
  fs.writeFileSync(
    path.join(outputDir, 'normalized-listings.private.jsonl'),
    `${cleanRows.map(row => JSON.stringify(row)).join('\n')}\n`,
  );
  fs.writeFileSync(
    path.join(outputDir, 'eligible-for-human-review.private.jsonl'),
    `${cleanRows.filter(row => row.duplicate.status === 'UNIQUE_IN_CHECKED_BASELINES')
      .map(row => JSON.stringify(row)).join('\n')}\n`,
  );

  writeCsv(path.join(outputDir, 'review-queue.redacted.csv'), [
    'source_record_id', 'source_origin', 'source_listing_type', 'raw_listing_redacted',
    'normalized_brand', 'normalized_reference', 'normalized_model', 'normalized_dial',
    'normalized_condition', 'normalized_price_raw', 'normalized_currency',
    'normalized_price_usd', 'catalog_status', 'disposition', 'duplicate_status',
    'image_status', 'seller_identity_status', 'seller_phone_masked', 'blockers', 'review_reasons',
  ], cleanRows.map(row => ({
    source_record_id: row.source_record_id,
    source_origin: row.source_origin,
    source_listing_type: row.source_listing_type,
    raw_listing_redacted: redactPublicSource(row.raw_message),
    normalized_brand: row.normalized_brand,
    normalized_reference: row.normalized_reference,
    normalized_model: row.normalized_model,
    normalized_dial: row.normalized_dial,
    normalized_condition: row.normalized_condition,
    normalized_price_raw: row.normalized_price_raw,
    normalized_currency: row.normalized_currency,
    normalized_price_usd: row.normalized_price_usd,
    catalog_status: row.catalog_status,
    disposition: row.disposition,
    duplicate_status: row.duplicate.status,
    image_status: row.image.status,
    seller_identity_status: row.seller.observed_name ? 'AVAILABLE_IN_PRIVATE_LINEAGE' : '',
    seller_phone_masked: maskPhone(row.seller.phone_normalized),
    blockers: row.blockers,
    review_reasons: row.review_reasons,
  })));

  writeCsv(path.join(outputDir, 'image-review.private.csv'), [
    'source_record_id', 'raw_message', 'normalized_brand', 'normalized_reference',
    'image_key', 'public_url', 'lineage_status', 'reachable', 'content_type',
    'duplicate_status', 'review_decision', 'review_reason',
  ], cleanRows.map(row => ({
    source_record_id: row.source_record_id,
    raw_message: row.raw_message,
    normalized_brand: row.normalized_brand,
    normalized_reference: row.normalized_reference,
    image_key: row.image.image_key,
    public_url: row.image.public_url,
    lineage_status: row.image.status,
    reachable: row.image.reachable,
    content_type: row.image.content_type,
    duplicate_status: row.duplicate.status,
    review_decision: '',
    review_reason: '',
  })));

  writeCsv(path.join(outputDir, 'seller-lineage.private.csv'), [
    'source_record_id', 'source_origin', 'observed_name', 'phone_normalized',
    'source_identity_sha256', 'dealer_verified', 'contact_consent',
    'public_contact_eligible', 'duplicate_status', 'review_decision', 'review_reason',
  ], cleanRows.map(row => ({
    source_record_id: row.source_record_id,
    source_origin: row.source_origin,
    observed_name: row.seller.observed_name,
    phone_normalized: row.seller.phone_normalized,
    source_identity_sha256: row.seller.source_identity_sha256,
    dealer_verified: row.seller.dealer_verified,
    contact_consent: row.seller.contact_consent,
    public_contact_eligible: row.seller.public_contact_eligible,
    duplicate_status: row.duplicate.status,
    review_decision: '',
    review_reason: '',
  })));

  writeCsv(path.join(outputDir, 'duplicate-listings.csv'), [
    'source_record_id', 'status', 'scope', 'type', 'confidence',
    'matched_record_id', 'suppress_from_use',
  ], cleanRows
    .filter(row => row.duplicate.status !== 'UNIQUE_IN_CHECKED_BASELINES')
    .map(row => ({
      source_record_id: row.source_record_id,
      status: row.duplicate.status,
      scope: row.duplicate.scope,
      type: row.duplicate.type,
      confidence: row.duplicate.confidence,
      matched_record_id: row.duplicate.matched_record_id,
      suppress_from_use: row.duplicate.suppress_from_use,
    })));

  writeCsv(path.join(outputDir, 'errors.csv'), [
    'source_row_number', 'source_record_id', 'reason', 'error',
  ], errors);
  writeCsv(path.join(outputDir, 'blockers-by-reason.csv'), [
    'reason', 'rows',
  ], Object.entries(reports.coverage.blockers)
    .sort((left, right) => right[1] - left[1])
    .map(([reason, count]) => ({ reason, rows: count })));
  writeCsv(path.join(outputDir, 'coverage-report.csv'), [
    'dimension', 'value', 'rows',
  ], [
    ...Object.entries(reports.coverage.disposition)
      .map(([value, count]) => ({ dimension: 'disposition', value, rows: count })),
    ...Object.entries(reports.coverage.duplicate)
      .map(([value, count]) => ({ dimension: 'duplicate', value, rows: count })),
    ...Object.entries(reports.coverage.image)
      .map(([value, count]) => ({ dimension: 'image', value, rows: count })),
    ...Object.entries(reports.coverage.catalog)
      .map(([value, count]) => ({ dimension: 'catalog', value, rows: count })),
  ]);
  fs.writeFileSync(path.join(outputDir, 'run-manifest.json'), `${JSON.stringify(reports.manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, 'coverage-report.json'), `${JSON.stringify(reports.coverage, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, 'reconciliation.json'), `${JSON.stringify(reports.reconciliation, null, 2)}\n`);

  if (!reports.reconciliation.reconciled) {
    throw new Error(`Reconciliation failed: ${JSON.stringify(reports.reconciliation)}`);
  }
  return { ...reports, rows: cleanRows, errors, outputDir };
}

async function main() {
  const sourcePath = process.env.WATCHES_ONLY_REPORT_PATH || process.argv[2];
  const baselinePath = process.env.WATCHES_DUPLICATE_BASELINE || process.argv[3] || null;
  if (!sourcePath) throw new Error('Provide WATCHES_ONLY_REPORT_PATH or a source CSV argument.');
  const outputDir = process.env.WATCHES_ONLY_OUTPUT
    || path.resolve('audit-output', `watches-only-report-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`);
  const verifyImageUrls = String(process.env.WATCHES_VERIFY_IMAGES || 'false').toLowerCase() === 'true';
  const result = await runIntake({
    sourcePath,
    baselinePath,
    outputDir,
    verifyImages: verifyImageUrls,
    imageConcurrency: process.env.WATCHES_IMAGE_CONCURRENCY || 24,
    imageTimeoutMs: process.env.WATCHES_IMAGE_TIMEOUT_MS || 10_000,
    onProgress: event => process.stdout.write(`${JSON.stringify(event)}\n`),
  });
  process.stdout.write(`${JSON.stringify({
    event: 'watches_only_report_complete',
    outputDir: result.outputDir,
    coverage: result.coverage,
    reconciliation: result.reconciliation,
  }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ event: 'watches_only_report_error', error: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  applyInternalDuplicates,
  classifySafePair,
  imageLineage,
  mapListingType,
  normalizePhone,
  normalizeSourceRow,
  reconcileBaseline,
  runIntake,
};

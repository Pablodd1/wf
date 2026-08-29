'use strict';

// Read-only forensic audit for price-held owner-reviewed workbook rows. The
// output is an evidence proposal, never an approval and never a database write.

const fs = require('node:fs');
const path = require('node:path');
const { extractPriceObservations } = require('../../api/_lib/normalization-v4.cjs');
const { summarizePrices } = require('../../api/_lib/market-stats.cjs');
const {
  confirmCatalogCandidate,
  rawSupportsReferenceToken,
} = require('../../api/_lib/catalog-confirmation.cjs');
const intake = require('./import-approved-admission-workbook.cjs');
const { admissionIntent } = require('./prepare-franck-muller-admission.cjs');

const BARE_DOLLAR = /(^|[^A-Za-z])\$(?=\s*[\d])/;
const NON_ASKING_VALUE_PREFIX = /(?:\bMSRP\b|\bRRP\b|retail(?:\s+price)?|list\s+price|apprais(?:al|ed)|valu(?:ation|ed)|estimated\s+value)\s*[:=-]?\s*$/i;

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function observationIsNonAsking(raw, observation) {
  const token = text(observation?.raw_price_text);
  if (!token) return false;
  const index = raw.indexOf(token);
  if (index < 0) return false;
  const lineStart = Math.max(raw.lastIndexOf('\n', index), raw.lastIndexOf('\r', index)) + 1;
  const prefix = raw.slice(Math.max(lineStart, index - 48), index);
  return NON_ASKING_VALUE_PREFIX.test(prefix);
}

function classifyPriceEvidence(source, listingType = 'WTS') {
  const raw = text(source.raw_message);
  const observations = extractPriceObservations(raw, {});
  const explicitUsd = observations.filter(observation => (
    ['USD', 'USDT'].includes(text(observation.currency_original).toUpperCase())
    && observation.currency_evidence === 'explicit_line_currency'
    && positiveNumber(observation.amount_original) !== null
  ));
  const explicitNonUsd = observations.filter(observation => (
    !['USD', 'USDT'].includes(text(observation.currency_original).toUpperCase())
    && observation.currency_evidence === 'explicit_line_currency'
    && positiveNumber(observation.amount_original) !== null
  ));
  const askingExplicitUsd = explicitUsd.filter(item => !observationIsNonAsking(raw, item));
  const askingExplicitNonUsd = explicitNonUsd.filter(item => !observationIsNonAsking(raw, item));

  if (text(listingType).toUpperCase() === 'WTB') {
    return { classification: 'WTB_OVERRIDE', recommendation: 'KEEP_AS_DEMAND', observations };
  }
  const distinctUsdAmounts = [...new Set(askingExplicitUsd.map(item => Number(item.amount_original)))];
  if (distinctUsdAmounts.length === 1) {
    const selected = askingExplicitUsd[0];
    if (Number(selected.amount_original) < 1000) {
      return { classification: 'IMPLAUSIBLE_EXPLICIT_PRICE', recommendation: 'DEFER_AMBIGUOUS', observations };
    }
    return {
      classification: 'EXPLICIT_USD_USDT_REVIEW_CANDIDATE',
      recommendation: 'APPLY_CANDIDATE_AFTER_LINEAGE_CANARY',
      observations,
      proposed_price_usd: Number(selected.amount_original),
      source_amount: Number(selected.amount_original),
      source_currency: text(selected.currency_original).toUpperCase(),
      raw_price_text: selected.raw_price_text || null,
    };
  }
  if (distinctUsdAmounts.length > 1) {
    return { classification: 'MULTIPLE_EXPLICIT_USD_AMOUNTS', recommendation: 'DEFER_AMBIGUOUS', observations };
  }

  const fxCurrency = text(source.source_currency).toUpperCase();
  const matchingFxObservation = askingExplicitNonUsd.find(observation => (
    text(observation.currency_original).toUpperCase() === fxCurrency
  )) || null;
  if (
    matchingFxObservation
    && positiveNumber(source.normalized_price_usd) !== null
    && text(source.fx_source)
    && text(source.fx_rate_date)
  ) {
    return {
      classification: 'NAMED_DATED_FX_REVIEW_CANDIDATE',
      recommendation: 'APPLY_CANDIDATE_AFTER_SIDECAR_CANARY',
      observations,
      proposed_price_usd: positiveNumber(source.normalized_price_usd),
      source_amount: Number(matchingFxObservation.amount_original),
      source_currency: text(matchingFxObservation.currency_original).toUpperCase(),
      raw_price_text: matchingFxObservation.raw_price_text || null,
      fx_source: text(source.fx_source),
      fx_rate_date: text(source.fx_rate_date),
    };
  }

  if (observations.length > 0 && observations.every(item => observationIsNonAsking(raw, item))) {
    return { classification: 'RETAIL_APPRAISAL_OR_NON_ASKING', recommendation: 'DEFER_AMBIGUOUS', observations };
  }
  if (BARE_DOLLAR.test(raw) || observations.some(item => item.currency_evidence === 'usd_defaulted_by_policy')) {
    return { classification: 'AMBIGUOUS_BARE_DOLLAR', recommendation: 'DEFER_AMBIGUOUS', observations };
  }
  if (askingExplicitNonUsd.length > 0) {
    return { classification: 'NON_USD_FX_PROVENANCE_INCOMPLETE', recommendation: 'DEFER_AMBIGUOUS', observations };
  }
  if (observations.length === 0 && !text(source.asking_price_raw) && positiveNumber(source.normalized_price_usd) === null) {
    return { classification: 'NO_PRICE_AT_SOURCE', recommendation: 'KEEP_TRADING_FLOOR_ONLY', observations };
  }
  return { classification: 'OTHER_PRICE_EVIDENCE_INCOMPLETE', recommendation: 'DEFER_AMBIGUOUS', observations };
}

// Reconstructs the importer policy used for the already-published 53 rows so
// the 1,750-row census remains reproducible after the stricter currency fix.
function historicallyQualifiedPrice(source, decision, listingType) {
  if (text(listingType).toUpperCase() !== 'WTS') return false;
  const intent = admissionIntent(source.raw_message, source.intent);
  const observations = extractPriceObservations(text(source.raw_message), {});
  const primary = observations.find(item => item.is_primary) || observations[0] || null;
  const normalizedUsd = positiveNumber(source.normalized_price_usd);
  const sourceAmount = positiveNumber(primary?.amount_original);
  return intent.raw_sell_side
    && text(decision.price_research_status).toUpperCase() === 'ELIGIBLE'
    && ['USD', 'USDT'].includes(text(source.source_currency).toUpperCase())
    && normalizedUsd !== null
    && sourceAmount !== null
    && Math.abs(normalizedUsd - sourceAmount) <= 0.01
    && primary?.currency_evidence === 'explicit_line_currency'
    && Boolean(text(source.fx_source) && text(source.fx_rate_date));
}

function csvCell(value) {
  const content = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(content) ? `"${content.replaceAll('"', '""')}"` : content;
}

function writeCsv(filePath, columns, rows) {
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map(column => csvCell(row[column])).join(','));
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

function parseArgs(argv) {
  const options = { inputs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--input') options.inputs.push(path.resolve(argv[++index]));
    else if (token === '--brand') options.brand = argv[++index];
    else if (token === '--output-dir') options.outputDir = path.resolve(argv[++index]);
    else if (token === '--target-ids-csv') options.targetIdsCsv = path.resolve(argv[++index]);
  }
  if (!options.outputDir) options.outputDir = path.resolve('audit-output', `reviewed-price-evidence-${Date.now()}`);
  if (!options.inputs.length || !options.brand) {
    throw new Error('Repeat --input and --brand in matching order, followed by --output-dir');
  }
  const brands = String(options.brand).split('|').map(item => item.trim()).filter(Boolean);
  if (brands.length !== options.inputs.length) throw new Error('--brand must contain one | separated brand per --input');
  return { ...options, brands };
}

function auditWorkbook(filePath, brand) {
  const workbook = intake.readAdmissionWorkbook(filePath);
  const candidates = [];
  workbook.sourceRows.forEach((source, index) => {
    const decision = workbook.decisions.get(text(source.listing_id));
    if (!decision) return;
    const row = intake.rowForImport({
      source,
      decision,
      expectedBrand: brand,
      fileName: path.basename(filePath),
      fileSha256: workbook.fileSha256,
      rowNumber: index + 2,
      runId: 'read_only_price_evidence_audit',
      retainIdentityConflictsForAudit: true,
    });
    if (row) candidates.push({ row, source, decision });
  });

  const canonical = intake.canonicalizeExactDuplicates(candidates.map(item => item.row));
  const byId = new Map(candidates.map(item => [item.row.id, item]));
  const visible = canonical.canonical.map(row => byId.get(row.id));
  const auditRows = visible.map(item => ({
    item,
    evidence: classifyPriceEvidence(item.source, item.row.listing_type),
  }));
  return { workbook, visible, auditRows, duplicateExcluded: canonical.excluded };
}

function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  fs.mkdirSync(options.outputDir, { recursive: true });
  const targetIds = options.targetIdsCsv
    ? new Set(fs.readFileSync(options.targetIdsCsv, 'utf8').split(/\r?\n/).slice(1)
      .map(line => line.split(',', 3)[1]).filter(Boolean))
    : null;
  const evidenceRows = [];
  const identityConflictRows = [];
  const identityGateReviewRows = [];
  const qualificationRegressions = [];
  const report = {
    generated_at: new Date().toISOString(),
    mode: 'LOCAL_READ_ONLY_REVIEWED_WORKBOOK_PRICE_EVIDENCE_AUDIT',
    database_writes: 0,
    workbooks: [],
    totals: { visible: 0, wtb: 0, wts: 0, already_qualified_wts: 0, target_price_held_wts: 0, previously_qualified_now_failed_strict_currency_gate: 0, identity_conflicts_to_quarantine: 0, future_import_identity_gate_held: 0, duplicate_candidates_excluded: 0 },
    target_classifications: {},
  };

  options.inputs.forEach((filePath, index) => {
    const brand = options.brands[index];
    const result = auditWorkbook(filePath, brand);
    const visibleWtb = result.auditRows.filter(entry => entry.item.row.listing_type === 'WTB');
    const visibleWts = result.auditRows.filter(entry => entry.item.row.listing_type === 'WTS');
    const heldWts = targetIds
      ? visibleWts.filter(entry => targetIds.has(entry.item.row.id))
      : visibleWts.filter(entry => !historicallyQualifiedPrice(
        entry.item.source, entry.item.decision, entry.item.row.listing_type,
      ));
    const qualifiedWts = targetIds
      ? visibleWts.filter(entry => !targetIds.has(entry.item.row.id))
      : visibleWts.filter(entry => historicallyQualifiedPrice(
        entry.item.source, entry.item.decision, entry.item.row.listing_type,
      ));
    const regressions = qualifiedWts.filter(entry => (
      entry.item.row.price_evidence_status !== 'SOURCE_EXPLICIT_USD_MATCH'
    ));
    for (const entry of regressions) {
      qualificationRegressions.push({
        brand,
        listing_id: entry.item.row.id,
        source_record_id: entry.item.row.source_record_id,
        source_row_number: entry.item.row.source_row_number,
        reference: entry.item.row.normalized_reference,
        strict_price_evidence_status: entry.item.row.price_evidence_status,
        source_payload_sha256: entry.item.row.source_payload_sha256,
        proposed_action: 'REMOVE_FROM_PRICE_RESEARCH_PENDING_REVIEW',
        raw_message_sha256: require('node:crypto').createHash('sha256').update(text(entry.item.source.raw_message)).digest('hex'),
      });
    }
    const classifications = {};
    const identityConflicts = result.auditRows.filter(entry => (
      intake.admissionIdentityConflictReasons(entry.item.source, entry.item.decision, brand).length > 0
    ));
    const identityGateHeld = result.auditRows.filter(entry => (
      intake.admissionIdentityGateReasons(entry.item.source, entry.item.decision, brand).length > 0
    ));
    for (const entry of identityGateHeld) {
      identityGateReviewRows.push({
        brand,
        listing_id: entry.item.row.id,
        source_record_id: entry.item.row.source_record_id,
        source_row_number: entry.item.row.source_row_number,
        reference: entry.item.row.normalized_reference,
        gate_reasons: intake.admissionIdentityGateReasons(
          entry.item.source, entry.item.decision, brand,
        ).join('|'),
        disposition: 'HOLD_ON_FUTURE_IMPORT_PENDING_IDENTITY_REVIEW',
        raw_message_sha256: require('node:crypto').createHash('sha256').update(text(entry.item.source.raw_message)).digest('hex'),
      });
    }
    for (const entry of identityConflicts) {
      const reasons = intake.admissionIdentityConflictReasons(entry.item.source, entry.item.decision, brand);
      const rawExplicitBrands = intake.strictExplicitBrandsInRaw(entry.item.source.raw_message);
      const catalog = confirmCatalogCandidate({ brand, reference: entry.item.row.normalized_reference });
      identityConflictRows.push({
        brand,
        listing_id: entry.item.row.id,
        source_record_id: entry.item.row.source_record_id,
        source_message_id: text(entry.item.source.source_message_id),
        source_row_number: entry.item.row.source_row_number,
        reference: entry.item.row.normalized_reference,
        listing_type: entry.item.row.listing_type,
        current_price_evidence_status: entry.item.row.price_evidence_status,
        source_payload_sha256: entry.item.row.source_payload_sha256,
        conflict_reasons: reasons.join('|'),
        raw_explicit_brands: rawExplicitBrands.join('|'),
        catalog_conflict_brand: catalog.reason === 'CATALOG_BRAND_CONFLICT' ? catalog.match?.brand || '' : '',
        catalog_match_type: catalog.match?.matchType || '',
        proposed_verification_status: 'QUARANTINED_IDENTITY_CONFLICT',
        raw_message_sha256: require('node:crypto').createHash('sha256').update(text(entry.item.source.raw_message)).digest('hex'),
      });
    }
    for (const entry of heldWts) {
      const rawBrands = intake.strictExplicitBrandsInRaw(entry.item.source.raw_message);
      const catalog = confirmCatalogCandidate({
        brand,
        reference: entry.item.row.normalized_reference,
      });
      const rawReferenceSupported = rawSupportsReferenceToken(
        entry.item.source.raw_message,
        entry.item.row.normalized_reference,
      );
      const identitySupported = rawReferenceSupported && (
        rawBrands.includes(brand)
        || (catalog.confirmed && catalog.match?.brand === brand)
      );
      classifications[entry.evidence.classification] = (classifications[entry.evidence.classification] || 0) + 1;
      report.target_classifications[entry.evidence.classification] = (report.target_classifications[entry.evidence.classification] || 0) + 1;
      evidenceRows.push({
        brand,
        listing_id: entry.item.row.id,
        source_record_id: entry.item.row.source_record_id,
        source_message_id: text(entry.item.source.source_message_id),
        source_row_number: entry.item.row.source_row_number,
        reference: entry.item.row.normalized_reference,
        current_price_evidence_status: entry.item.row.price_evidence_status,
        source_payload_sha256: entry.item.row.source_payload_sha256,
        classification: entry.evidence.classification,
        recommendation: entry.evidence.recommendation,
        raw_price_text: entry.evidence.raw_price_text || '',
        source_amount: entry.evidence.source_amount || '',
        source_currency: entry.evidence.source_currency || '',
        proposed_price_usd: entry.evidence.proposed_price_usd || '',
        fx_source: entry.evidence.fx_source || '',
        fx_rate_date: entry.evidence.fx_rate_date || '',
        identity_support_status: identitySupported ? 'SOURCE_OR_CATALOG_SUPPORTED' : 'IDENTITY_REVIEW_REQUIRED',
        raw_message_sha256: require('node:crypto').createHash('sha256').update(text(entry.item.source.raw_message)).digest('hex'),
      });
    }
    report.workbooks.push({
      brand,
      file: filePath,
      source_sha256: result.workbook.fileSha256,
      source_rows: result.workbook.sourceRows.length,
      visible_rows: result.visible.length,
      visible_wtb: visibleWtb.length,
      visible_wts: visibleWts.length,
      already_qualified_wts: qualifiedWts.length,
      target_price_held_wts: heldWts.length,
      previously_qualified_now_failed_strict_currency_gate: regressions.length,
      identity_conflicts_to_quarantine: identityConflicts.length,
      future_import_identity_gate_held: identityGateHeld.length,
      target_classifications: classifications,
      duplicate_candidates_excluded: result.duplicateExcluded.length,
    });
    report.totals.visible += result.visible.length;
    report.totals.wtb += visibleWtb.length;
    report.totals.wts += visibleWts.length;
    report.totals.already_qualified_wts += qualifiedWts.length;
    report.totals.target_price_held_wts += heldWts.length;
    report.totals.previously_qualified_now_failed_strict_currency_gate += regressions.length;
    report.totals.identity_conflicts_to_quarantine += identityConflicts.length;
    report.totals.future_import_identity_gate_held += identityGateHeld.length;
    report.totals.duplicate_candidates_excluded += result.duplicateExcluded.length;
  });

  report.reconciliation = {
    visible_equals_wtb_plus_wts: report.totals.visible === report.totals.wtb + report.totals.wts,
    wts_equals_qualified_plus_held: report.totals.wts === report.totals.already_qualified_wts + report.totals.target_price_held_wts,
    held_equals_classifications: report.totals.target_price_held_wts === Object.values(report.target_classifications).reduce((sum, value) => sum + value, 0),
  };
  report.release_gate = 'HUMAN_REVIEW_AND_BOUNDED_SIDECAR_CANARY_REQUIRED';
  report.target_id_baseline = options.targetIdsCsv || null;
  const hardConflictIds = new Set(identityConflictRows.map(row => row.listing_id));
  const promotionRows = evidenceRows.filter(row => (
    row.classification === 'EXPLICIT_USD_USDT_REVIEW_CANDIDATE'
    && row.identity_support_status === 'SOURCE_OR_CATALOG_SUPPORTED'
    && !hardConflictIds.has(row.listing_id)
  ));
  const currencyControlRows = qualificationRegressions.filter(row => !hardConflictIds.has(row.listing_id));
  const promotionCohorts = new Map();
  for (const row of promotionRows) {
    const key = `${row.brand}|${row.reference}`;
    const members = promotionCohorts.get(key) || [];
    members.push(Number(row.proposed_price_usd));
    promotionCohorts.set(key, members);
  }
  const iqrCohorts = [...promotionCohorts.entries()].map(([key, values]) => {
    const [brand, reference] = key.split('|');
    const summary = summarizePrices(values);
    return {
      brand, reference, candidate_rows: values.length,
      analytics_ready_with_candidate_only: summary.analytics_ready,
      included_count: summary.included_count, outlier_count: summary.outlier_count,
      iqr_multiplier: summary.stats?.iqr_multiplier || 3.0,
    };
  });
  report.promotion_review = {
    exact_usd_usdt_with_positive_identity_and_no_hard_conflict: promotionRows.length,
    exact_duplicate_candidates_excluded_before_review: report.totals.duplicate_candidates_excluded,
    candidate_only_reference_cohorts: iqrCohorts.length,
    candidate_only_analytics_ready_cohorts: iqrCohorts.filter(row => row.analytics_ready_with_candidate_only).length,
    candidate_only_outliers_preserved: iqrCohorts.reduce((sum, row) => sum + row.outlier_count, 0),
    gate: 'EXISTING_REFERENCE_COHORT_DUPLICATE_PLAUSIBILITY_AND_3X_IQR_CANARY_REQUIRED',
  };
  report.control_rows = {
    hard_identity_conflicts: identityConflictRows.length,
    strict_currency_regressions_nonoverlap: currencyControlRows.length,
  };

  fs.writeFileSync(path.join(options.outputDir, 'price-evidence-audit.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeCsv(path.join(options.outputDir, 'price-evidence-candidates.csv'), [
    'brand', 'listing_id', 'source_record_id', 'source_message_id', 'source_row_number', 'reference',
    'current_price_evidence_status', 'source_payload_sha256', 'classification', 'recommendation', 'raw_price_text',
    'source_amount', 'source_currency', 'proposed_price_usd', 'fx_source', 'fx_rate_date', 'raw_message_sha256',
    'identity_support_status',
  ], evidenceRows);
  writeCsv(path.join(options.outputDir, 'identity-conflict-quarantine-canary.csv'), [
    'brand', 'listing_id', 'source_record_id', 'source_message_id', 'source_row_number',
    'reference', 'listing_type', 'current_price_evidence_status', 'source_payload_sha256',
    'conflict_reasons', 'raw_explicit_brands', 'catalog_conflict_brand', 'catalog_match_type',
    'proposed_verification_status', 'raw_message_sha256',
  ], identityConflictRows);
  writeCsv(path.join(options.outputDir, 'price-qualification-regressions.csv'), [
    'brand', 'listing_id', 'source_record_id', 'source_row_number', 'reference',
    'strict_price_evidence_status', 'source_payload_sha256', 'proposed_action', 'raw_message_sha256',
  ], qualificationRegressions);
  writeCsv(path.join(options.outputDir, 'currency-regression-control.csv'), [
    'brand', 'listing_id', 'source_record_id', 'source_row_number', 'reference',
    'strict_price_evidence_status', 'source_payload_sha256', 'proposed_action', 'raw_message_sha256',
  ], currencyControlRows);
  writeCsv(path.join(options.outputDir, 'price-promotion-review.csv'), [
    'brand', 'listing_id', 'source_record_id', 'source_message_id', 'source_row_number', 'reference',
    'current_price_evidence_status', 'source_payload_sha256', 'classification', 'recommendation',
    'raw_price_text', 'source_amount', 'source_currency', 'proposed_price_usd', 'fx_source',
    'fx_rate_date', 'raw_message_sha256', 'identity_support_status',
  ], promotionRows);
  writeCsv(path.join(options.outputDir, 'price-promotion-iqr-compatibility.csv'), [
    'brand', 'reference', 'candidate_rows', 'analytics_ready_with_candidate_only',
    'included_count', 'outlier_count', 'iqr_multiplier',
  ], iqrCohorts);
  writeCsv(path.join(options.outputDir, 'future-import-identity-review.csv'), [
    'brand', 'listing_id', 'source_record_id', 'source_row_number', 'reference',
    'gate_reasons', 'disposition', 'raw_message_sha256',
  ], identityGateReviewRows);
  process.stdout.write(`${JSON.stringify({ output_dir: options.outputDir, ...report.totals, target_classifications: report.target_classifications, reconciliation: report.reconciliation, database_writes: 0 }, null, 2)}\n`);
  return report;
}

if (require.main === module) {
  try { run(); } catch (error) { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; }
}

module.exports = { auditWorkbook, classifyPriceEvidence, historicallyQualifiedPrice, run };

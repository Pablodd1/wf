#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { extractPriceCandidates, extractPriceObservations, segmentDealerMessage } = require('../../api/_lib/normalization-v4.cjs');
const { classify } = require('./phase4c-rolex-safe-wts-discovery.cjs');

const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const refKey = value => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
const AED_LITERAL = /(^|[^A-Z])AED([^A-Z]|$)/i;
const AED_ALIAS = /(^|[^A-Z])(DHS?|DIRHAMS?)([^A-Z]|$)/i;
const SUPPORTED_LITERAL = /(^|[^A-Z])(USD|USDT|HKD|HK\$|EUR|GBP|CHF|SGD|JPY|CNY)([^A-Z]|$)/i;
const SYMBOL_CURRENCY = /[€£¥]/;
const MULTIPLIER = /(?:\d(?:[.,]\d+)?\s*(?:K|M|MIL|MILL|MILLION)\b|(?:K|M)\s*\d)/i;
const BUNDLE_WORD = /\b(?:bundle|package|lot|take\s+all|both|pair)\b/i;
const EXPLICIT_CURRENCY = /(?:^|[^A-Z])(?:USD|USDT|AED|HKD|HK\$|EUR|GBP|CHF|SGD|JPY|CNY)(?:[^A-Z]|$)|[€£¥]/i;

const reasonToClass = reason => ({
  PRICE_OR_CURRENCY_REQUIRES_REVIEW: 'PRICE_CURRENCY_REVIEW',
  MULTIPLE_PRICE_CANDIDATES: 'MULTIPLE_PRICE_AMBIGUITY',
  NO_EXACT_AUTO_APPROVED_PRICE: 'NO_EXACT_AUTO_APPROVED_PRICE',
  MULTIPLE_OR_BUNDLE_SOURCE_CONTEXT: 'BUNDLE_OR_MULTIPLE_CONTEXT',
  PARSER_BUNDLE_PRICE_AMBIGUITY: 'BUNDLE_OR_MULTIPLE_CONTEXT',
  IMPLAUSIBLE_HKD_1_TO_3: 'IMPLAUSIBLE_HKD',
  DATED_FX_UNAVAILABLE: 'AED_WITHOUT_APPROVED_FX',
}[reason] || 'PRICE_CURRENCY_REVIEW');

function syntaxPattern(raw, reference) {
  const lines = String(raw || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const key = refKey(reference);
  const refLines = lines.filter(line => refKey(line).includes(key));
  const candidates = extractPriceCandidates(raw);
  if (AED_LITERAL.test(raw)) return refLines.some(line => AED_LITERAL.test(line)) ? 'REF_AND_AED_AMOUNT_SAME_LINE' : 'AED_IN_SHARED_OR_ADJACENT_CONTEXT';
  if (AED_ALIAS.test(raw)) return 'DIRHAM_ALIAS_WITHOUT_LITERAL_AED';
  if (candidates.length > 1) return refLines.length === 1 ? 'ONE_REF_LINE_WITH_MULTIPLE_MESSAGE_PRICES' : 'MULTIPLE_REF_OR_PRICE_LINES';
  if (/\$\s*\d|\d\s*\$/i.test(raw) && !/(?:USD|USDT)/i.test(raw)) return 'BARE_DOLLAR_AMOUNT';
  if (SUPPORTED_LITERAL.test(raw) || SYMBOL_CURRENCY.test(raw)) return refLines.length === 1 ? 'REF_AND_NAMED_CURRENCY_CONTEXT' : 'NAMED_CURRENCY_WITHOUT_UNIQUE_REF_LINE';
  if (/\d[\d,.]{2,}/.test(raw)) return 'UNLABELED_NUMERIC_AMOUNT';
  return 'NO_DETERMINISTIC_PRICE_SYNTAX';
}

function deterministicLineAssociation(row) {
  const raw = String(row.raw_message || '');
  const key = refKey(row.reference_normalized);
  const lines = raw.split(/\r?\n/).map((text, index) => ({ text: text.trim(), index })).filter(line => line.text);
  const target = lines.filter(line => refKey(line.text).includes(key));
  if (target.length !== 1) return { recoverable: false, reason: target.length ? 'REFERENCE_LINE_NOT_UNIQUE' : 'REFERENCE_LINE_ABSENT' };
  const line = target[0].text;
  if (BUNDLE_WORD.test(line)) return { recoverable: false, reason: 'TARGET_LINE_HAS_BUNDLE_GRAMMAR' };
  if (!EXPLICIT_CURRENCY.test(line)) return { recoverable: false, reason: 'TARGET_LINE_LACKS_EXPLICIT_CURRENCY' };
  const candidates = extractPriceCandidates(line);
  const observations = extractPriceObservations(line);
  if (candidates.length !== 1 || observations.length !== 1 || observations[0].evidence_status !== 'AUTO_APPROVED') {
    return { recoverable: false, reason: 'TARGET_LINE_NOT_SINGLE_AUTO_APPROVED_PRICE' };
  }
  const observation = observations[0];
  const currency = String(observation.currency_original || '').toUpperCase();
  if (currency === 'HKD' && Number(observation.amount_original) <= 3 && !MULTIPLIER.test(line)) {
    return { recoverable: false, reason: 'IMPLAUSIBLE_HKD_WITHOUT_EXPLICIT_MULTIPLIER' };
  }
  if (currency === 'AED') {
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(row.source_created_on || ''))) {
      return { recoverable: false, reason: 'AED_SOURCE_DATE_MISSING' };
    }
    return { recoverable: true, conditional: 'APPROVED_DATED_AED_FX_REQUIRED', currency };
  }
  return { recoverable: true, conditional: null, currency };
}

function classifyRows(rows, fx) {
  return rows.map(row => {
    const baseline = classify(row, fx);
    const blocker = reasonToClass(baseline.reason);
    const remediation = deterministicLineAssociation(row);
    return { listing_id: row.listing_id, blocker, pattern: syntaxPattern(row.raw_message, row.reference_normalized), remediation };
  });
}

function tally(rows) {
  const out = {};
  for (const row of rows) {
    out[row.blocker] ||= { screened: 0, recoverable: 0, conditional_aed_fx: 0, review_only: 0, patterns: {} };
    const b = out[row.blocker]; b.screened += 1;
    b.patterns[row.pattern] = (b.patterns[row.pattern] || 0) + 1;
    if (row.remediation.recoverable) {
      b.recoverable += 1;
      if (row.remediation.conditional) b.conditional_aed_fx += 1;
    } else b.review_only += 1;
  }
  return out;
}

function main() {
  const repo = path.resolve(__dirname, '../..');
  const read = file => JSON.parse(fs.readFileSync(path.join(repo, file), 'utf8'));
  const privatePath = name => {
    if (!process.env[name]) throw new Error(`${name} is required and must point to an authorized temporary private input`);
    return path.resolve(process.env[name]);
  };
  const p4b = read('audit-output/phase4b-rolex-wts-price-research-canary/discovery.json');
  const p4c = read('audit-output/phase4c-rolex-safe-wts-discovery/discovery.json');
  const samplePath = privatePath('PHASE5A_PHASE4B_SAMPLE');
  const supportedPath = privatePath('PHASE5A_PHASE4C_SUPPORTED');
  const aedPath = privatePath('PHASE5A_AED_COHORT');
  const sampleInput = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
  const supportedInput = JSON.parse(fs.readFileSync(supportedPath, 'utf8'));
  const aedInput = JSON.parse(fs.readFileSync(aedPath, 'utf8'));
  for (const input of [sampleInput, supportedInput, aedInput]) {
    if (input.read_only !== true || input.transaction_read_only !== 'on') throw new Error('Read-only envelope missing');
  }

  const fx = p4c.fx_snapshot;
  const p4bSample = classifyRows(sampleInput.rows, fx);
  const supportedCurrentRows = supportedInput.rows.filter(row => SUPPORTED_LITERAL.test(row.raw_message));
  const supportedCurrent = classifyRows(supportedCurrentRows, fx);
  const supportedIds = new Set(supportedCurrentRows.map(row => row.listing_id));
  const literalAedRows = aedInput.rows.filter(row => AED_LITERAL.test(row.raw_message));
  const aedOnlyRows = literalAedRows.filter(row => !supportedIds.has(row.listing_id));
  const aedOnly = classifyRows(aedOnlyRows, fx);
  const aliasOnlyRows = aedInput.rows.filter(row => !AED_LITERAL.test(row.raw_message) && AED_ALIAS.test(row.raw_message));
  const aliasOnly = classifyRows(aliasOnlyRows, fx);

  const exactP4b = {
    PRICE_CURRENCY_REVIEW: p4b.review_reasons.PRICE_OR_CURRENCY_REQUIRES_REVIEW,
    MULTIPLE_PRICE_AMBIGUITY: p4b.review_reasons.MULTIPLE_PRICE_CANDIDATES,
    NO_EXACT_AUTO_APPROVED_PRICE: p4b.unresolved_reasons.NO_EXACT_AUTO_APPROVED_PRICE,
    BUNDLE_OR_MULTIPLE_CONTEXT: p4b.review_reasons.MULTIPLE_OR_BUNDLE_SOURCE_CONTEXT + p4b.review_reasons.PARSER_BUNDLE_PRICE_AMBIGUITY,
    IMPLAUSIBLE_HKD: p4b.dated_fx_unavailable_breakdown.HKD_1_TO_3_CONVERTED_TO_ZERO_USD,
    AED_WITHOUT_APPROVED_FX: p4b.dated_fx_unavailable_breakdown.AED,
  };
  const exactFrozenP4c = {
    PRICE_CURRENCY_REVIEW: p4c.reasons.PRICE_OR_CURRENCY_REQUIRES_REVIEW,
    MULTIPLE_PRICE_AMBIGUITY: p4c.reasons.MULTIPLE_PRICE_CANDIDATES,
    NO_EXACT_AUTO_APPROVED_PRICE: p4c.reasons.NO_EXACT_AUTO_APPROVED_PRICE,
    BUNDLE_OR_MULTIPLE_CONTEXT: p4c.reasons.MULTIPLE_OR_BUNDLE_SOURCE_CONTEXT + p4c.reasons.PARSER_BUNDLE_PRICE_AMBIGUITY,
    IMPLAUSIBLE_HKD: p4c.reasons.IMPLAUSIBLE_HKD_1_TO_3,
    AED_WITHOUT_APPROVED_FX: 0,
  };
  const aedOnlyTally = tally(aedOnly);
  const distribution = {};
  for (const blocker of Object.keys(exactP4b)) {
    distribution[blocker] = exactP4b[blocker] + exactFrozenP4c[blocker] + (aedOnlyTally[blocker]?.screened || 0);
  }

  const sampleTally = tally(p4bSample);
  const currentSupplementTally = tally([...supportedCurrent, ...aedOnly]);
  const remediation = {};
  const policy = {
    PRICE_CURRENCY_REVIEW: { deterministic_remediation_possible: false, human_review_required: true, parser_change_required: false, false_positive_risk: 'HIGH' },
    MULTIPLE_PRICE_AMBIGUITY: { deterministic_remediation_possible: false, human_review_required: true, parser_change_required: true, false_positive_risk: 'HIGH' },
    NO_EXACT_AUTO_APPROVED_PRICE: { deterministic_remediation_possible: false, human_review_required: true, parser_change_required: false, false_positive_risk: 'CRITICAL' },
    BUNDLE_OR_MULTIPLE_CONTEXT: { deterministic_remediation_possible: false, human_review_required: true, parser_change_required: true, false_positive_risk: 'HIGH' },
    IMPLAUSIBLE_HKD: { deterministic_remediation_possible: true, human_review_required: true, parser_change_required: true, false_positive_risk: 'MEDIUM_WHEN_EXPLICIT_MULTIPLIER_ELSE_HIGH' },
    AED_WITHOUT_APPROVED_FX: { deterministic_remediation_possible: true, human_review_required: true, parser_change_required: true, false_positive_risk: 'MEDIUM_WHEN_EXACT_LINE_AND_DATED_OFFICIAL_FX_ELSE_HIGH' },
  };
  for (const blocker of Object.keys(distribution)) {
    const s = sampleTally[blocker] || { screened: 0, recoverable: 0, conditional_aed_fx: 0, patterns: {} };
    const rate = s.screened ? s.recoverable / s.screened : 0;
    const p4bEstimate = Math.round(exactP4b[blocker] * rate);
    const supplementExact = currentSupplementTally[blocker]?.recoverable || 0;
    const recoverableEstimate = p4bEstimate + supplementExact;
    const patterns = { ...(s.patterns || {}) };
    for (const [pattern, count] of Object.entries(currentSupplementTally[blocker]?.patterns || {})) patterns[pattern] = (patterns[pattern] || 0) + count;
    remediation[blocker] = {
      ...policy[blocker],
      total_rows: distribution[blocker],
      phase4b_exact_rows: exactP4b[blocker],
      phase4c_frozen_rows: exactFrozenP4c[blocker],
      aed_only_exact_rows: aedOnlyTally[blocker]?.screened || 0,
      phase4b_sample_rows: s.screened,
      phase4b_sample_recoverable: s.recoverable,
      phase4b_estimated_recoverable: p4bEstimate,
      current_supplement_exact_recoverable: supplementExact,
      estimated_recoverable_wts: recoverableEstimate,
      estimated_review_or_unresolved: Math.max(0, distribution[blocker] - recoverableEstimate),
      source_syntax_patterns: Object.entries(patterns)
        .sort((a,b) => b[1] - a[1]).slice(0, 6).map(([pattern, count]) => ({ pattern, observed_in_bounded_evidence: count })),
    };
  }

  const totalRows = Object.values(distribution).reduce((a,b) => a+b, 0);
  const recoverable = Object.values(remediation).reduce((a,b) => a+b.estimated_recoverable_wts, 0);
  const observedRecoverable = Object.values(sampleTally).reduce((a,b) => a+b.recoverable, 0)
    + Object.values(currentSupplementTally).reduce((a,b) => a+b.recoverable, 0);
  const permanentlyUnresolved = remediation.NO_EXACT_AUTO_APPROVED_PRICE.estimated_review_or_unresolved;
  const reviewOnly = totalRows - recoverable - permanentlyUnresolved;
  const output = {
    contract: 'watchfacts-phase5a-rolex-price-evidence-remediation-v1',
    generated_at: new Date().toISOString(), read_only: true, production_writes: 0,
    evidence_standard_relaxed: false, raw_messages_exported: false, contact_values_exported: false,
    population: {
      exact_known_union_rows: totalRows,
      phase4b_exact_rows: p4b.population.wts_missing_usd,
      phase4c_frozen_supported_rows: p4c.input.rows,
      phase4c_literal_aed_rows: literalAedRows.length,
      phase4c_aed_overlap_with_current_supported_rows: literalAedRows.length - aedOnlyRows.length,
      phase4c_aed_only_rows: aedOnlyRows.length,
      current_supported_marker_rows: supportedCurrentRows.length,
      supported_marker_drift_from_frozen_cohort: supportedCurrentRows.length - p4c.input.rows,
      dirham_alias_only_rows_not_promoted: aliasOnlyRows.length,
      deterministic_phase4b_sample_rows: sampleInput.rows.length,
      deterministic_phase4b_sample_method: sampleInput.sampling,
    },
    blocker_distribution: distribution,
    remediation,
    totals: {
      recoverable_by_rule_estimate: recoverable,
      recoverable_by_rule_observed_in_bounded_evidence: observedRecoverable,
      review_only_estimate: reviewOnly,
      permanently_unresolved_absent_new_source_evidence: permanentlyUnresolved,
      automatically_correctable_now: 0,
    },
    alias_only: { rows: aliasOnlyRows.length, classification: 'REVIEW_ONLY', reason: 'DIRHAM_ALIAS_IS_NOT_LITERAL_AED_AND_CANNOT_DEFINE_COUNTRY_OR_FX_SERIES' },
    decision: 'ROLEX_AUTOMATIC_WTS_CORRECTIONS_REMAIN_BLOCKED',
    private_inputs_sha256: {
      phase4b_sample: sha256(fs.readFileSync(samplePath)),
      phase4c_supported: sha256(fs.readFileSync(supportedPath)),
      aed: sha256(fs.readFileSync(aedPath)),
    },
  };
  const outDir = path.join(repo, 'audit-output/phase5a-rolex-price-evidence-remediation');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'audit.json'), `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ population: output.population, distribution, totals: output.totals, decision: output.decision }, null, 2)}\n`);
}

if (require.main === module) main();
module.exports = { deterministicLineAssociation, syntaxPattern, reasonToClass };

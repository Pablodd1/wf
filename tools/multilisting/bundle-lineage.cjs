'use strict';

// PHASE 7 BUNDLE LINEAGE - deterministic child derivation on top of the
// existing v4 parser (segmentDealerMessage via analyzeRecord). Pure and
// read-only: it never mutates the parent source record and never writes
// anywhere. Every child carries:
//   - deterministic child ID from (parent source ID, parent source hash, child ordinal)
//   - exact line/span coordinates inside the parent raw message
//   - child evidence hash
//   - parser / ruleset version
//   - explicitly recorded inherited section context
//   - independent intent / identity / price decisions copied from NO sibling
// Children never receive the parent image; they stay PENDING_REVIEW until an
// acceptance step that this phase deliberately does not perform.

const { analyzeRecord } = require('../shadow-reprocess/shadow-reprocess.cjs');
const { segmentDealerMessage } = require('../../api/_lib/normalization-v4.cjs');
const { multiItemRisk } = require('../../api/_lib/unsplit-bundle-filter.cjs');
const {
  VERSION: PARSER_VERSION,
  deterministicUuid,
  exactLineage,
  fingerprint,
  normalizedLine,
  primaryPrice,
  reviewFlags,
} = require('./bundle-cohort.cjs');

const RULESET_VERSION = 'phase7-bundle-lineage-v1';

// Fixed synthetic FX snapshot so amount_usd is deterministic in the canary.
// Clearly labelled; never usable against real data.
const SYNTHETIC_FX = {
  observed_at: '2026-08-30T00:00:00.000Z',
  source: 'phase7-synthetic-fixed-fx',
  usd_per_unit: { HKD: 0.128, EUR: 1.09, CNY: 0.14, SGD: 0.74, USD: 1, USDT: 1 },
};

function parentSourceHash(source) {
  return fingerprint({ id: source.id, raw_message: normalizedLine(source.raw_message) });
}

// Locate the n-th occurrence (0-based among identical sibling lines) of the
// trimmed child line inside the parent raw message. Exact coordinates or null;
// offsets are never guessed.
function locateSpan(rawMessage, rawLine, occurrence) {
  const haystack = String(rawMessage || '').replace(/\r\n?/g, '\n').replace(/_x000D_/gi, '\n');
  const needle = normalizedLine(rawLine);
  if (!needle) return null;
  let from = 0;
  let seen = -1;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return null;
    seen += 1;
    if (seen === occurrence) return { start: at, end: at + needle.length };
    from = at + needle.length;
  }
}

function sectionContext(context) {
  const inherited = {};
  for (const key of ['brand_context', 'currency_context', 'condition_context', 'set_status_context', 'listing_status_context', 'intent_context']) {
    inherited[key] = context?.[key] ?? null;
  }
  return inherited;
}

function childEvidenceHash(parts) {
  return fingerprint({
    parent_source_id: parts.parent_source_id,
    parent_source_hash: parts.parent_source_hash,
    child_ordinal: parts.child_ordinal,
    raw_line: parts.raw_line,
    span_start: parts.span?.start ?? null,
    span_end: parts.span?.end ?? null,
  });
}

function priceResearchEligible(child) {
  return child.listing_type === 'WTS'
    && child.exact_raw_lineage === true
    && Number(child.price_usd) > 0
    && Boolean(child.currency)
    && child.price_review_reasons.length === 0
    && !child.flags.includes('AMBIGUOUS_REFERENCE_LINE');
}

function tradingFloorEligible(child) {
  // A Trading Floor offer needs identity and intent; a price is NOT required
  // (unpriced WTS children stay visible for review but are PR-ineligible).
  return child.exact_raw_lineage === true
    && Boolean(child.brand)
    && Boolean(child.reference)
    && (child.listing_type === 'WTS' || child.listing_type === 'WTB');
}

function buildLineageChildren(source, options = {}) {
  const sourceHash = parentSourceHash(source);
  const fxSnapshot = options.fxSnapshot === undefined ? SYNTHETIC_FX : options.fxSnapshot;
  const shadow = options.shadow || analyzeRecord(source, { fxSnapshot });
  const segments = segmentDealerMessage(
    source.raw_message || '',
    ['WTB', 'WTS'].includes(String(source.listing_type || '').toUpperCase())
      ? { intent_context: String(source.listing_type).toUpperCase() }
      : {},
  );
  const proposed = Array.isArray(shadow.proposed_candidates) ? shadow.proposed_candidates : [];
  if (segments.length !== proposed.length) {
    throw new Error(`segment/proposed mismatch for parent ${source.id}: ${segments.length} != ${proposed.length}`);
  }

  const occurrenceByLine = new Map();
  return proposed.map((candidate, index) => {
    const segment = segments[index];
    if (normalizedLine(segment.rawLine) !== normalizedLine(candidate.raw_line)) {
      throw new Error(`raw line mismatch at ordinal ${index + 1} for parent ${source.id}`);
    }
    const rawLine = normalizedLine(candidate.raw_line);
    const occurrence = occurrenceByLine.get(rawLine) || 0;
    occurrenceByLine.set(rawLine, occurrence + 1);
    const span = locateSpan(source.raw_message, rawLine, occurrence);
    const ordinal = index + 1;
    const lineage = exactLineage(source.raw_message, rawLine) && span !== null;

    const lineRisk = multiItemRisk(rawLine);
    const flags = reviewFlags(candidate, source.raw_message);
    if (lineRisk.references.length > 1) flags.push('AMBIGUOUS_REFERENCE_LINE');
    if (!lineage && !flags.includes('RAW_LINEAGE_MISSING')) flags.push('RAW_LINEAGE_MISSING');

    const price = primaryPrice(candidate);
    const child = {
      child_id: deterministicUuid(`${RULESET_VERSION}|${source.id}|${sourceHash}|${ordinal}`),
      parent_source_id: source.id,
      parent_source_hash: sourceHash,
      child_ordinal: ordinal,
      raw_line: rawLine,
      span,
      parser_version: PARSER_VERSION,
      ruleset_version: RULESET_VERSION,
      inherited_section_context: sectionContext(segment.context),
      brand: candidate.brand || null,
      reference: candidate.reference || null,
      dial_color: candidate.dial_color || null,
      condition: candidate.condition || null,
      listing_type: candidate.listing_type || 'WTS',
      price_raw: price?.amount_original ?? null,
      price_usd: price?.amount_usd ?? null,
      currency: price?.currency_original ?? null,
      currency_evidence: price?.currency_evidence ?? null,
      price_review_reasons: candidate.price_review_reasons || [],
      exact_raw_lineage: lineage,
      image: null, // parent images are never inherited; only exact attachment evidence may set this later
      flags: [...new Set(flags)],
      review_state: 'PENDING_REVIEW',
    };
    child.evidence_hash = childEvidenceHash(child);
    child.price_research_eligible = priceResearchEligible(child);
    child.trading_floor_eligible = tradingFloorEligible(child);
    return child;
  });
}

module.exports = {
  RULESET_VERSION,
  SYNTHETIC_FX,
  buildLineageChildren,
  locateSpan,
  parentSourceHash,
  priceResearchEligible,
  tradingFloorEligible,
};

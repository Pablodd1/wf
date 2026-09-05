'use strict';

const BLOCKING_FLAGS = new Set([
  'BUNDLE_SPLIT_REQUIRED',
  'NO_CANDIDATE',
  'CURRENCY_AMBIGUOUS',
  'PRICE_PARSE_FAILED',
  'EMOJI_PRICE_AMBIGUOUS',
  'DIAL_AMBIGUOUS',
]);

const ACCEPTABLE_CURRENCY_EVIDENCE = new Set([
  'explicit_line_currency',
  'section_context',
  'message_context',
]);

function buildPromotionDecision(shadowRow, catalogConfirmation = null) {
  const flags = new Set(shadowRow.change_flags || []);
  const candidate = shadowRow.candidate_count === 1
    ? shadowRow.proposed_candidates?.[0]
    : null;

  if ([...flags].some(flag => BLOCKING_FLAGS.has(flag))) {
    return {
      disposition: 'HUMAN_REVIEW',
      reasons: [...flags].filter(flag => BLOCKING_FLAGS.has(flag)),
      candidate: null,
    };
  }

  if (!candidate?.reference || !candidate?.brand) {
    return {
      disposition: 'HUMAN_REVIEW',
      reasons: ['CATALOG_IDENTITY_INCOMPLETE'],
      candidate: null,
    };
  }

  const primaryPrice = candidate.prices?.find(price => price.is_primary) || candidate.prices?.[0] || null;
  const candidateIntent = String(candidate.listing_type || shadowRow.source_listing_type || '').toUpperCase();
  if (candidateIntent !== 'WTB') {
    if (!primaryPrice?.amount_original || !primaryPrice.currency_original) {
      return {
        disposition: 'HUMAN_REVIEW',
        reasons: ['ASK_PRICE_INCOMPLETE'],
        candidate: null,
      };
    }
    if (!ACCEPTABLE_CURRENCY_EVIDENCE.has(primaryPrice.currency_evidence)) {
      return {
        disposition: 'HUMAN_REVIEW',
        reasons: ['CURRENCY_EVIDENCE_INSUFFICIENT'],
        candidate: null,
      };
    }
  }

  if (catalogConfirmation) {
    if (!catalogConfirmation.confirmed) {
      return {
        disposition: 'HUMAN_REVIEW',
        reasons: [catalogConfirmation.reason],
        candidate: null,
        catalog: catalogConfirmation.match || null,
      };
    }
    if (flags.has('DIAL_CHANGED') && catalogConfirmation.dialConfirmed !== true) {
      return {
        disposition: 'HUMAN_REVIEW',
        reasons: [catalogConfirmation.dialReason || 'CATALOG_DIAL_UNCONFIRMED'],
        candidate: null,
        catalog: catalogConfirmation.match || null,
      };
    }
    return {
      disposition: 'READY_FOR_HUMAN_APPROVAL',
      reasons: ['CATALOG_CONFIRMED'],
      candidate,
      catalog: catalogConfirmation.match,
    };
  }

  // A catalog match must be recorded before this can become an approved live
  // change. This policy deliberately stops one gate before mutation.
  return {
    disposition: 'CATALOG_CONFIRMATION_REQUIRED',
    reasons: ['CATALOG_MATCH_REQUIRED'],
    candidate,
  };
}

module.exports = { buildPromotionDecision };

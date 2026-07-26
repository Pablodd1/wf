'use strict';

const { analyzeRecord } = require('../shadow-reprocess/shadow-reprocess.cjs');
const { segmentDealerMessage } = require('../../api/_lib/normalization-v4.cjs');

function likelyBundle(rowOrRaw) {
  const row = typeof rowOrRaw === 'object' && rowOrRaw !== null ? rowOrRaw : {};
  const text = String(typeof rowOrRaw === 'string' ? rowOrRaw : row.raw_message || '');
  const flags = Array.isArray(row.flags) ? row.flags : [];
  const shadowCandidateCount = Number(row.shadow_candidate_count ?? row.candidate_count ?? 0);
  if (
    row.listing_type === 'MULTI'
    || flags.includes('BUNDLE_SPLIT_REQUIRED')
    || shadowCandidateCount > 1
  ) return true;

  // Reuse the production deterministic segmenter so concise two-watch
  // messages are review material even when they have only two lines.
  if (segmentDealerMessage(text).length > 1) return true;

  // Retain the conservative legacy envelope gate when segmentation cannot yet
  // produce children. Such rows remain unresolved instead of being presented
  // as a safe single listing.
  const refs = text.match(/\b\d{3,6}(?:\/[0-9A-Z-]{1,12})?(?:-[0-9A-Z]{1,8})?\b/gi) || [];
  return new Set(refs.map(value => value.toUpperCase())).size >= 3 || text.split(/\r?\n/).filter(Boolean).length >= 8;
}

function auditCandidates(row, bundleRisk = likelyBundle(row)) {
  if (!bundleRisk) return [{ ...row, bundle_parent_id: null, bundle_candidate_index: null }];
  const analyzed = analyzeRecord(row);
  if (analyzed.candidate_count < 2) return [];
  return analyzed.proposed_candidates.map((candidate, index) => ({
    ...row,
    id: `${row.id}#${index + 1}`,
    brand: candidate.brand || row.brand,
    reference: candidate.reference || null,
    dial_color: candidate.dial_color || null,
    condition: candidate.condition || row.condition,
    price_usd: candidate.price_usd || null,
    currency: candidate.currency || null,
    listing_type: candidate.listing_type || row.listing_type,
    raw_message: candidate.raw_line,
    bundle_parent_id: row.id,
    bundle_candidate_index: index + 1,
  }));
}

module.exports = { auditCandidates, likelyBundle };

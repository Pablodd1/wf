'use strict';

const { createHash } = require('node:crypto');
const { comparisonKey, normalizeDialValue } = require('../../api/_lib/dial-normalization.cjs');

const VERSION = 'v4.3-mint-condition';
const ADJACENT_DIAL_TERMS = [
  'white mother of pearl', 'black mother of pearl', 'mother of pearl', 'reverse panda',
  'tiffany blue', 'tiffany', 'ombre green', 'ice blue', 'olive green', 'sunburst blue',
  'sunburst black', 'champagne', 'meteorite', 'skeleton', 'salmon', 'chocolate',
  'yellow mother of pearl', 'candy pink', 'pistachio', 'wimbledon', 'sundust',
  'celebration', 'aventurine', 'eisenkiesel', 'carnelian', 'multicolour',
  'rainbow', 'rhodium', 'ivory', 'puzzle', 'coffee', 'smoke', 'zebra', 'onyx',
  'paved', 'pave', 'opal', 'tiffani', 'tiffini', 'tiff', 'champ', 'mete',
  'pistschio', 'pistacho', 'pista', 'wimbeldon', 'wimb', 'wim', 'cele',
  'celeb', 'ombr', 'omber', 'aventuine', 'eisenkissel', 'eisikinsell',
  'ralnbow', 'sliver', 'greenn', 'greeen', 'gery', 'yml', 'blk', 'grn',
  'wht', 'blu', 'bk', 'tb', 'pis',
  'anthracite', 'burgundy', 'lavender', 'turquoise', 'panda', 'copper', 'bronze',
  'silver', 'black', 'blue', 'white', 'grey', 'gray', 'green', 'brown', 'pink',
  'purple', 'yellow', 'orange', 'red', 'gold', 'beige', 'slate', 'diamond',
  'choco', 'mop',
].sort((left, right) => right.length - left.length);

function normalizedLine(value) {
  return String(value || '').replace(/\r\n?/g, '\n').trim();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function deterministicUuid(value) {
  const bytes = Buffer.from(createHash('sha256').update(String(value)).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function exactLineage(parentRawMessage, candidateRawLine) {
  const parent = normalizedLine(parentRawMessage);
  const child = normalizedLine(candidateRawLine);
  return Boolean(child && parent.includes(child));
}

function primaryPrice(candidate) {
  const prices = Array.isArray(candidate?.prices) ? candidate.prices : [];
  return prices.find(price => price?.is_primary) || prices[0] || null;
}

function adjacentDialClaim(rawLine, reference) {
  if (!rawLine || !reference) return null;
  const escapedReference = String(reference).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(rawLine).match(new RegExp(`(?:^|\\s)${escapedReference}(?:\\s|$)(.*)$`, 'i'));
  if (!match) return null;
  const tail = match[1].trim().toLowerCase();
  const term = ADJACENT_DIAL_TERMS.find(value => new RegExp(`^${value.replace(/\s+/g, '\\s+')}\\b`, 'i').test(tail));
  return term ? normalizeDialValue(term).value : null;
}

function specialDialClaim(rawLine) {
  const source = String(rawLine || '');
  if (/\btiffany(?:\s+blue)?\b/i.test(source)) return 'Tiffany Blue';
  return null;
}

function reviewFlags(candidate, parentRawMessage) {
  const flags = ['BUNDLE_CHILD_CANARY'];
  if (!exactLineage(parentRawMessage, candidate?.raw_line)) flags.push('RAW_LINEAGE_MISSING');
  if (!candidate?.brand) flags.push('BRAND_REQUIRED');
  if (!candidate?.reference) flags.push('REFERENCE_REQUIRED');
  if (!candidate?.dial_color || /^(?:unknown|unresolved|n\/a)$/i.test(candidate.dial_color)) {
    flags.push('DIAL_REQUIRED');
  }
  if (candidate?.dial_ambiguous) flags.push('DIAL_AMBIGUOUS');

  const listingType = String(candidate?.listing_type || 'WTS').toUpperCase();
  const price = primaryPrice(candidate);
  if (listingType === 'WTS') {
    if (!price?.amount_original || !price?.currency_original) flags.push('PRICE_REQUIRED');
    if (price?.amount_usd && price.amount_usd < 500) flags.push('PRICE_PLAUSIBILITY_REVIEW');
    if (price?.currency_evidence === 'source_record_currency') flags.push('CURRENCY_REVIEW_REQUIRED');
  }
  return flags;
}

function buildStagingChildren(source, shadow, options = {}) {
  const candidates = Array.isArray(shadow?.proposed_candidates) ? shadow.proposed_candidates : [];
  const batchId = deterministicUuid(options.batchKey || `bundle-canary:${VERSION}`);
  return candidates.map((candidate, index) => {
    const childIndex = index + 1;
    const rawLine = normalizedLine(candidate.raw_line);
    const price = primaryPrice(candidate);
    const rawDialClaim = adjacentDialClaim(rawLine, candidate.reference);
    const dialConflict = rawDialClaim && candidate.dial_color
      && comparisonKey(rawDialClaim) !== comparisonKey(candidate.dial_color);
    const stagedCandidate = rawDialClaim ? { ...candidate, dial_color: rawDialClaim } : candidate;
    const flags = reviewFlags(stagedCandidate, source?.raw_message).concat(
      dialConflict ? ['DIAL_RAW_SOURCE_CONFLICT'] : [],
      [
      `BUNDLE_PARENT:${source.id}`,
      `BUNDLE_INDEX:${childIndex}`,
      ],
    );
    return {
      id: deterministicUuid(`${VERSION}:${source.id}:${childIndex}:${rawLine}`),
      batch_id: batchId,
      raw_message: rawLine,
      brand: candidate.brand || null,
      reference: candidate.reference || null,
      dial_color: stagedCandidate.dial_color || null,
      condition: candidate.condition || null,
      price_raw: price?.amount_original || null,
      price_usd: price?.amount_usd || null,
      currency: price?.currency_original || null,
      source: `bundle_child:${source.id}`,
      confidence: 0,
      verdict: 'PENDING',
      parser_version: `${VERSION}-bundle-child-canary`,
      listing_type: candidate.listing_type || shadow.source_listing_type || source.listing_type || 'WTS',
      human_edited: false,
      flags,
      field_confidence: {
        bundle_parent_id: source.id,
        bundle_candidate_index: childIndex,
        exact_raw_lineage: exactLineage(source.raw_message, rawLine),
        normalization_version: VERSION,
        dial_evidence: rawDialClaim ? 'exact_raw_adjacent_to_reference' : candidate.dial_evidence || null,
        source_dial_color: candidate.dial_color || null,
        raw_dial_claim: rawDialClaim,
        currency_evidence: price?.currency_evidence || null,
      },
    };
  });
}

function comparePersisted(expected, actual) {
  if (!actual) return { matches: false, reason: 'MISSING_PERSISTED_ROW' };
  const expectedCore = {
    normalization_version: expected.normalization_version,
    candidate_count: expected.candidate_count,
    proposed_candidates: expected.proposed_candidates,
    change_flags: expected.change_flags,
  };
  const actualCore = {
    normalization_version: actual.normalization_version,
    candidate_count: actual.candidate_count,
    proposed_candidates: actual.proposed_candidates,
    change_flags: actual.change_flags,
  };
  const matches = fingerprint(expectedCore) === fingerprint(actualCore);
  return { matches, reason: matches ? null : 'PERSISTED_CONTENT_MISMATCH' };
}

module.exports = {
  VERSION,
  adjacentDialClaim,
  buildStagingChildren,
  comparePersisted,
  deterministicUuid,
  exactLineage,
  fingerprint,
  normalizedLine,
  primaryPrice,
  reviewFlags,
  specialDialClaim,
};

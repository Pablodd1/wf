'use strict';

const crypto = require('node:crypto');
const { explicitIntent, segmentDealerMessage } = require('../../api/_lib/normalization-v4.cjs');

const INVALID_CLASSIFICATIONS = new Set([
  'REPEATED_IDENTICAL_OFFER',
  'NON_WATCH_FRAGMENT',
  'FIELD_ONLY_FRAGMENT',
  'AMBIGUOUS_CHILD_BOUNDARY',
  'UNSPLITTABLE_PARENT',
  'REVIEW_REQUIRED',
]);
const HUMAN_REVIEW_CLASSIFICATIONS = new Set([
  'AMBIGUOUS_CHILD_BOUNDARY', 'UNSPLITTABLE_PARENT', 'REVIEW_REQUIRED',
]);

function sha256(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

function normalizeStructuralText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/^\s*[-*•▪◦‣⁃]+\s*/u, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/(?<=\d)[,.](?=\d)/g, '')
    .replace(/[\s\p{P}]+/gu, ' ')
    .trim();
}

function locateOccurrence(rawText, childText, cursor = 0) {
  const source = String(rawText ?? '');
  const child = String(childText ?? '');
  let start = source.indexOf(child, cursor);
  if (start < 0) start = source.indexOf(child);
  return { start, end: start < 0 ? -1 : start + child.length,
    next_cursor: start < 0 ? cursor : start + child.length };
}

function lineNumberAt(rawText, offset) {
  if (offset < 0) return null;
  return String(rawText ?? '').slice(0, offset).split(/\r?\n/).length;
}

function quantityMarker(text) {
  const match = String(text ?? '').match(/\b(?:qty|quantity)\s*[:x-]?\s*(\d+)|\b(\d+)\s*(?:pcs?|pieces?|units?|watches?)\b|\bx\s*(\d+)\b/i);
  if (!match) return null;
  const count = Number(match[1] || match[2] || match[3]);
  return Number.isInteger(count) && count > 1 ? { text: match[0], count } : null;
}

function serialMarker(text) {
  const match = String(text ?? '').match(/\b(?:serial|s\/?n|case\s*no\.?|piece\s*no\.?)\s*[:#-]?\s*([a-z0-9-]{3,})\b/i);
  return match ? match[0] : null;
}

function conditionEvidence(text) {
  return String(text ?? '').match(/\b(?:brand\s+new|like\s+new|pre[\s-]?owned|unworn|used|mint|excellent|slider|nos|lnib|bnib)\b/i)?.[0] || null;
}

function dialOrColorEvidence(text) {
  return String(text ?? '').match(/\b(?:black|white|blue|green|red|silver|gold|champagne|salmon|panda|grey|gray|brown)\s*(?:dial)?\b/i)?.[0] || null;
}

function evidenceFlags(child, rawData = {}) {
  const text = String(child.raw_child_text ?? '');
  const explicitLineIntent = explicitIntent(text);
  const sourceType = String(rawData.type || '').toLowerCase();
  const intent = explicitLineIntent || (['sale', 'wts'].includes(sourceType) ? 'WTS'
    : ['search', 'wtb', 'ntq'].includes(sourceType) ? 'WTB' : null);
  return {
    has_reference: Boolean(child.observed_reference_key),
    has_price: Number(child.source_price_amount) > 0,
    has_currency: Boolean(child.source_currency),
    has_intent: Boolean(intent),
    has_condition: /\b(?:new|unworn|used|pre[\s-]?owned|mint|excellent|slider|nos|lnib|bnib)\b/i.test(text),
    has_dial_or_color: /\b(?:dial|black|white|blue|green|red|silver|gold|champagne|salmon|panda|grey|gray|brown)\b/i.test(text),
    has_year: /\b(?:19|20)\d{2}\b/.test(text),
    has_box_papers: /\b(?:box|papers?|certificate|card|full\s+set|watch\s+only)\b/i.test(text),
    has_watch_descriptor: /\b(?:rolex|patek|philippe|watch|daytona|submariner|gmt|datejust|aquanaut|nautilus|calatrava|complication)\b/i.test(text),
    quantity: quantityMarker(text),
    serial: serialMarker(text),
    intent,
  };
}

function validityClassification(child, rawData = {}) {
  const text = String(child.raw_child_text ?? '').trim();
  if (!text) return { classification: 'NON_WATCH_FRAGMENT', flags: evidenceFlags(child, rawData) };
  const flags = evidenceFlags(child, rawData);
  if (!flags.has_reference) {
    const fieldOnly = flags.has_price || flags.has_currency || flags.has_condition || flags.has_year;
    return { classification: fieldOnly ? 'FIELD_ONLY_FRAGMENT' : 'NON_WATCH_FRAGMENT', flags };
  }
  const parsedAgain = segmentDealerMessage(text);
  if (parsedAgain.length > 1) return { classification: 'AMBIGUOUS_CHILD_BOUNDARY', flags };
  const offerEvidence = flags.has_price || flags.has_currency || flags.has_condition
    || flags.has_dial_or_color || flags.has_year || flags.has_box_papers
    || flags.has_watch_descriptor || flags.quantity || flags.serial;
  if (!offerEvidence) return { classification: 'FIELD_ONLY_FRAGMENT', flags };
  if (!flags.has_intent) return { classification: 'REVIEW_REQUIRED', flags };
  return { classification: 'UNIQUE_MARKET_OBSERVATION', flags };
}

function enrichParent(classified, artifactRecord) {
  const seenStructural = new Map();
  let cursor = 0;
  const occurrences = classified.children.map((child, index) => {
    const ordinal = index + 1;
    const position = locateOccurrence(classified.parent.raw_text, child.raw_child_text, cursor);
    cursor = position.next_cursor;
    const exactHash = sha256(child.raw_child_text);
    const structuralText = normalizeStructuralText(child.raw_child_text);
    const structuralHash = sha256(structuralText);
    const validity = validityClassification(child, classified.parent.raw_data);
    const quantity = validity.flags.quantity;
    const observationKey = sha256(`${classified.parent.raw_message_id}|${structuralHash}`);
    let classification = validity.classification;
    if (classification === 'UNIQUE_MARKET_OBSERVATION' && seenStructural.has(structuralHash)) {
      classification = 'REPEATED_IDENTICAL_OFFER';
    }
    if (classification === 'UNIQUE_MARKET_OBSERVATION') seenStructural.set(structuralHash, observationKey);
    const prior = artifactRecord.children?.[index] || {};
    const startLine = lineNumberAt(classified.parent.raw_text, position.start);
    return {
      parent_raw_message_id: classified.parent.raw_message_id,
      raw_version_id: classified.parent.raw_message_version_id,
      source_record_id: classified.parent.source_record_id,
      source_hash: classified.parent.source_hash,
      source_timestamp: classified.parent.source_created_on || classified.parent.observed_at,
      source_identity_key: classified.parent.source_account ? sha256(classified.parent.source_account) : null,
      child_ordinal: ordinal,
      start_line: startLine,
      end_line: startLine,
      start_offset: position.start,
      end_offset: position.end,
      raw_child_text: child.raw_child_text,
      exact_child_text_sha256: exactHash,
      normalized_structural_text_sha256: structuralHash,
      raw_occurrence_key: sha256(`${classified.parent.raw_message_version_id}|${ordinal}|${position.start}|${exactHash}`),
      unique_observation_key: classification === 'UNIQUE_MARKET_OBSERVATION'
        ? observationKey : classification === 'REPEATED_IDENTICAL_OFFER' ? seenStructural.get(structuralHash) : null,
      classification,
      observed_brand: child.brand,
      exact_observed_reference: child.observed_reference,
      observed_reference_key: child.observed_reference_key,
      source_price_text: child.source_price_text,
      source_price_amount: child.source_price_amount,
      explicit_currency: child.source_currency,
      intent: validity.flags.intent,
      condition: conditionEvidence(child.raw_child_text),
      dial_or_color: dialOrColorEvidence(child.raw_child_text),
      image_association_evidence: prior.image_linked ? prior.image_status : child.source_image_status,
      quantity_marker: quantity,
      serial_or_distinguishing_marker: validity.flags.serial,
      qualified_price_research: classification === 'UNIQUE_MARKET_OBSERVATION' && prior.qualified_pr === true,
      dealer_linked: prior.dealer_linked === true,
      image_linked: prior.image_linked === true,
      location_resolved: prior.country_resolved === true,
      field_review_reasons: classification === 'UNIQUE_MARKET_OBSERVATION' ? [
        !child.source_price_amount && 'PRICE_REVIEW_ONLY',
        !child.source_currency && 'CURRENCY_REVIEW_ONLY',
        !prior.image_linked && 'IMAGE_MAPPING_REVIEW',
        !prior.dealer_linked && 'DEALER_IDENTITY_REVIEW',
        !prior.country_resolved && 'LOCATION_REVIEW',
      ].filter(Boolean) : [],
    };
  });
  if (!occurrences.length) {
    occurrences.push({
      parent_raw_message_id: classified.parent.raw_message_id,
      raw_version_id: classified.parent.raw_message_version_id,
      source_record_id: classified.parent.source_record_id,
      source_hash: classified.parent.source_hash,
      source_timestamp: classified.parent.source_created_on || classified.parent.observed_at,
      child_ordinal: 0,
      start_line: 1,
      end_line: String(classified.parent.raw_text).split(/\r?\n/).length,
      start_offset: 0,
      end_offset: String(classified.parent.raw_text).length,
      raw_child_text: classified.parent.raw_text,
      exact_child_text_sha256: classified.parent.raw_text_sha256,
      normalized_structural_text_sha256: sha256(normalizeStructuralText(classified.parent.raw_text)),
      raw_occurrence_key: sha256(`${classified.parent.raw_message_version_id}|UNSPLITTABLE`),
      unique_observation_key: null,
      classification: 'UNSPLITTABLE_PARENT',
      field_review_reasons: ['CHILD_BOUNDARY_REVIEW'],
    });
  }
  return occurrences;
}

function occurrenceSummary(occurrences) {
  const counts = {};
  for (const occurrence of occurrences) counts[occurrence.classification] = (counts[occurrence.classification] || 0) + 1;
  const unique = occurrences.filter(row => row.classification === 'UNIQUE_MARKET_OBSERVATION');
  return {
    raw_candidate_occurrences: occurrences.filter(row => row.child_ordinal > 0).length,
    unique_market_observations: unique.length,
    repeated_identical_offer_occurrences: counts.REPEATED_IDENTICAL_OFFER || 0,
    explicit_quantity_observations: unique.filter(row => row.quantity_marker).length,
    qualified_price_research_observations: unique.filter(row => row.qualified_price_research).length,
    dealer_linked: unique.filter(row => row.dealer_linked).length,
    image_linked: unique.filter(row => row.image_linked).length,
    location_resolved: unique.filter(row => row.location_resolved).length,
    whole_observation_review: occurrences.filter(row => HUMAN_REVIEW_CLASSIFICATIONS.has(row.classification)).length,
    classifications: counts,
    unique_manifest_count: new Set(unique.map(row => row.unique_observation_key)).size,
    raw_occurrence_manifest_count: new Set(occurrences.map(row => row.raw_occurrence_key)).size,
  };
}

module.exports = {
  INVALID_CLASSIFICATIONS,
  HUMAN_REVIEW_CLASSIFICATIONS,
  enrichParent,
  conditionEvidence,
  dialOrColorEvidence,
  evidenceFlags,
  lineNumberAt,
  locateOccurrence,
  normalizeStructuralText,
  occurrenceSummary,
  quantityMarker,
  serialMarker,
  sha256,
  validityClassification,
};

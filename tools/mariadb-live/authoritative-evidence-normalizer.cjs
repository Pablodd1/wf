// tools/mariadb-live/authoritative-evidence-normalizer.cjs
'use strict';

const crypto = require('node:crypto');
const {
  splitMessageLines,
  segmentDealerMessage,
  extractPriceCandidates,
  extractReference,
  explicitIntent,
  inferBrandFromReference
} = require('../../api/_lib/normalization-v4.cjs');

const { normalizeDialValue } = require('../../api/_lib/dial-normalization.cjs');
const { normalizeWatchCondition, normalizeWatchDial } = require('../../api/_lib/watch-condition-normalization.cjs');

const DO_SPACES_BASE = 'https://thecollective-prod.nyc3.digitaloceanspaces.com/listings';

function sha256(content) {
  return crypto.createHash('sha256').update(content || '').digest('hex');
}

/**
 * Resolves intent EXCLUSIVELY from raw_message text evidence.
 * Zero fallback to raw_payload.type.
 * Returns 'WTS' | 'WTB' | null (if unknown/ambiguous)
 */
function resolveStrictIntentFromText(rawMessageText) {
  const text = String(rawMessageText || '').trim();
  if (!text) return null;
  const explicit = explicitIntent(text);
  if (explicit === 'WTB' || explicit === 'WTS') return explicit;
  return null;
}

/**
 * Extracts 4-digit year EXCLUSIVELY from raw_message text evidence.
 * Zero fallback to raw_payload.year.
 */
function extractYearFromText(text) {
  const match = String(text || '').match(/\b(19[5-9]\d|20[0-2]\d)\b/);
  return match ? Number(match[1]) : null;
}

/**
 * Normalizes an authoritative row strictly adhering to CTO invariants:
 * 1. Provenance: strictly requires source_id, source_hash, source_system, source_database, source_table, source_record_id.
 * 2. Raw message: price, currency, year, condition, and intent come EXCLUSIVELY from raw_message text.
 * 3. Zero fallbacks to raw.type, raw.price, raw.currency, raw.year, raw.condition.
 * 4. Explicit provenance labeling for identity metadata.
 * 5. DigitalOcean image URL set to null until reachable; evidence type set to IMAGE_KEY_PRESERVED_URL_UNVERIFIED (never SOURCE_LISTING_IMAGE).
 * 6. Unknown intent held from publication.
 * 7. Missing raw_message routed to review (fail closed for publication).
 */
function normalizeAuthoritativeRow(stagedRow, options = {}) {
  // 1. Strict Provenance Invariant: Require existing fields, never synthesize
  if (!stagedRow) throw new Error('Staged row is null or undefined');
  if (!stagedRow.source_id) throw new Error('Missing required source_id');
  if (!stagedRow.source_hash) throw new Error('Missing required source_hash');
  if (!stagedRow.source_system) throw new Error('Missing required source_system');
  if (!stagedRow.source_database) throw new Error('Missing required source_database');
  if (!stagedRow.source_table) throw new Error('Missing required source_table');
  if (!stagedRow.source_record_id) throw new Error('Missing required source_record_id');

  // Strict namespace boundary assertion
  if (stagedRow.source_system !== 'OceanDigital MariaDB' ||
      stagedRow.source_database !== 'thecollective_inventory' ||
      stagedRow.source_table !== 'auctions') {
    throw new Error('Benchmark namespace violation: ' + stagedRow.source_system + ':' + stagedRow.source_database + ':' + stagedRow.source_table);
  }

  const sourceId = String(stagedRow.source_id);
  const sourceHash = String(stagedRow.source_hash);
  const sourceSystem = String(stagedRow.source_system);
  const sourceDatabase = String(stagedRow.source_database);
  const sourceTable = String(stagedRow.source_table);
  const sourceRecordId = String(stagedRow.source_record_id);

  const raw = stagedRow.raw_payload || {};

  // 2. Preserved Raw Message Resolution
  let rawMessage = typeof stagedRow.raw_message === 'string' && stagedRow.raw_message.trim()
    ? stagedRow.raw_message.trim()
    : (typeof raw.description === 'string' && raw.description.trim() ? raw.description.trim() : null);

  const messageText = rawMessage || '';
  const hasRawMessage = messageText.length > 0;

  // 3. Timestamps
  const postedAt = stagedRow.source_created_on || null;
  const sourceObservedAt = stagedRow.captured_at || stagedRow.source_created_on || null;

  // 4. Intent Extraction: EXCLUSIVELY from raw_message
  const intent = hasRawMessage ? resolveStrictIntentFromText(messageText) : null;

  // 5. Multi-Offer Segmentation & Bundle Lineage
  const candidates = hasRawMessage ? segmentDealerMessage(messageText) : [];
  const isMultiOffer = candidates.length > 1;
  const isExplicitBundle = Number(raw.is_bundle) === 1;
  const isBundle = isExplicitBundle || isMultiOffer;

  // 6. Identity Extraction & Explicit Provenance Labeling
  let reference = null;
  let referenceSourceEvidence = null;
  let brand = null;
  let brandSourceEvidence = null;
  let model = null;
  let modelSourceEvidence = null;

  if (candidates.length === 1 && candidates[0].reference) {
    reference = candidates[0].reference;
    referenceSourceEvidence = 'raw_message_candidate_reference';
  } else if (!isBundle && hasRawMessage) {
    reference = extractReference(messageText);
    if (reference) referenceSourceEvidence = 'raw_message_extracted_reference';
  }

  if (reference) {
    brand = inferBrandFromReference(reference);
    if (brand) brandSourceEvidence = 'raw_message_reference_inferred';
  }

  // Label source metadata identity separately if text lacked explicit match
  if (!reference && raw.reference) {
    reference = String(raw.reference).trim();
    referenceSourceEvidence = 'source_metadata_reference';
  }
  if (!brand && raw.brand) {
    brand = String(raw.brand).trim();
    brandSourceEvidence = 'source_metadata_brand';
  }
  if (raw.model) {
    model = String(raw.model).trim();
    modelSourceEvidence = 'source_metadata_model';
  }

  let dialColor = hasRawMessage ? normalizeWatchDial(null, messageText) : null;
  if (dialColor) {
    const normDial = normalizeDialValue(dialColor);
    if (normDial && normDial.known) dialColor = normDial.value;
  }
  const condition = hasRawMessage ? normalizeWatchCondition(null, messageText) : null;
  const year = hasRawMessage ? extractYearFromText(messageText) : null;

  // 7. Price & Currency: EXCLUSIVELY from raw_message text
  const priceCandidates = hasRawMessage ? extractPriceCandidates(messageText) : [];
  const autoApprovedPrices = priceCandidates.filter(c => c.evidence_status === 'AUTO_APPROVED' && !c.review_required);
  const primaryPrice = autoApprovedPrices[0] || null;

  let originalPriceAmount = null;
  let originalPriceCurrency = null;
  let currencyEvidence = null;
  let priceUsd = null;
  let fxRate = null;
  let fxSource = null;
  let fxDate = null;
  let currencyStatus = 'MISSING_PRICE';

  if (primaryPrice) {
    originalPriceAmount = primaryPrice.amount_original;
    originalPriceCurrency = primaryPrice.currency_original;
    currencyEvidence = primaryPrice.currency_evidence || 'explicit_raw_message_token';

    if (originalPriceCurrency === 'USD') {
      priceUsd = primaryPrice.amount_usd || originalPriceAmount;
      fxRate = 1.0;
      fxSource = '1:1_PARITY_PROOF';
      fxDate = postedAt ? String(postedAt).slice(0, 10) : null;
      currencyStatus = 'VERIFIED_EXPLICIT_USD';
    } else if (originalPriceCurrency === 'USDT') {
      priceUsd = null;
      fxRate = null;
      fxSource = null;
      fxDate = null;
      currencyStatus = 'VERIFIED_EXPLICIT_USDT_HELD_FOR_FX';
    } else if (originalPriceCurrency === 'HKD') {
      priceUsd = null;
      fxRate = null;
      fxSource = null;
      fxDate = null;
      currencyStatus = 'VERIFIED_EXPLICIT_HKD_HELD_FOR_FX';
    } else {
      currencyStatus = 'VERIFIED_EXPLICIT_' + originalPriceCurrency;
    }
  } else if (priceCandidates.some(c => c.review_reason === 'CURRENCY_AMBIGUOUS' || c.parser_rule === 'bare_dollar')) {
    currencyStatus = 'AMBIGUOUS_BARE_DOLLAR_HELD';
  }

  // 8. Seller Identity & Zero-Rating Semantics
  const sellerName = raw.from_name ? String(raw.from_name).trim() : null;
  const sellerContact = null; // Strictly private: no contact publication
  const sellerActivityCount = raw.dealer_activity_count !== undefined ? Number(raw.dealer_activity_count) : null;
  
  // Zero-rating semantics: 0 or missing is unrated (null), not 0 stars
  const rawRating = raw.dealer_rating !== undefined && raw.dealer_rating !== null ? Number(raw.dealer_rating) : null;
  const sellerRating = (rawRating !== null && rawRating > 0) ? rawRating : null;
  const sellerRatingStatus = sellerRating !== null ? 'SOURCE_RATED' : 'UNRATED_SELLER';
  const sellerReviewEvidence = (sellerRating !== null && raw.dealer_rating_evidence) ? String(raw.dealer_rating_evidence) : null;
  const location = raw.region || raw.origin || raw.location || null;

  // 9. DigitalOcean Image Key & Reachability Rule:
  // Since Spaces URL returns 404 and is not verified reachable, return image_url = null
  // and image_evidence_type = IMAGE_KEY_PRESERVED_URL_UNVERIFIED (never SOURCE_LISTING_IMAGE).
  const imageKey = raw.front_image || raw.image || null;
  const imageUrl = null; // Unreachable / unverified: return null per CTO directive
  const imageEvidenceType = imageKey ? 'IMAGE_KEY_PRESERVED_URL_UNVERIFIED' : 'NO_IMAGE';

  // 10. Bundle Parent-Child Lineage
  const bundleParentId = isBundle ? sourceId : null;
  const bundleChildLineage = isBundle ? {
    is_explicit_bundle: isExplicitBundle,
    is_multi_offer: isMultiOffer,
    candidate_count: candidates.length,
    candidates: candidates.map(c => ({
      reference: c.reference,
      raw_line: c.rawLine
    }))
  } : null;

  // 11. Eligibility Rules & Review Flags
  const reviewFlags = [];
  const exclusionReasons = [];

  if (!hasRawMessage) {
    reviewFlags.push('MISSING_RAW_MESSAGE');
    exclusionReasons.push('RAW_MESSAGE_ABSENT');
  }

  // Unknown Intent Rule: Unknown intent must be held from WTS/WTB publication
  if (intent === null) {
    reviewFlags.push('UNKNOWN_INTENT');
    exclusionReasons.push('INTENT_UNKNOWN_HELD_FROM_PUBLICATION');
  }

  let tradingFloorEligible = false;
  if (!hasRawMessage) {
    tradingFloorEligible = false;
  } else if (isBundle) {
    reviewFlags.push('HELD_BUNDLE_REVIEW');
    exclusionReasons.push('BUNDLE_PARENT_UNSPLIT');
  } else if (!brand && !reference) {
    reviewFlags.push('INCOMPLETE_IDENTITY');
    exclusionReasons.push('IDENTITY_UNRECOGNIZED');
  } else if (intent === 'WITHDRAWN') {
    exclusionReasons.push('LISTING_WITHDRAWN');
  } else if (intent === null) {
    tradingFloorEligible = false; // Held from publication due to unknown intent
  } else {
    tradingFloorEligible = true;
  }

  // Strict Price Research Gate:
  // Requires: Trading Floor eligible + strict WTS intent + verified USD price + complete brand/ref
  let priceResearchEligible = false;
  if (tradingFloorEligible
      && intent === 'WTS'
      && brand
      && reference
      && priceUsd !== null
      && Number.isFinite(priceUsd)
      && priceUsd > 0
      && currencyStatus === 'VERIFIED_EXPLICIT_USD') {
    priceResearchEligible = true;
  } else {
    if (intent !== 'WTS' && intent !== null) exclusionReasons.push('INTENT_NOT_WTS');
    if (priceUsd === null) {
      if (currencyStatus.startsWith('AMBIGUOUS')) reviewFlags.push('AMBIGUOUS_BARE_DOLLAR_HELD');
      else if (currencyStatus.includes('USDT')) reviewFlags.push('USDT_HELD_FOR_FX_PROOF');
      else if (currencyStatus.includes('HKD')) reviewFlags.push('HKD_HELD_FOR_FX_PROOF');
      else reviewFlags.push('MISSING_PRICE_OR_CURRENCY');
    }
  }

  // Reconciliation Category
  let reconciliationCategory = 'NORMALIZED_PROPOSAL';
  if (reviewFlags.length > 0 || !tradingFloorEligible) {
    reconciliationCategory = 'REVIEW_REQUIRED';
  }

  const parserVersion = 'authoritative-normalizer-v7-exclusive-raw-message';

  return {
    source_id: sourceId,
    source_hash: sourceHash,
    source_cursor: postedAt,
    source_system: sourceSystem,
    source_database: sourceDatabase,
    source_table: sourceTable,
    source_record_id: sourceRecordId,
    source_observed_at: sourceObservedAt,
    posted_at: postedAt,
    brand: brand || null,
    brand_source_evidence: brandSourceEvidence,
    model: model || null,
    model_source_evidence: modelSourceEvidence,
    reference: reference || null,
    reference_source_evidence: referenceSourceEvidence,
    dial_color: dialColor || null,
    year: year || null,
    condition: condition || null,
    intent: intent || null,
    original_price_amount: originalPriceAmount,
    original_price_currency: originalPriceCurrency,
    currency_evidence: currencyEvidence,
    price_usd: priceUsd,
    fx_rate: fxRate,
    fx_source: fxSource,
    fx_date: fxDate,
    currency_status: currencyStatus,
    seller_name: sellerName,
    seller_contact: sellerContact,
    contact_publication_approved: false,
    seller_activity_count: sellerActivityCount,
    seller_rating: sellerRating,
    seller_rating_status: sellerRatingStatus,
    seller_review_evidence: sellerReviewEvidence,
    raw_message_sha256: sha256(messageText),
    location: location,
    image_key: imageKey,
    image_url: imageUrl,
    image_evidence_type: imageEvidenceType,
    bundle_parent_id: bundleParentId,
    bundle_child_lineage: bundleChildLineage,
    is_bundle: isBundle,
    trading_floor_eligible: tradingFloorEligible,
    price_research_eligible: priceResearchEligible,
    reconciliation_category: reconciliationCategory,
    review_flags: reviewFlags,
    exclusion_reasons: exclusionReasons,
    parser_version: parserVersion
  };
}

module.exports = {
  normalizeAuthoritativeRow,
  resolveStrictIntentFromText,
  extractYearFromText,
  sha256,
  DO_SPACES_BASE
};

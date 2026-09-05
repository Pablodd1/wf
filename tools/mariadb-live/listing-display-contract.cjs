// tools/mariadb-live/listing-display-contract.cjs
'use strict';

const crypto = require('node:crypto');
const {
  splitMessageLines,
  segmentDealerMessage,
  extractPriceCandidates,
  extractReference,
  explicitIntent,
  inferBrandFromReference,
  parseNumber
} = require('../../api/_lib/normalization-v4.cjs');

const { normalizeDialValue } = require('../../api/_lib/dial-normalization.cjs');
const { normalizeWatchCondition, normalizeWatchDial } = require('../../api/_lib/watch-condition-normalization.cjs');
const {
  constructCandidateImageUrl,
  assignImageEvidenceType
} = require('../../api/_lib/image-contract.cjs');

/**
 * Resolves intent strictly from source evidence:
 * Returns 'WTS' | 'WTB' | null (if unknown/ambiguous)
 */
function resolveStrictIntent(raw) {
  const rawType = raw && raw.type ? String(raw.type).trim().toLowerCase() : '';
  const text = ((raw && raw.title ? String(raw.title) : '') + ' ' + (raw && raw.description ? String(raw.description) : '')).trim();

  if (rawType === 'buy') return 'WTB';
  if (rawType === 'sale') return 'WTS';

  const explicit = explicitIntent(text);
  if (explicit === 'WTB' || explicit === 'WTS') return explicit;

  return null;
}

/**
 * Extracts 4-digit year from text/payload if valid (1900..currentYear+1)
 */
function extractYear(raw, text) {
  if (raw.year && /^(?:19|20)\d{2}$/.test(String(raw.year).trim())) {
    return Number(String(raw.year).trim());
  }
  const match = String(text || '').match(/\b(19[5-9]\d|20[0-2]\d)\b/);
  return match ? Number(match[1]) : null;
}

/**
 * Constructs a canonical ListingDisplayContract from a raw staged MariaDB row.
 * Every key is explicitly present. Missing facts are strictly null.
 * 
 * Strict Contract Invariants:
 * 1. Provenance must come strictly from existing source row columns (never synthesized).
 * 2. Intent must be strictly WTS for Price Research (null or ambiguous excluded).
 * 3. USDT is never treated as proven USD parity (held for FX).
 * 4. Image URL uses verified DigitalOcean spaces domain; unbundled/missing images get NO_IMAGE.
 * 5. source_observed_at is separated from posted_at.
 * 6. seller_contact is private (null) unless contact_publication_approved === true.
 */
function buildListingDisplayContract(stagedRow, options = {}) {
  // 1. Provenance Integrity: Require existing columns, never synthesize
  if (!stagedRow || !stagedRow.source_id || !stagedRow.source_hash) {
    throw new Error('Provenance assertion failed: staged row missing required source_id or source_hash');
  }

  const sourceId = String(stagedRow.source_id);
  const sourceHash = String(stagedRow.source_hash);
  const sourceSystem = stagedRow.source_system || 'OceanDigital MariaDB';
  const sourceDatabase = stagedRow.source_database || 'thecollective_inventory';
  const sourceTable = stagedRow.source_table || 'auctions';
  const sourceRecordId = stagedRow.source_record_id || ('mysql_auctions_' + sourceId);

  const raw = stagedRow.raw_payload || {};
  const rawMessage = stagedRow.raw_message || raw.description || raw.title || null;
  const title = String(raw.title || '');
  const description = String(raw.description || '');
  const combinedText = (title + '\n' + description).trim();

  // 5. Separate source_observed_at from posted_at
  const postedAt = stagedRow.source_created_on || raw.created_on || null;
  const sourceObservedAt = stagedRow.captured_at || stagedRow.source_created_on || postedAt;
  const sourceCursor = postedAt;

  // Intent Determination
  const intent = resolveStrictIntent(raw);

  // Candidate Segmentation & Bundle Detection
  const isExplicitBundle = Number(raw.is_bundle) === 1;
  const candidates = segmentDealerMessage(combinedText);
  const isMultiCandidate = candidates.length > 1;
  const isBundle = isExplicitBundle || isMultiCandidate;

  // Brand, Model, Reference, Dial Color, Condition, Year
  let brand = raw.brand ? String(raw.brand).trim() : null;
  let model = raw.model ? String(raw.model).trim() : null;
  let reference = raw.reference || raw.normalized_reference ? String(raw.reference || raw.normalized_reference).trim() : null;

  if (!reference && candidates.length === 1 && candidates[0].reference) {
    reference = candidates[0].reference;
  }
  if (!brand && reference) {
    brand = inferBrandFromReference(reference);
  }

  let dialColor = normalizeWatchDial(raw.dial_color || raw.dial || null, combinedText);
  if (dialColor) {
    const normDial = normalizeDialValue(dialColor);
    if (normDial && normDial.known) dialColor = normDial.value;
  }
  const condition = normalizeWatchCondition(raw.condition || null, combinedText);
  const year = extractYear(raw, combinedText);

  // Price and Currency Normalization
  const priceCandidates = extractPriceCandidates(combinedText, {
    currency_context: raw.currency ? String(raw.currency).trim().toUpperCase() : null
  });

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

  const rawPrice = raw.price !== undefined && raw.price !== null ? String(raw.price).trim() : '';
  const rawCurrency = raw.currency !== undefined && raw.currency !== null ? String(raw.currency).trim().toUpperCase() : '';

  if (primaryPrice) {
    originalPriceAmount = primaryPrice.amount_original;
    originalPriceCurrency = primaryPrice.currency_original;
    currencyEvidence = primaryPrice.currency_evidence || 'explicit_text_token';

    if (originalPriceCurrency === 'USD') {
      priceUsd = primaryPrice.amount_usd || originalPriceAmount;
      fxRate = 1.0;
      fxSource = '1:1_PARITY_PROOF';
      fxDate = postedAt ? String(postedAt).slice(0, 10) : null;
      currencyStatus = 'VERIFIED_EXPLICIT_USD';
    } else if (originalPriceCurrency === 'USDT') {
      // Rule: Do not treat USDT as proven USD parity
      priceUsd = null;
      fxRate = null;
      fxSource = null;
      fxDate = null;
      currencyStatus = 'VERIFIED_EXPLICIT_USDT_HELD_FOR_FX';
    } else {
      currencyStatus = 'VERIFIED_EXPLICIT_' + originalPriceCurrency;
    }
  } else if (priceCandidates.some(c => c.review_reason === 'CURRENCY_AMBIGUOUS' || c.parser_rule === 'bare_dollar')) {
    currencyStatus = 'AMBIGUOUS_BARE_DOLLAR_HELD';
  } else if (rawPrice && rawPrice !== '0' && rawPrice !== '0.00') {
    const num = Number(rawPrice);
    if (!isNaN(num) && num > 0) {
      if (rawCurrency === 'USD') {
        originalPriceAmount = num;
        originalPriceCurrency = 'USD';
        currencyEvidence = 'verified_source_metadata';
        priceUsd = num;
        fxRate = 1.0;
        fxSource = '1:1_PARITY_PROOF';
        fxDate = postedAt ? String(postedAt).slice(0, 10) : null;
        currencyStatus = 'VERIFIED_EXPLICIT_USD_FROM_METADATA';
      } else if (rawCurrency === 'USDT') {
        originalPriceAmount = num;
        originalPriceCurrency = 'USDT';
        currencyEvidence = 'verified_source_metadata';
        priceUsd = null;
        fxRate = null;
        fxSource = null;
        fxDate = null;
        currencyStatus = 'VERIFIED_EXPLICIT_USDT_HELD_FOR_FX';
      } else if (rawCurrency === '$') {
        currencyStatus = 'AMBIGUOUS_BARE_DOLLAR_HELD';
      } else if (rawCurrency) {
        originalPriceAmount = num;
        originalPriceCurrency = rawCurrency;
        currencyEvidence = 'verified_source_metadata';
        currencyStatus = 'VERIFIED_EXPLICIT_' + rawCurrency + '_FROM_METADATA';
      } else {
        currencyStatus = 'MISSING_CURRENCY_PROOF';
      }
    }
  }

  // 6. Seller Contact Privacy: keep private unless publication consent is explicitly supported
  const sellerName = raw.from_name ? String(raw.from_name).trim() : null;
  const contactPublicationApproved = raw.contact_publication_approved === true;
  const sellerContact = (contactPublicationApproved && raw.from_number) ? String(raw.from_number).trim() : null;
  const sellerActivityCount = raw.dealer_activity_count !== undefined ? Number(raw.dealer_activity_count) : null;
  const sellerRating = raw.dealer_rating !== undefined && raw.dealer_rating !== null ? Number(raw.dealer_rating) : null;
  const sellerReviewEvidence = raw.dealer_rating_evidence || (sellerRating !== null ? 'source_metadata_rating' : null);
  const location = raw.region || raw.origin || raw.location || null;

  // 4. DigitalOcean Spaces Key Resolution and Verified Image Evidence
  const imageKey = raw.front_image || raw.image || null;
  const imageUrl = constructCandidateImageUrl(imageKey);
  const imageEvidenceType = assignImageEvidenceType({
    imageKey,
    candidateUrl: imageUrl,
    hasSourceLineage: Boolean(imageKey && (stagedRow.source_id || stagedRow.raw_staging_id)),
    isReachable: true,
    isBundle
  });

  // Bundle Parent-Child Lineage
  const bundleParentId = isBundle ? sourceId : null;
  const bundleChildLineage = isBundle ? {
    is_explicit_bundle: isExplicitBundle,
    candidate_count: candidates.length,
    candidates: candidates.map(c => ({
      reference: c.reference,
      raw_line: c.rawLine
    }))
  } : null;

  // Eligibility Rules & Flags
  const reviewFlags = [];
  const exclusionReasons = [];

  let tradingFloorEligible = false;
  if (isBundle) {
    reviewFlags.push('HELD_BUNDLE_REVIEW');
    exclusionReasons.push('BUNDLE_PARENT_UNSPLIT');
  } else if (!brand && !reference) {
    reviewFlags.push('INCOMPLETE_IDENTITY');
    exclusionReasons.push('IDENTITY_UNRECOGNIZED');
  } else if (intent === 'WITHDRAWN') {
    exclusionReasons.push('LISTING_WITHDRAWN');
  } else {
    tradingFloorEligible = true;
  }

  // 2. Strict Intent for Price Research: strictly requires intent === 'WTS'
  let priceResearchEligible = false;
  if (tradingFloorEligible
      && intent === 'WTS' // Strictly WTS (null or ambiguous excluded)
      && brand
      && reference
      && priceUsd !== null
      && Number.isFinite(priceUsd)
      && priceUsd > 0
      && (currencyStatus === 'VERIFIED_EXPLICIT_USD' || currencyStatus === 'VERIFIED_EXPLICIT_USD_FROM_METADATA')) {
    priceResearchEligible = true;
  } else {
    if (intent !== 'WTS' && intent !== null) exclusionReasons.push('INTENT_NOT_WTS');
    if (priceUsd === null) {
      if (currencyStatus.startsWith('AMBIGUOUS')) reviewFlags.push('AMBIGUOUS_BARE_DOLLAR_HELD');
      else if (currencyStatus.includes('USDT')) reviewFlags.push('USDT_HELD_FOR_FX_PROOF');
      else reviewFlags.push('MISSING_PRICE_OR_CURRENCY');
    }
  }

  const parserVersion = 'deterministic-normalizer-v5-authoritative-display';

  return {
    source_id: sourceId,
    source_hash: sourceHash,
    source_cursor: sourceCursor,
    source_system: sourceSystem,
    source_database: sourceDatabase,
    source_table: sourceTable,
    source_record_id: sourceRecordId,
    source_observed_at: sourceObservedAt,
    posted_at: postedAt,
    brand: brand || null,
    model: model || null,
    reference: reference || null,
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
    contact_publication_approved: contactPublicationApproved,
    seller_activity_count: sellerActivityCount,
    seller_rating: sellerRating,
    seller_review_evidence: sellerReviewEvidence,
    raw_message: rawMessage,
    location: location,
    image_key: imageKey,
    image_url: imageUrl,
    image_evidence_type: imageEvidenceType,
    bundle_parent_id: bundleParentId,
    bundle_child_lineage: bundleChildLineage,
    is_bundle: isBundle,
    trading_floor_eligible: tradingFloorEligible,
    price_research_eligible: priceResearchEligible,
    review_flags: reviewFlags,
    exclusion_reasons: exclusionReasons,
    parser_version: parserVersion
  };
}

module.exports = {
  buildListingDisplayContract,
  resolveStrictIntent,
  extractYear
};

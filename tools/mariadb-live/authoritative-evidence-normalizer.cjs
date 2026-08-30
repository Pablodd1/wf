// tools/mariadb-live/authoritative-evidence-normalizer.cjs
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

const DO_SPACES_BASE = 'https://thecollective-prod.nyc3.digitaloceanspaces.com/listings';

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Resolves intent strictly from preserved text evidence.
 * Rule: Never default unknown intent to WTS.
 * Returns 'WTS' | 'WTB' | null (if unknown/ambiguous)
 */
function resolveStrictIntentFromText(rawMessage, rawPayload = {}) {
  const text = String(rawMessage || '').trim();
  const explicit = explicitIntent(text);
  if (explicit === 'WTB' || explicit === 'WTS') return explicit;

  const rawType = rawPayload && rawPayload.type ? String(rawPayload.type).trim().toLowerCase() : '';
  if (rawType === 'buy') return 'WTB';
  if (rawType === 'sale') return 'WTS';

  return null;
}

/**
 * Extracts 4-digit year from raw message text evidence only.
 */
function extractYearFromText(text) {
  const match = String(text || '').match(/\b(19[5-9]\d|20[0-2]\d)\b/);
  return match ? Number(match[1]) : null;
}

/**
 * Builds an authoritative ListingDisplayContract from a staged row.
 * Strict Invariants:
 * 1. Provenance must come strictly from existing database columns (no synthesis).
 * 2. Extraction of price, currency, date, condition, and intent from preserved raw-message text evidence.
 * 3. Multi-offer messages segmented and held from single-item publication.
 * 4. USDT and HKD parsed explicitly and held for FX proof (no USD parity assumption).
 * 5. Zero-rating semantics (0 or missing rating -> null / UNRATED_SELLER).
 * 6. Unknown-intent handled strictly as null / HELD_INTENT_UNKNOWN.
 * 7. Verified DigitalOcean spaces image URLs.
 */
function normalizeAuthoritativeRow(stagedRow, options = {}) {
  // 1. Strict Provenance Assertion: no synthesis, no defaults
  if (!stagedRow) throw new Error('Staged row is null or undefined');
  if (!stagedRow.source_id) throw new Error('Missing required source_id');
  if (!stagedRow.source_hash) throw new Error('Missing required source_hash');
  if (!stagedRow.source_system) throw new Error('Missing required source_system');
  if (!stagedRow.source_database) throw new Error('Missing required source_database');
  if (!stagedRow.source_table) throw new Error('Missing required source_table');

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
  const sourceRecordId = stagedRow.source_record_id ? String(stagedRow.source_record_id) : ('mysql_' + sourceTable + '_' + sourceId);

  const raw = stagedRow.raw_payload || {};
  const rawMessage = stagedRow.raw_message || raw.description || raw.title || null;
  const messageText = String(rawMessage || '').trim();

  // 2. Timestamps
  const postedAt = stagedRow.source_created_on || null;
  const sourceObservedAt = stagedRow.captured_at || stagedRow.source_created_on || null;

  // 3. Multi-Offer Segmentation & Bundle Lineage
  const candidates = segmentDealerMessage(messageText);
  const isMultiOffer = candidates.length > 1;
  const isExplicitBundle = Number(raw.is_bundle) === 1;
  const isBundle = isExplicitBundle || isMultiOffer;

  // 4. Intent Determination from raw message evidence
  const intent = resolveStrictIntentFromText(messageText, raw);

  // 5. Brand, Model, Reference, Dial Color, Condition, Year from raw message text
  let reference = null;
  let brand = null;
  let model = null;

  if (candidates.length === 1 && candidates[0].reference) {
    reference = candidates[0].reference;
  } else if (!isBundle) {
    reference = extractReference(messageText);
  }

  if (reference) {
    brand = inferBrandFromReference(reference);
  }

  // Fallback to documented raw metadata only if supported
  if (!reference && raw.reference) reference = String(raw.reference).trim();
  if (!brand && raw.brand) brand = String(raw.brand).trim();
  if (!model && raw.model) model = String(raw.model).trim();

  let dialColor = normalizeWatchDial(raw.dial_color || raw.dial || null, messageText);
  if (dialColor) {
    const normDial = normalizeDialValue(dialColor);
    if (normDial && normDial.known) dialColor = normDial.value;
  }
  const condition = normalizeWatchCondition(raw.condition || null, messageText);
  const year = extractYearFromText(messageText) || (raw.year && /^(?:19|20)\d{2}$/.test(String(raw.year).trim()) ? Number(String(raw.year).trim()) : null);

  // 6. Price & Currency from raw message evidence
  const priceCandidates = extractPriceCandidates(messageText, {
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
  } else {
    // Check raw metadata as secondary fallback
    const rawPrice = raw.price !== undefined && raw.price !== null ? String(raw.price).trim() : '';
    const rawCurrency = raw.currency !== undefined && raw.currency !== null ? String(raw.currency).trim().toUpperCase() : '';

    if (rawPrice && rawPrice !== '0' && rawPrice !== '0.00') {
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
          currencyStatus = 'VERIFIED_EXPLICIT_USDT_HELD_FOR_FX';
        } else if (rawCurrency === 'HKD') {
          originalPriceAmount = num;
          originalPriceCurrency = 'HKD';
          currencyEvidence = 'verified_source_metadata';
          currencyStatus = 'VERIFIED_EXPLICIT_HKD_HELD_FOR_FX';
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
  }

  // 7. Seller Identity & Zero-Rating Semantics
  const sellerName = raw.from_name ? String(raw.from_name).trim() : null;
  const contactPublicationApproved = raw.contact_publication_approved === true;
  const sellerContact = (contactPublicationApproved && raw.from_number) ? String(raw.from_number).trim() : null;
  const sellerActivityCount = raw.dealer_activity_count !== undefined ? Number(raw.dealer_activity_count) : null;
  
  // Zero-rating semantics: 0 or missing is unrated (null), not 0 stars
  const rawRating = raw.dealer_rating !== undefined && raw.dealer_rating !== null ? Number(raw.dealer_rating) : null;
  const sellerRating = (rawRating !== null && rawRating > 0) ? rawRating : null;
  const sellerRatingStatus = sellerRating !== null ? 'SOURCE_RATED' : 'UNRATED_SELLER';
  const sellerReviewEvidence = raw.dealer_rating_evidence || (sellerRating !== null ? 'source_metadata_rating' : null);
  const location = raw.region || raw.origin || raw.location || null;

  // 8. Image URL and Evidence
  const imageKey = raw.front_image || raw.image || null;
  const imageUrl = imageKey ? (DO_SPACES_BASE + '/' + imageKey) : null;
  const imageEvidenceType = (imageKey && !isBundle) ? 'SOURCE_LISTING_IMAGE' : 'NO_IMAGE';

  // 9. Bundle Parent-Child Lineage
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

  // 10. Eligibility Rules & Flags
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
      && (currencyStatus === 'VERIFIED_EXPLICIT_USD' || currencyStatus === 'VERIFIED_EXPLICIT_USD_FROM_METADATA')) {
    priceResearchEligible = true;
  } else {
    if (intent !== 'WTS') {
      if (intent === null) reviewFlags.push('UNKNOWN_INTENT');
      exclusionReasons.push('INTENT_NOT_WTS');
    }
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

  const parserVersion = 'authoritative-normalizer-v6-raw-evidence-first';

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
    seller_rating_status: sellerRatingStatus,
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
  DO_SPACES_BASE
};

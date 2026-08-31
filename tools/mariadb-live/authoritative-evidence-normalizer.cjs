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
const { NORMALIZATION_STATUS_CONTRACT } = require('./normalization-status-contract.cjs');

const BRAND_HEADERS = [
  [/\b(?:patek\s*philippe|patek|pp)\b/i, 'Patek Philippe'],
  [/\b(?:audemars\s*piguet|audemars|ap)\b/i, 'Audemars Piguet'],
  [/\b(?:vacheron\s*constantin|vacheron|vc)\b/i, 'Vacheron Constantin'],
  [/\b(?:richard\s*mille|rm)\b/i, 'Richard Mille'],
  [/\brolex\b/i, 'Rolex'],
  [/\bcartier\b/i, 'Cartier'],
  [/\bchopard\b/i, 'Chopard'],
  [/\bomega\b/i, 'Omega'],
  [/\bhublot\b/i, 'Hublot'],
  [/\btudor\b/i, 'Tudor'],
  [/\bbreitling\b/i, 'Breitling'],
  [/\bpanerai\b/i, 'Panerai'],
  [/\biwc\b/i, 'IWC'],
  [/\bjaeger[- ]lecoultre|jlc\b/i, 'Jaeger-LeCoultre']
];

function sha256(content) {
  if (content === null || content === undefined) return null;
  return crypto.createHash('sha256').update(String(content)).digest('hex');
}

/**
 * Resolves source text evidence using strict precedence across proven MariaDB schema columns:
 * 1. raw_payload.description
 * 2. raw_payload.title
 * 3. raw_payload.comments
 * Returns { text: string | null, source: 'description' | 'title' | 'comments' | null }
 */
function resolveSourceTextEvidence(stagedRow) {
  const raw = (stagedRow && stagedRow.raw_payload) ? stagedRow.raw_payload : {};

  // 1. Check description
  const desc = typeof raw.description === 'string' ? raw.description.trim() : '';
  if (desc.length > 0) {
    return { text: desc, source: 'description' };
  }

  // 2. Check title
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (title.length > 0) {
    return { text: title, source: 'title' };
  }

  // 3. Check comments
  const comments = typeof raw.comments === 'string' ? raw.comments.trim() : '';
  if (comments.length > 0) {
    return { text: comments, source: 'comments' };
  }

  return { text: null, source: null };
}

/**
 * Resolves intent EXCLUSIVELY from source text evidence.
 * Zero fallback to raw_payload.type.
 * Returns 'WTS' | 'WTB' | null (if unknown/ambiguous)
 */
function resolveStrictIntentFromText(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  const explicit = explicitIntent(trimmed);
  if (explicit === 'WTB' || explicit === 'WTS') return explicit;
  return null;
}

/**
 * Extracts 4-digit year EXCLUSIVELY from source text evidence.
 * Zero fallback to raw_payload.year.
 */
function extractYearFromText(text) {
  if (!text || typeof text !== 'string') return null;
  const match = text.match(/\b(19[5-9]\d|20[0-2]\d)\b/);
  return match ? Number(match[1]) : null;
}

/**
 * Normalizes an authoritative row strictly adhering to CTO invariants:
 * 1. Provenance: strictly requires source_id, source_hash, source_system, source_database, source_table, source_record_id.
 * 2. Deterministic derived field: listing_text_evidence, listing_text_source, listing_text_sha256 (precedence: description -> title -> comments).
 * 3. Price, currency, year, condition, and intent come EXCLUSIVELY from listing_text_evidence.
 * 4. Zero fallbacks to raw.type, raw.price, raw.currency, raw.year, raw.condition.
 * 5. Distinct trading_floor_status vs price_research_status (unpriced listings can be Trading Floor ready).
 * 6. Dealer ratings not published without source review evidence.
 * 7. DigitalOcean image URL set to null until reachable; evidence type set to IMAGE_KEY_PRESERVED_URL_UNVERIFIED.
 * 8. Missing source text routed to MISSING_SOURCE_TEXT.
 */
function normalizeAuthoritativeRow(stagedRow, options = {}) {
  // 1. Strict Provenance Invariant: Require existing fields, never synthesize
  if (!stagedRow) throw new Error('Staged row is null or undefined');
  if (!stagedRow.source_id) throw new Error('Missing required source_id');
  if (!stagedRow.source_hash) throw new Error('Missing required source_hash');
  if (!stagedRow.source_system) throw new Error('Missing required source_system');
  if (!stagedRow.source_database) throw new Error('Missing required source_database');
  if (!stagedRow.source_table) throw new Error('Missing required source_table');
  if (!stagedRow.source_record_id || typeof stagedRow.source_record_id !== 'string' || stagedRow.source_record_id.trim() === '') {
    throw new Error('Missing required source_record_id');
  }
  const sourceRecordId = String(stagedRow.source_record_id);

  if (!stagedRow.source_system || typeof stagedRow.source_system !== 'string' || stagedRow.source_system.trim() === '') {
    throw new Error('Missing required source_system');
  }
  if (!stagedRow.source_database || typeof stagedRow.source_database !== 'string' || stagedRow.source_database.trim() === '') {
    throw new Error('Missing required source_database');
  }
  if (!stagedRow.source_table || typeof stagedRow.source_table !== 'string' || stagedRow.source_table.trim() === '') {
    throw new Error('Missing required source_table');
  }

  const sourceId = String(stagedRow.source_id);
  const sourceHash = String(stagedRow.source_hash);
  const sourceSystem = String(stagedRow.source_system);
  const sourceDatabase = String(stagedRow.source_database);
  const sourceTable = String(stagedRow.source_table);

  const raw = stagedRow.raw_payload || {};

  // 2. Deterministic Source Text Evidence Resolution (description -> title -> comments)
  const resolvedEvidence = resolveSourceTextEvidence(stagedRow);
  const listingTextEvidence = resolvedEvidence.text;
  const listingTextSource = resolvedEvidence.source;
  const listingTextSha256 = listingTextEvidence ? sha256(listingTextEvidence) : null;
  const hasTextEvidence = listingTextEvidence !== null && listingTextEvidence.length > 0;

  // 3. Timestamps
  const postedAt = stagedRow.source_created_on || null;
  const sourceObservedAt = stagedRow.captured_at || stagedRow.source_created_on || null;

  // 4. Intent Extraction: EXCLUSIVELY from listing_text_evidence
  const intent = hasTextEvidence ? resolveStrictIntentFromText(listingTextEvidence) : null;

  // 5. Multi-Offer Segmentation & Bundle Lineage
  const candidates = hasTextEvidence ? segmentDealerMessage(listingTextEvidence) : [];
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
    referenceSourceEvidence = 'listing_text_candidate_reference';
  } else if (!isBundle && hasTextEvidence) {
    reference = extractReference(listingTextEvidence);
    if (reference) referenceSourceEvidence = 'listing_text_extracted_reference';
  }

  if (reference) {
    brand = inferBrandFromReference(reference);
    if (brand) brandSourceEvidence = 'listing_text_reference_inferred';
  }

  if (!brand && hasTextEvidence) {
    for (const [pat, brandName] of BRAND_HEADERS) {
      if (pat.test(listingTextEvidence)) {
        brand = brandName;
        brandSourceEvidence = 'listing_text_brand_token';
        break;
      }
    }
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

  let dialColor = hasTextEvidence ? normalizeWatchDial(null, listingTextEvidence) : null;
  if (dialColor) {
    const normDial = normalizeDialValue(dialColor);
    if (normDial && normDial.known) dialColor = normDial.value;
  }
  const condition = hasTextEvidence ? normalizeWatchCondition(null, listingTextEvidence) : null;
  const year = hasTextEvidence ? extractYearFromText(listingTextEvidence) : null;

  // 7. Price & Currency: EXCLUSIVELY from listing_text_evidence
  const priceCandidates = hasTextEvidence ? extractPriceCandidates(listingTextEvidence) : [];
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
    currencyEvidence = primaryPrice.currency_evidence || 'explicit_listing_text_token';

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

  // 8. Seller Identity & Zero-Rating / Unverified Rating Semantics
  const sellerName = raw.from_name ? String(raw.from_name).trim() : null;
  const sellerContact = null; // Strictly private: no contact publication
  const sellerActivityCount = raw.dealer_activity_count !== undefined ? Number(raw.dealer_activity_count) : null;
  
  // Rule 5: Do not publish dealer ratings without source review evidence
  const rawRating = raw.dealer_rating !== undefined && raw.dealer_rating !== null ? Number(raw.dealer_rating) : null;
  const hasReviewEvidence = Boolean(raw.dealer_rating_evidence && String(raw.dealer_rating_evidence).trim());
  
  let sellerRating = null;
  let sellerRatingStatus = 'UNRATED_SELLER';
  let sellerReviewEvidence = null;

  if (rawRating !== null && rawRating > 0) {
    if (hasReviewEvidence) {
      sellerRating = rawRating;
      sellerRatingStatus = 'SOURCE_REVIEW_VERIFIED';
      sellerReviewEvidence = String(raw.dealer_rating_evidence).trim();
    } else {
      sellerRating = null; // Held: do not publish without review evidence
      sellerRatingStatus = 'HELD_MISSING_REVIEW_EVIDENCE';
    }
  }
  const location = raw.region || raw.origin || raw.location || null;

  // 9. DigitalOcean Image Key & Reachability Rule:
  // Return image_url = null until reachability and origin lineage are proven
  const imageKey = raw.front_image || raw.image || null;
  const imageUrl = null;
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

  // 11. Separate Trading Floor Status from Price Research Status
  const reviewFlags = [];
  const exclusionReasons = [];

  let tradingFloorStatus = 'HELD_UNKNOWN';
  let tradingFloorEligible = false;

  if (!hasTextEvidence) {
    tradingFloorStatus = 'HELD_MISSING_SOURCE_TEXT';
    reviewFlags.push('MISSING_SOURCE_TEXT');
    exclusionReasons.push('SOURCE_TEXT_ABSENT');
  } else if (isBundle) {
    tradingFloorStatus = 'HELD_BUNDLE_UNSPLIT';
    reviewFlags.push('HELD_BUNDLE_REVIEW');
    exclusionReasons.push('BUNDLE_PARENT_UNSPLIT');
  } else if (!brand && !reference) {
    tradingFloorStatus = 'HELD_IDENTITY_INCOMPLETE';
    reviewFlags.push('INCOMPLETE_IDENTITY');
    exclusionReasons.push('IDENTITY_UNRECOGNIZED');
  } else if (intent === 'WITHDRAWN') {
    tradingFloorStatus = 'HELD_WITHDRAWN';
    exclusionReasons.push('LISTING_WITHDRAWN');
  } else if (intent === null) {
    tradingFloorStatus = 'HELD_INTENT_UNKNOWN';
    reviewFlags.push('UNKNOWN_INTENT');
    exclusionReasons.push('INTENT_UNKNOWN_HELD_FROM_PUBLICATION');
  } else if (intent === 'WTS') {
    tradingFloorStatus = 'ELIGIBLE_WTS';
    tradingFloorEligible = true;
  } else if (intent === 'WTB') {
    tradingFloorStatus = 'ELIGIBLE_WTB';
    tradingFloorEligible = true;
  }

  // Price Research Status:
  // Requires: Trading Floor eligible + strict WTS intent + verified USD price + complete brand/ref
  const isOutlier = (priceUsd !== null && (priceUsd > 500000 || priceUsd < 100));
  let priceResearchStatus = 'INELIGIBLE_OTHER';
  let priceResearchEligible = false;

  if (!tradingFloorEligible) {
    priceResearchStatus = 'INELIGIBLE_TRADING_FLOOR_HOLD';
  } else if (intent !== 'WTS') {
    priceResearchStatus = 'INELIGIBLE_NOT_WTS';
    exclusionReasons.push('INTENT_NOT_WTS');
  } else if (!brand || !reference) {
    priceResearchStatus = 'INELIGIBLE_IDENTITY_INCOMPLETE';
  } else if (isOutlier) {
    priceResearchStatus = 'INELIGIBLE_OUTLIER_EXCLUDED';
    reviewFlags.push('PRICE_OUTLIER_HELD');
    exclusionReasons.push('PRICE_OUTLIER_EXCLUDED');
  } else if (priceUsd === null) {
    if (currencyStatus.startsWith('AMBIGUOUS')) {
      priceResearchStatus = 'INELIGIBLE_AMBIGUOUS_CURRENCY';
      reviewFlags.push('AMBIGUOUS_BARE_DOLLAR_HELD');
    } else if (currencyStatus.includes('USDT')) {
      priceResearchStatus = 'INELIGIBLE_USDT_HELD_FOR_FX';
      reviewFlags.push('USDT_HELD_FOR_FX_PROOF');
    } else if (originalPriceAmount !== null && Number.isFinite(originalPriceAmount) && originalPriceAmount > 0) {
      priceResearchStatus = 'INELIGIBLE_FX_UNRESOLVED';
      reviewFlags.push('FX_UNRESOLVED_HELD');
    } else {
      priceResearchStatus = 'INELIGIBLE_MISSING_PRICE';
      reviewFlags.push('MISSING_PRICE_OR_CURRENCY');
    }
  } else if (currencyStatus === 'VERIFIED_EXPLICIT_USD' && Number.isFinite(priceUsd) && priceUsd > 0) {
    priceResearchStatus = 'ELIGIBLE_VERIFIED_USD';
    priceResearchEligible = true;
  }

  // Reconciliation Category
  let reconciliationCategory = 'NORMALIZED_PROPOSAL';
  if (reviewFlags.length > 0 || !tradingFloorEligible) {
    reconciliationCategory = 'REVIEW_REQUIRED';
  }

  const parserVersion = 'authoritative-normalizer-v9-separated-status';

  const contractObj = {
    source_id: sourceId,
    source_hash: sourceHash,
    source_cursor: postedAt,
    source_system: sourceSystem,
    source_database: sourceDatabase,
    source_table: sourceTable,
    source_record_id: sourceRecordId,
    source_observed_at: sourceObservedAt,
    posted_at: postedAt,
    listing_text_evidence: listingTextEvidence,
    listing_text_source: listingTextSource,
    listing_text_sha256: listingTextSha256,
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
    location: location,
    image_key: imageKey,
    image_url: imageUrl,
    image_evidence_type: imageEvidenceType,
    bundle_parent_id: bundleParentId,
    bundle_child_lineage: bundleChildLineage,
    is_bundle: isBundle,
    trading_floor_status: tradingFloorStatus,
    trading_floor_eligible: tradingFloorEligible,
    price_research_status: priceResearchStatus,
    price_research_eligible: priceResearchEligible,
    reconciliation_category: reconciliationCategory,
    review_flags: reviewFlags,
    exclusion_reasons: exclusionReasons,
    parser_version: parserVersion
  };

  validateNormalizationStatuses(contractObj);
  contractObj.proposal_hash = computeProposalHash(contractObj);
  return contractObj;
}

function validateNormalizationStatuses(obj) {
  if (obj.intent !== undefined && obj.intent !== null && !NORMALIZATION_STATUS_CONTRACT.intent.includes(obj.intent)) {
    throw new Error(`Invalid intent status: "${obj.intent}"`);
  }
  if (obj.currency_status !== undefined && obj.currency_status !== null && !NORMALIZATION_STATUS_CONTRACT.currency_status.includes(obj.currency_status)) {
    throw new Error(`Invalid currency_status: "${obj.currency_status}"`);
  }
  if (obj.trading_floor_status !== undefined && obj.trading_floor_status !== null && !NORMALIZATION_STATUS_CONTRACT.trading_floor_status.includes(obj.trading_floor_status)) {
    throw new Error(`Invalid trading_floor_status: "${obj.trading_floor_status}"`);
  }
  if (obj.price_research_status !== undefined && obj.price_research_status !== null && !NORMALIZATION_STATUS_CONTRACT.price_research_status.includes(obj.price_research_status)) {
    throw new Error(`Invalid price_research_status: "${obj.price_research_status}"`);
  }
  if (obj.reconciliation_category !== undefined && obj.reconciliation_category !== null && !NORMALIZATION_STATUS_CONTRACT.reconciliation_category.includes(obj.reconciliation_category)) {
    throw new Error(`Invalid reconciliation_category: "${obj.reconciliation_category}"`);
  }
  if (obj.image_evidence_type !== undefined && obj.image_evidence_type !== null && !NORMALIZATION_STATUS_CONTRACT.primary_image_evidence_type.includes(obj.image_evidence_type)) {
    throw new Error(`Invalid image_evidence_type: "${obj.image_evidence_type}"`);
  }
  if (obj.primary_image_evidence_type !== undefined && obj.primary_image_evidence_type !== null && !NORMALIZATION_STATUS_CONTRACT.primary_image_evidence_type.includes(obj.primary_image_evidence_type)) {
    throw new Error(`Invalid primary_image_evidence_type: "${obj.primary_image_evidence_type}"`);
  }
  if (obj.bundle_structure_type !== undefined && obj.bundle_structure_type !== null && !NORMALIZATION_STATUS_CONTRACT.bundle_structure_type.includes(obj.bundle_structure_type)) {
    throw new Error(`Invalid bundle_structure_type: "${obj.bundle_structure_type}"`);
  }
  if (obj.seller_rating_status !== undefined && obj.seller_rating_status !== null && !NORMALIZATION_STATUS_CONTRACT.seller_rating_status.includes(obj.seller_rating_status)) {
    throw new Error(`Invalid seller_rating_status: "${obj.seller_rating_status}"`);
  }
}

function computeProposalHash(contract) {
  const fields = [
    'source_id',
    'source_hash',
    'source_system',
    'source_database',
    'source_table',
    'source_record_id',
    'source_observed_at',
    'posted_at',
    'listing_text_source',
    'listing_text_sha256',
    'brand',
    'model',
    'reference',
    'dial_color',
    'year',
    'condition',
    'intent',
    'original_price_amount',
    'original_price_currency',
    'currency_evidence',
    'price_usd',
    'fx_rate',
    'fx_source',
    'fx_date',
    'currency_status',
    'seller_name',
    'seller_contact',
    'contact_publication_approved',
    'seller_activity_count',
    'seller_rating',
    'seller_rating_status',
    'seller_review_evidence',
    'location',
    'image_key',
    'image_url',
    'image_evidence_type',
    'bundle_parent_id',
    'bundle_child_lineage',
    'is_bundle',
    'trading_floor_status',
    'trading_floor_eligible',
    'price_research_status',
    'price_research_eligible',
    'review_flags',
    'exclusion_reasons',
    'parser_version'
  ];

  const payload = {};
  for (const k of fields) {
    payload[k] = contract[k] === undefined ? null : contract[k];
  }
  return crypto.createHash('sha256').update(JSON.stringify(payload, Object.keys(payload).sort())).digest('hex');
}

const DEFAULT_NYC3_BASE = 'https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full/';

function resolveProductionImageUrl(imageKey, bucketBase = process.env.DO_SPACES_BUCKET_BASE || DEFAULT_NYC3_BASE) {
  if (!imageKey || typeof imageKey !== 'string') return null;
  const cleanKey = imageKey.trim().replace(/^\/+/, '');
  const cleanBase = bucketBase.replace(/\/+$/, '') + '/';
  return `${cleanBase}${cleanKey}`;
}

async function verifyImageReachabilityBounded(imageUrl, fetchFn = globalThis.fetch) {
  if (!imageUrl) return { reachable: false, status: 'NO_URL', error: 'Missing image URL' };
  try {
    const headRes = await fetchFn(imageUrl, { method: 'HEAD' });
    if (headRes.ok) {
      const ct = headRes.headers.get('content-type') || '';
      if (ct.startsWith('image/')) {
        return { reachable: true, status: headRes.status, contentType: ct };
      }
    }
    if (headRes.status === 405 || headRes.status === 403 || !headRes.ok) {
      const getRes = await fetchFn(imageUrl, {
        method: 'GET',
        headers: { Range: 'bytes=0-1023' }
      });
      if (getRes.ok || getRes.status === 206) {
        const getCt = getRes.headers.get('content-type') || '';
        if (getCt.startsWith('image/')) {
          return { reachable: true, status: getRes.status, contentType: getCt };
        }
      }
      return { reachable: false, status: getRes.status, error: `Invalid content-type: ${getRes.headers.get('content-type')}` };
    }
    return { reachable: false, status: headRes.status, error: `Unsuccessful HTTP status ${headRes.status}` };
  } catch (err) {
    return { reachable: false, status: 'NETWORK_ERROR', error: err.message };
  }
}

function buildAuthorizedInquiryContract(proposal, rawRow = null) {
  const sourceSystem = proposal.source_system || (rawRow && rawRow.source_system);
  const sourceDatabase = proposal.source_database || (rawRow && rawRow.source_database);
  const sourceTable = proposal.source_table || (rawRow && rawRow.source_table);
  const sourceId = proposal.source_id || (rawRow && rawRow.source_id);
  const sourceHash = proposal.source_hash || (rawRow && rawRow.source_hash);

  if (!sourceSystem || !sourceDatabase || !sourceTable || !sourceId || !sourceHash) {
    throw new Error(`buildAuthorizedInquiryContract: Missing required composite provenance fields (system=${sourceSystem}, db=${sourceDatabase}, table=${sourceTable}, id=${sourceId}, hash=${sourceHash})`);
  }

  const sellerName = proposal.seller_name || (rawRow && rawRow.raw_payload && rawRow.raw_payload.from_name) || 'Seller';
  const sellerContact = proposal.seller_contact || (rawRow && rawRow.raw_payload && rawRow.raw_payload.from_number) || null;
  const brand = proposal.brand || 'Watch';
  const model = proposal.model || '';
  const ref = proposal.reference ? ` (Ref: ${proposal.reference})` : '';
  const itemDesc = `${brand}${model ? ' ' + model : ''}${ref}`.trim();
  
  const inquiryText = `Hi ${sellerName}, I am inquiring about your listing for ${itemDesc} listed on WatchFlow. Is this piece still available?`;
  
  let digitsOnlyPhone = null;
  let whatsappUrl = null;
  if (sellerContact) {
    digitsOnlyPhone = sellerContact.replace(/\D/g, '');
    if (digitsOnlyPhone.length >= 7) {
      whatsappUrl = `https://wa.me/${digitsOnlyPhone}?text=${encodeURIComponent(inquiryText)}`;
    }
  }

  let maskedContact = null;
  if (sellerContact) {
    const digitsOnly = sellerContact.replace(/\D/g, '');
    if (digitsOnly.length > 4) {
      maskedContact = `+*** *** ${digitsOnly.slice(-4)}`;
    } else {
      maskedContact = '[PRIVATE_SELLER_CONTACT]';
    }
  }

  const isApproved = Boolean(proposal.contact_publication_approved);

  return {
    source_system: sourceSystem,
    source_database: sourceDatabase,
    source_table: sourceTable,
    source_id: sourceId,
    source_hash: sourceHash,
    seller_name: sellerName,
    seller_contact_masked: maskedContact,
    seller_contact_raw: isApproved ? sellerContact : null,
    contact_publication_approved: isApproved,
    inquiry_text: isApproved ? inquiryText : null,
    whatsapp_url: isApproved ? whatsappUrl : null,
    inquiry_ready: Boolean(isApproved && digitsOnlyPhone && digitsOnlyPhone.length >= 7)
  };
}

function computeParentHash(parent) {
  const fields = [
    'source_system',
    'source_database',
    'source_table',
    'source_id',
    'source_hash',
    'source_record_id',
    'source_created_on',
    'source_observed_at',
    'posted_at',
    'raw_message_original',
    'listing_text_source',
    'listing_text_sha256',
    'is_bundle',
    'child_count',
    'bundle_structure_type',
    'seller_name',
    'seller_contact',
    'contact_publication_approved',
    'seller_activity_count',
    'seller_rating',
    'seller_rating_status',
    'seller_review_evidence',
    'location',
    'parser_version',
    'review_flags'
  ];
  const payload = {};
  for (const k of fields) {
    payload[k] = parent[k] === undefined ? null : parent[k];
  }
  return crypto.createHash('sha256').update(JSON.stringify(payload, Object.keys(payload).sort())).digest('hex');
}

function computeChildProposalHash(child) {
  const fields = [
    'parent_source_id',
    'parent_source_hash',
    'child_ordinal',
    'brand',
    'model',
    'reference',
    'dial_color',
    'year',
    'condition',
    'intent',
    'original_price_amount',
    'original_price_currency',
    'currency_evidence',
    'price_usd',
    'fx_rate',
    'fx_source',
    'fx_date',
    'currency_status',
    'is_outlier',
    'outlier_reason',
    'primary_image_key',
    'primary_image_url',
    'primary_image_evidence_type',
    'trading_floor_status',
    'trading_floor_eligible',
    'price_research_status',
    'price_research_eligible',
    'reconciliation_category',
    'review_flags',
    'exclusion_reasons',
    'parser_version'
  ];
  const payload = {};
  for (const k of fields) {
    payload[k] = child[k] === undefined ? null : child[k];
  }
  return crypto.createHash('sha256').update(JSON.stringify(payload, Object.keys(payload).sort())).digest('hex');
}

function normalizeCanonicalParentChild(stagedRow, options = {}) {
  // First run base authoritative row extraction
  const base = normalizeAuthoritativeRow(stagedRow, options);
  const raw = stagedRow.raw_payload || {};
  const rawMessageOriginal = stagedRow.raw_message || base.listing_text_evidence || '';

  const candidates = base.listing_text_evidence ? segmentDealerMessage(base.listing_text_evidence) : [];
  const isMultiOffer = candidates.length > 1;
  const isExplicitBundle = Number(raw.is_bundle) === 1;
  const isBundle = isExplicitBundle || isMultiOffer;

  // Extract all images
  const images = [];
  const rawImages = [];
  if (raw.front_image) rawImages.push({ key: String(raw.front_image).trim(), type: 'SOURCE_LISTING_IMAGE' });
  if (raw.image && raw.image !== raw.front_image) rawImages.push({ key: String(raw.image).trim(), type: 'SOURCE_LISTING_IMAGE' });
  if (raw.back_image && raw.back_image !== raw.front_image && raw.back_image !== raw.image) {
    rawImages.push({ key: String(raw.back_image).trim(), type: 'SOURCE_LISTING_IMAGE' });
  }
  if (Array.isArray(raw.gallery_images)) {
    for (const g of raw.gallery_images) {
      if (g && typeof g === 'string' && !rawImages.some(i => i.key === g.trim())) {
        rawImages.push({ key: g.trim(), type: 'SOURCE_LISTING_IMAGE' });
      }
    }
  }

  rawImages.forEach((img, idx) => {
    images.push({
      image_ordinal: idx,
      image_key: img.key,
      image_url: null, // Keep null until proven reachable
      image_evidence_type: 'IMAGE_KEY_PRESERVED_URL_UNVERIFIED'
    });
  });

  const primaryImg = images[0] || {
    image_key: null,
    image_url: null,
    image_evidence_type: 'NO_IMAGE'
  };

  const children = [];

  if (isMultiOffer && candidates.length > 1) {
    // Generate multi-offer children
    candidates.forEach((cand, idx) => {
      const candRef = cand.reference || null;
      let candBrand = candRef ? inferBrandFromReference(candRef) : null;
      if (!candBrand && cand.rawLine) {
        for (const [pat, bName] of BRAND_HEADERS) {
          if (pat.test(cand.rawLine)) {
            candBrand = bName;
            break;
          }
        }
      }
      let candModel = null;
      let candDial = null;
      let candCondition = null;
      let candYear = null;

      if (cand.rawLine) {
        candDial = normalizeWatchDial(null, cand.rawLine);
        if (candDial) {
          const nd = normalizeDialValue(candDial);
          if (nd && nd.known) candDial = nd.value;
        }
        candCondition = normalizeWatchCondition(null, cand.rawLine);
        candYear = extractYearFromText(cand.rawLine);
      }

      const candPrices = cand.rawLine ? extractPriceCandidates(cand.rawLine) : [];
      const autoPrices = candPrices.filter(c => c.evidence_status === 'AUTO_APPROVED' && !c.review_required);
      const candPrimaryPrice = autoPrices[0] || null;

      let origAmount = null;
      let origCurr = null;
      let currEv = null;
      let pUsd = null;
      let fxR = null;
      let fxS = null;
      let fxD = null;
      let currStatus = 'MISSING_PRICE';

      if (candPrimaryPrice) {
        origAmount = candPrimaryPrice.amount_original;
        origCurr = candPrimaryPrice.currency_original;
        currEv = candPrimaryPrice.currency_evidence || 'explicit_listing_text_token';
        if (origCurr === 'USD') {
          pUsd = candPrimaryPrice.amount_usd || origAmount;
          fxR = 1.0;
          fxS = '1:1_PARITY_PROOF';
          fxD = base.posted_at ? String(base.posted_at).slice(0, 10) : null;
          currStatus = 'VERIFIED_EXPLICIT_USD';
        } else if (origCurr === 'USDT') {
          currStatus = 'VERIFIED_EXPLICIT_USDT_HELD_FOR_FX';
        } else if (origCurr === 'HKD') {
          currStatus = 'VERIFIED_EXPLICIT_HKD_HELD_FOR_FX';
        } else {
          currStatus = 'VERIFIED_EXPLICIT_' + origCurr;
        }
      } else if (candPrices.some(c => c.review_reason === 'CURRENCY_AMBIGUOUS' || c.parser_rule === 'bare_dollar')) {
        currStatus = 'AMBIGUOUS_BARE_DOLLAR_HELD';
      }

      // Outlier check
      let isOutlier = false;
      let outlierReason = null;
      if (pUsd !== null && (pUsd > 500000 || pUsd < 100)) {
        isOutlier = true;
        outlierReason = pUsd > 500000 ? 'PRICE_HIGH_OUTLIER' : 'PRICE_LOW_OUTLIER';
      }

      const childFlags = [];
      const childExclusions = [];
      let tfStatus = 'HELD_UNKNOWN';
      let tfEligible = false;

      if (!candBrand && !candRef) {
        tfStatus = 'HELD_IDENTITY_INCOMPLETE';
        childFlags.push('INCOMPLETE_IDENTITY');
        childExclusions.push('IDENTITY_UNRECOGNIZED');
      } else if (base.intent === 'WITHDRAWN') {
        tfStatus = 'HELD_WITHDRAWN';
        childExclusions.push('LISTING_WITHDRAWN');
      } else if (base.intent === null) {
        tfStatus = 'HELD_INTENT_UNKNOWN';
        childFlags.push('UNKNOWN_INTENT');
        childExclusions.push('INTENT_UNKNOWN_HELD_FROM_PUBLICATION');
      } else if (base.intent === 'WTS') {
        tfStatus = 'ELIGIBLE_WTS';
        tfEligible = true;
      } else if (base.intent === 'WTB') {
        tfStatus = 'ELIGIBLE_WTB';
        tfEligible = true;
      }

      let prStatus = 'INELIGIBLE_OTHER';
      let prEligible = false;
      if (!tfEligible) {
        prStatus = 'INELIGIBLE_TRADING_FLOOR_HOLD';
      } else if (base.intent !== 'WTS') {
        prStatus = 'INELIGIBLE_NOT_WTS';
        childExclusions.push('INTENT_NOT_WTS');
      } else if (!candBrand || !candRef) {
        prStatus = 'INELIGIBLE_IDENTITY_INCOMPLETE';
      } else if (pUsd === null) {
        if (currStatus.startsWith('AMBIGUOUS')) {
          prStatus = 'INELIGIBLE_AMBIGUOUS_CURRENCY';
          childFlags.push('AMBIGUOUS_BARE_DOLLAR_HELD');
        } else if (currStatus.includes('USDT')) {
          prStatus = 'INELIGIBLE_USDT_HELD_FOR_FX';
          childFlags.push('USDT_HELD_FOR_FX_PROOF');
        } else if (currStatus.includes('HKD')) {
          prStatus = 'INELIGIBLE_HKD_HELD_FOR_FX';
          childFlags.push('HKD_HELD_FOR_FX_PROOF');
        } else if (origAmount !== null && Number.isFinite(origAmount) && origAmount > 0) {
          prStatus = 'INELIGIBLE_FX_UNRESOLVED';
          childFlags.push('FX_UNRESOLVED_HELD');
        } else {
          prStatus = 'INELIGIBLE_MISSING_PRICE';
          childFlags.push('MISSING_PRICE_OR_CURRENCY');
        }
      } else if (currStatus === 'VERIFIED_EXPLICIT_USD' && Number.isFinite(pUsd) && pUsd > 0 && !isOutlier) {
        prStatus = 'ELIGIBLE_VERIFIED_USD';
        prEligible = true;
      }

      let reconCat = (childFlags.length > 0 || !tfEligible) ? 'REVIEW_REQUIRED' : 'NORMALIZED_PROPOSAL';

      const childObj = {
        parent_source_id: base.source_id,
        parent_source_hash: base.source_hash,
        child_ordinal: idx,
        raw_line: cand.rawLine || null,
        brand: candBrand || null,
        model: candModel || null,
        reference: candRef || null,
        dial_color: candDial || null,
        year: candYear || null,
        condition: candCondition || null,
        intent: base.intent || null,
        original_price_amount: origAmount,
        original_price_currency: origCurr,
        currency_evidence: currEv,
        price_usd: pUsd,
        fx_rate: fxR,
        fx_source: fxS,
        fx_date: fxD,
        currency_status: currStatus,
        is_outlier: isOutlier,
        outlier_reason: outlierReason,
        primary_image_key: primaryImg.image_key,
        primary_image_url: primaryImg.image_url,
        primary_image_evidence_type: primaryImg.image_evidence_type,
        trading_floor_status: tfStatus,
        trading_floor_eligible: tfEligible,
        price_research_status: prStatus,
        price_research_eligible: prEligible,
        reconciliation_category: reconCat,
        review_flags: childFlags,
        exclusion_reasons: childExclusions,
        parser_version: 'authoritative-canonical-v10-parent-child',
        images: images
      };

      childObj.child_proposal_hash = computeChildProposalHash(childObj);
      childObj.child_unique_key = `${base.source_id}:c:${idx}:${childObj.child_proposal_hash}`;
      children.push(childObj);
    });
  } else {
    // Single child (ordinal 0)
    let isOutlier = false;
    let outlierReason = null;
    if (base.price_usd !== null && (base.price_usd > 500000 || base.price_usd < 100)) {
      isOutlier = true;
      outlierReason = base.price_usd > 500000 ? 'PRICE_HIGH_OUTLIER' : 'PRICE_LOW_OUTLIER';
    }

    const singleChild = {
      parent_source_id: base.source_id,
      parent_source_hash: base.source_hash,
      child_ordinal: 0,
      raw_line: base.raw_message_original || null,
      brand: base.brand || null,
      model: base.model || null,
      reference: base.reference || null,
      dial_color: base.dial_color || null,
      year: base.year || null,
      condition: base.condition || null,
      intent: base.intent || null,
      original_price_amount: base.original_price_amount,
      original_price_currency: base.original_price_currency,
      currency_evidence: base.currency_evidence,
      price_usd: base.price_usd,
      fx_rate: base.fx_rate,
      fx_source: base.fx_source,
      fx_date: base.fx_date,
      currency_status: base.currency_status,
      is_outlier: isOutlier,
      outlier_reason: outlierReason,
      primary_image_key: primaryImg.image_key,
      primary_image_url: primaryImg.image_url,
      primary_image_evidence_type: primaryImg.image_evidence_type,
      trading_floor_status: base.trading_floor_status,
      trading_floor_eligible: base.trading_floor_eligible,
      price_research_status: (isOutlier && base.price_research_eligible) ? 'INELIGIBLE_OUTLIER_EXCLUDED' : base.price_research_status,
      price_research_eligible: isOutlier ? false : base.price_research_eligible,
      reconciliation_category: base.reconciliation_category,
      review_flags: base.review_flags,
      exclusion_reasons: base.exclusion_reasons,
      parser_version: 'authoritative-canonical-v10-parent-child',
      images: images
    };

    singleChild.child_proposal_hash = computeChildProposalHash(singleChild);
    singleChild.child_unique_key = `${base.source_id}:c:0:${singleChild.child_proposal_hash}`;
    children.push(singleChild);
  }

  const parent = {
    source_system: base.source_system,
    source_database: base.source_database,
    source_table: base.source_table,
    source_id: base.source_id,
    source_hash: base.source_hash,
    source_record_id: base.source_record_id,
    source_created_on: base.posted_at,
    source_observed_at: base.source_observed_at,
    posted_at: base.posted_at,
    raw_message_original: rawMessageOriginal,
    listing_text_source: base.listing_text_source,
    listing_text_sha256: base.listing_text_sha256,
    raw_payload: raw,
    is_bundle: isBundle,
    child_count: children.length,
    bundle_structure_type: isMultiOffer ? 'MULTI_OFFER_BUNDLE' : 'SINGLE',
    seller_name: base.seller_name,
    seller_contact: base.seller_contact,
    contact_publication_approved: false,
    seller_activity_count: base.seller_activity_count,
    seller_rating: base.seller_rating,
    seller_rating_status: base.seller_rating_status,
    seller_review_evidence: base.seller_review_evidence,
    location: base.location,
    parser_version: 'authoritative-canonical-v10-parent-child',
    review_flags: base.review_flags,
    children: children
  };

  validateNormalizationStatuses(parent);
  children.forEach(c => validateNormalizationStatuses(c));

  parent.parent_hash = computeParentHash(parent);

  return { parent, children, images };
}

module.exports = {
  normalizeAuthoritativeRow,
  normalizeCanonicalParentChild,
  computeProposalHash,
  computeParentHash,
  computeChildProposalHash,
  buildAuthorizedInquiryContract,
  resolveProductionImageUrl,
  verifyImageReachabilityBounded,
  DEFAULT_NYC3_BASE,
  resolveSourceTextEvidence,
  resolveStrictIntentFromText,
  extractYearFromText,
  sha256
};


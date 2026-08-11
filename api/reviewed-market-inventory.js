'use strict';

const { getClient } = require('./_lib/supabase');
const { parseTradingSearch } = require('./_lib/trading-search.cjs');
const { listEquivalentReferences } = require('./_lib/catalog');
const {
  cleanExactText,
  loadSummary,
  resolvePageWindow,
} = require('./reviewed-workbook-inventory.js');

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;
const EXPLICIT_USD_STATUS = 'SOURCE_EXPLICIT_USD_MATCH';
const ALLOWED_MARKET_SOURCE_VIEWS = new Set([
  'reviewed_workbook_market_source_v2',
  'qnsa_rolex_patek_trading_floor_source',
]);
const requestedMarketSourceView = String(process.env.TRADING_FLOOR_SOURCE_VIEW || '').trim();
const MARKET_SOURCE_VIEW = ALLOWED_MARKET_SOURCE_VIEWS.has(requestedMarketSourceView)
  ? requestedMarketSourceView
  : 'reviewed_workbook_market_source_v2';
const MULTIPLE_LISTING_IDENTITY_VALUES = ['multiple', 'multi', 'mixed'];
const MIN_PUBLIC_WORKBOOK_PRICE_USD = 1_000;
const MAX_PUBLIC_WORKBOOK_PRICE_USD = 100_000_000;
let legacyMarketViewContractDetected = false;

function qnsaReviewedReleaseSummary() {
  return {
    files_total: 1,
    files_complete: 1,
    source_rows: 1_394_269,
    rows_scanned: 1_394_269,
    canonical_listings: null,
    duplicate_rows_held: null,
    errors: 0,
    reconciled: true,
    source: 'mariadb-normalized-20260811-codex-v1',
    brands: [
      { brand: 'Rolex', files: 1, files_complete: 1, source_rows: null, canonical_listings: null, duplicate_rows_held: null },
      { brand: 'Patek Philippe', files: 1, files_complete: 1, source_rows: null, canonical_listings: null, duplicate_rows_held: null },
    ],
  };
}

const EVIDENCE_CONTRACT = Object.freeze({
  scope: 'returned_page',
  identity_fields: ['brand', 'model', 'reference', 'dial_color'],
  identity: 'Available identity fields are published; complete valid identity is required only for price-research eligibility.',
  contact: 'Seller identity may be published when supplied; phone/contact details require source-backed publication consent.',
  image: 'Only an exact supplied HTTP(S) source URL is image-eligible.',
  price: 'Only an exact explicit-source USD match is analytics-eligible.',
  rating: 'Rated status requires a source-supplied rating and a positive source review count; unsupported legacy rows remain unrated.',
});

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function workbookPriceReviewReason(value) {
  const price = positiveNumber(value);
  if (price === null) return null;
  if (price < MIN_PUBLIC_WORKBOOK_PRICE_USD) return 'WORKBOOK_PRICE_BELOW_PUBLIC_PLAUSIBILITY';
  if (price > MAX_PUBLIC_WORKBOOK_PRICE_USD) return 'WORKBOOK_PRICE_ABOVE_PUBLIC_PLAUSIBILITY';
  return null;
}

function exactHttpUrl(value) {
  const exact = cleanExactText(value, 2_000);
  if (!exact) return null;
  try {
    const parsed = new URL(exact);
    return ['http:', 'https:'].includes(parsed.protocol) ? exact : null;
  } catch {
    return null;
  }
}

function referenceComparisonKey(value) {
  return cleanExactText(value, 80).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function amountComparisonKey(value) {
  const amount = positiveNumber(value);
  return amount === null ? '' : String(amount).replace(/[^0-9]/g, '');
}

function currencyComparisonKey(value) {
  return cleanExactText(value, 12).toUpperCase().replace(/[^A-Z]/g, '');
}

function referenceIsPriceToken(reference, sourceAmount, sourceCurrency) {
  const referenceKey = referenceComparisonKey(reference);
  if (!referenceKey) return false;
  if (/^(?:USD|USDT|HKD|EUR|GBP|CHF|SGD|AUD|CAD|JPY|CNY|RMB)[0-9]+$/.test(referenceKey)) {
    return true;
  }
  if (/^[0-9]+(?:USD|USDT|HKD|EUR|GBP|CHF|SGD|AUD|CAD|JPY|CNY|RMB)$/.test(referenceKey)) {
    return true;
  }
  const amountKey = amountComparisonKey(sourceAmount);
  const currencyKey = currencyComparisonKey(sourceCurrency);
  return Boolean(
    amountKey
    && currencyKey
    && (referenceKey === `${amountKey}${currencyKey}`
      || referenceKey === `${currencyKey}${amountKey}`),
  );
}

function evidenceValuePresent(value) {
  return value !== null
    && value !== undefined
    && !/^(?:unknown|null|n\/a)$/i.test(String(value).trim())
    && String(value).trim() !== '';
}

function isNormalizedWorkbookSummary(row) {
  const raw = cleanExactText(row.raw_message, 10_000).replace(/\s+/g, ' ');
  if (!raw || !row.source_file || !/\.xlsx$/i.test(String(row.source_file))) return false;
  const brand = cleanExactText(row.supplied_brand || row.canonical_brand || row.brand_scope, 80);
  const reference = cleanExactText(row.normalized_reference || row.raw_reference || row.catalog_reference, 80);
  const dial = cleanExactText(row.dial_color || row.catalog_dial, 80);
  const type = cleanExactText(row.listing_type || 'OTHER', 12).toUpperCase();
  // Workbook-generated summaries can contain the normalized workbook amount even
  // when no source-backed price was retained. Use it only to identify the
  // summary text; publication eligibility still depends on source evidence.
  const amount = positiveNumber(row.source_price_amount) ?? positiveNumber(row.workbook_price_usd);
  const base = [type, brand, reference, dial].filter(Boolean).join(' ');
  const candidates = new Set([base]);
  if (amount !== null) {
    candidates.add(`${base} ${amount.toFixed(2)}`);
    candidates.add(`${base} ${amount}`);
  }
  return candidates.has(raw);
}

function isMultiListing(row) {
  const listingType = cleanExactText(row.listing_type, 30).toUpperCase();
  if (row.is_bundle === true || ['MULTI', 'MULTI_LISTING', 'BUNDLE'].includes(listingType)) return true;
  return [row.model, row.catalog_model, row.dial_color, row.catalog_dial]
    .some(value => MULTIPLE_LISTING_IDENTITY_VALUES.includes(cleanExactText(value, 40).toLowerCase()));
}

function safeSearchTerm(value) {
  return cleanExactText(value, 120)
    .replace(/[,%()*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function locationSearchPattern(value) {
  const tokens = cleanExactText(value, 100)
    .split(/[,%()*\s]+/)
    .map(token => token.trim())
    .filter(Boolean);
  return tokens.length ? `*${tokens.join('*')}*` : '';
}

function locationMatches(value, query) {
  const normalizedValue = cleanExactText(value, 100)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const normalizedQuery = cleanExactText(query, 100)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Boolean(normalizedQuery) && normalizedValue.includes(normalizedQuery);
}

const DATE_WINDOWS = Object.freeze({
  '1D': 1,
  '7D': 7,
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
});

function dateWindowStart(value, now = new Date()) {
  const days = DATE_WINDOWS[cleanExactText(value, 4).toUpperCase()];
  if (!days || Number.isNaN(now.getTime())) return null;
  return new Date(now.getTime() - (days * 24 * 60 * 60 * 1000)).toISOString();
}

function isSourceBackedRatedDealer(record) {
  const rating = Number(record?.seller_rating);
  const reviews = Number(record?.seller_review_count);
  return record?.seller_rating_evidence_status === 'SOURCE_SUPPLIED'
    && Number.isFinite(rating) && rating > 0
    && Number.isFinite(reviews) && reviews > 0;
}

function ratingMatches(record, requestedRating) {
  const filter = cleanExactText(requestedRating, 12).toLowerCase();
  if (!filter) return true;
  const rated = isSourceBackedRatedDealer(record);
  return filter === 'rated' ? rated : filter === 'unrated' ? !rated : false;
}

function isPriorityHumanReviewBrand(value) {
  const brand = cleanExactText(value, 80).toUpperCase();
  return brand === 'ROLEX' || brand === 'PATEK PHILIPPE' || brand === 'PATEK';
}

function searchTermsMatch(record, query) {
  const normalizeSearchText = value => String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = safeSearchTerm(query).toLowerCase().split(/\s+/)
    .map(normalizeSearchText)
    .filter(Boolean);
  if (!tokens.length) return true;
  const haystack = normalizeSearchText([
    record.brand,
    record.model,
    record.reference,
    record.dial_color,
    record.seller_name,
    record.seller_phone,
    record.location,
    record.raw_message,
  ].filter(Boolean).join(' '));
  const compactHaystack = haystack.replace(/\s+/g, '');
  return tokens.every(token => haystack.includes(token) || compactHaystack.includes(token.replace(/\s+/g, '')));
}

function recordEvidenceCoverage({
  brand,
  model,
  reference,
  dialColor,
  sellerName,
  sellerPhone,
  contactApproved,
  exactImageUrl,
  sourceAmount,
  sourceCurrency,
  hasCompleteIdentity,
  invalidReferenceReason,
  priceEligible,
}) {
  const identity = { brand, model, reference, dial_color: dialColor };
  const presentFields = Object.entries(identity)
    .filter(([, value]) => evidenceValuePresent(value))
    .map(([field]) => field);
  const missingFields = Object.keys(identity).filter(field => !presentFields.includes(field));
  return {
    identity: {
      complete: hasCompleteIdentity,
      present_fields: presentFields,
      missing_fields: missingFields,
      invalid_reference_reason: invalidReferenceReason,
    },
    contact: {
      name_present: evidenceValuePresent(sellerName),
      phone_present: evidenceValuePresent(sellerPhone),
      publication_approved: contactApproved,
      available: evidenceValuePresent(sellerPhone),
    },
    image: {
      available: exactImageUrl !== null,
      provenance: exactImageUrl ? 'EXACT_SOURCE_URL' : 'NONE',
    },
    price: {
      source_amount_present: sourceAmount !== null,
      source_currency_present: evidenceValuePresent(sourceCurrency),
      analytics_eligible: priceEligible,
    },
  };
}

function summarizeCoverage(records) {
  const totals = {
    scope: 'returned_page',
    record_count: records.length,
    identity_complete: 0,
    contact_available: 0,
    exact_source_image: 0,
    supplied_price: 0,
    price_not_supplied: 0,
    price_analytics_eligible: 0,
  };
  for (const record of records) {
    totals.identity_complete += Number(record.evidence_coverage.identity.complete);
    totals.contact_available += Number(record.evidence_coverage.contact.available);
    totals.exact_source_image += Number(record.evidence_coverage.image.available);
    totals.supplied_price += Number(Boolean(hasUsableSourcePrice(record)));
    totals.price_not_supplied += Number(!hasUsableSourcePrice(record));
    totals.price_analytics_eligible += Number(record.evidence_coverage.price.analytics_eligible);
  }
  return totals;
}

function hasUsableSourcePrice(record) {
  return positiveNumber(record?.source_price_amount)
    ?? positiveNumber(record?.price_raw)
    ?? positiveNumber(record?.price_usd)
    ?? null;
}

function inventoryIdentityKey(record) {
  const brand = cleanExactText(record?.brand || record?.canonical_brand || record?.supplied_brand, 80)
    .toUpperCase();
  const reference = referenceComparisonKey(
    record?.reference || record?.normalized_reference || record?.catalog_reference,
  );
  const model = cleanExactText(record?.model || record?.catalog_model, 120).toUpperCase();
  return `${brand}\u001f${reference || model}`;
}

function compareInventoryForDisplay(left, right) {
  if (inventoryIdentityKey(left) === inventoryIdentityKey(right)) {
    const priceDifference = Number(Boolean(hasUsableSourcePrice(right)))
      - Number(Boolean(hasUsableSourcePrice(left)));
    if (priceDifference !== 0) return priceDifference;
  }
  const imageDifference = Number(right?.has_images === true) - Number(left?.has_images === true);
  if (imageDifference !== 0) return imageDifference;
  const priceDifference = Number(Boolean(hasUsableSourcePrice(right)))
    - Number(Boolean(hasUsableSourcePrice(left)));
  if (priceDifference !== 0) return priceDifference;
  const rightDate = Date.parse(right?.listing_date || right?.created_at || '') || 0;
  const leftDate = Date.parse(left?.listing_date || left?.created_at || '') || 0;
  if (rightDate !== leftDate) return rightDate - leftDate;
  return String(right?.id || '').localeCompare(String(left?.id || ''));
}

function isApprovedInventoryRecord(record) {
  const storedConfidence = Number(record?.confidence);
  const confidence = storedConfidence >= 0 && storedConfidence <= 1
    ? storedConfidence * 100
    : storedConfidence;
  const status = String(record?.listing_status || '').trim().toUpperCase();
  return String(record?.verdict || '').trim().toUpperCase() === 'APPROVED'
    && Number.isFinite(confidence)
    && confidence >= 90
    && !['BUNDLE_CHILD_PENDING_REVIEW', 'BUNDLE_PENDING_SEPARATION', 'SUPPRESSED_EXACT_DUPLICATE', 'HIDDEN', 'REJECTED', 'DELETED'].includes(status);
}

function normalizeItemCategory(value) {
  const category = cleanExactText(value, 30).toUpperCase();
  return ['WATCH', 'HANDBAG', 'JEWELRY', 'ACCESSORY', 'OTHER'].includes(category)
    ? category
    : 'OTHER';
}

// Older reviewed rows predate item_category and were emitted as OTHER. Recover
// WATCH only from a watch-exclusive brand plus a source-backed reference. Do
// not infer cross-category houses (Cartier, Bulgari, Chanel, Hermes, Chopard),
// because their brand/reference fields can describe jewelry or leather goods.
const WATCH_EXCLUSIVE_BRANDS = new Set([
  'ROLEX', 'PATEK PHILIPPE', 'PATEK', 'AUDEMARS PIGUET', 'RICHARD MILLE',
  'HUBLOT', 'OMEGA', 'VACHERON CONSTANTIN', 'JAEGER-LECOULTRE', 'IWC',
  'A. LANGE & SOHNE', 'A. LANGE & SÖHNE', 'BREGUET', 'BLANCPAIN', 'TUDOR',
  'BREITLING', 'TAG HEUER', 'PANERAI', 'GRAND SEIKO', 'SEIKO', 'ORIS',
  'ZENITH', 'ROGER DUBUIS', 'URWERK', 'MB&F', 'F.P. JOURNE',
  'FP JOURNE', 'H. MOSER & CIE', 'GREUBEL FORSEY', 'JACOB & CO',
]);

function effectiveItemCategory(row) {
  const explicit = normalizeItemCategory(row?.item_category || row?.category);
  if (explicit !== 'OTHER') return explicit;
  const brand = cleanExactText(
    row?.canonical_brand || row?.supplied_brand || row?.brand_scope || row?.brand,
    80,
  ).toUpperCase();
  const reference = cleanExactText(
    row?.catalog_reference || row?.normalized_reference || row?.raw_reference || row?.reference,
    80,
  );
  return WATCH_EXCLUSIVE_BRANDS.has(brand) && reference ? 'WATCH' : 'OTHER';
}

function isTradingFloorSourceRow(row) {
  const itemCategory = effectiveItemCategory(row);
  const listingType = cleanExactText(row?.listing_type, 30).toUpperCase();
  const status = cleanExactText(row?.trading_floor_status || row?.listing_status, 60).toUpperCase();
  if (!['WATCH', 'HANDBAG', 'JEWELRY', 'ACCESSORY'].includes(itemCategory)) return false;
  if (!['WTS', 'WTB'].includes(listingType)) return false;
  if (row?.parent_id || row?.is_bundle === true) return false;
  if (['BUNDLE_CHILD_PENDING_REVIEW', 'BUNDLE_PENDING_SEPARATION', 'SUPPRESSED_EXACT_DUPLICATE', 'HIDDEN', 'REJECTED', 'DELETED', 'ARCHIVED'].includes(status)) {
    return false;
  }
  if (isApprovedInventoryRecord({
    verdict: row?.verdict || row?.verification_status,
    confidence: row?.confidence,
    listing_status: status,
  })) {
    return true;
  }
  const reviewedQnsaRelease = row?.publication_lane === 'QNSA_ROLEX_PATEK_REVIEWED_V1'
    && row?.normalization_run_complete === true
    && row?.raw_lineage_verified === true
    && ['APPROVED', 'PENDING_VERIFICATION'].includes(row?.publication_state);
  const pendingCategoryEligible = itemCategory === 'WATCH'
    ? isPriorityHumanReviewBrand(row?.canonical_brand || row?.supplied_brand || row?.brand_scope)
    : true;
  return pendingCategoryEligible && (reviewedQnsaRelease || (
    status === 'PUBLISHED_PENDING_VERIFICATION'
    && row?.publication_lane === 'QNSA_NORMALIZED_STAGING_V1'
    && row?.normalization_run_complete === true
    && row?.raw_lineage_verified === true
    && row?.publication_state === 'PENDING_VERIFICATION'
  ));
}

function mapDealerSubmission(row) {
  const claimed = row.claimed_fields || {};
  const multiListing = claimed.is_bundle === true;
  const imageUrls = (row.image_urls || []).filter(value => exactHttpUrl(value));
  const priceRaw = positiveNumber(claimed.price_amount);
  const currency = cleanExactText(claimed.currency, 12).toUpperCase() || null;
  const priceUsd = currency === 'USD' ? priceRaw : null;
  const brand = cleanExactText(claimed.brand, 80) || null;
  const model = cleanExactText(claimed.model, 120) || cleanExactText(claimed.title, 240) || null;
  const reference = cleanExactText(claimed.reference, 80) || null;
  const dialColor = cleanExactText(claimed.dial_color, 80) || null;
  const sellerName = cleanExactText(claimed.poster_name, 160) || null;
  const sellerPhone = cleanExactText(claimed.poster_phone, 50) || null;
  const hasCompleteIdentity = row.category !== 'WATCH' || Boolean(brand && model && reference && dialColor);
  const priceEligible = row.category === 'WATCH' && hasCompleteIdentity && priceUsd !== null;
  const evidenceCoverage = recordEvidenceCoverage({
    brand, model, reference, dialColor, sellerName, sellerPhone,
    contactApproved: true, exactImageUrl: imageUrls[0] || null,
    sourceAmount: priceRaw, sourceCurrency: currency, hasCompleteIdentity,
    invalidReferenceReason: null, priceEligible,
  });
  return {
    id: row.id, brand, model, reference,
    reference_search_key: reference ? referenceComparisonKey(reference) : null,
    raw_reference: reference, normalized_reference: reference, catalog_reference: null,
    reference_invalid_reason: null, has_complete_identity: hasCompleteIdentity,
    dial_color: dialColor, condition: claimed.condition || null,
    listing_type: row.intent, listing_date: row.created_at, created_at: row.created_at,
    raw_message: row.raw_message, raw_message_scope: 'stored_source_message',
    raw_message_evidence_type: 'USER_ENTERED_SOURCE_MESSAGE',
    seller_name: sellerName, seller_phone: sellerPhone, seller_avatar_url: row.poster_image_url || null,
    seller_rating: positiveNumber(claimed.dealer_rating),
    seller_review_count: Number(claimed.review_count || 0),
    seller_rating_evidence_status: positiveNumber(claimed.dealer_rating) !== null && Number(claimed.review_count || 0) > 0
      ? 'SOURCE_SUPPLIED'
      : 'UNAVAILABLE',
    seller_group_count: Number(claimed.group_count || 0),
    seller_credential_status: cleanExactText(claimed.credential_status, 30) || null,
    contact_publication_approved: true, price_usd: priceUsd, price_raw: priceRaw,
    currency, workbook_price_usd: null, workbook_price_review_reason: null,
    source_price_amount: priceRaw, source_price_text: priceRaw == null ? null : String(priceRaw),
    source_currency: currency, price_evidence_status: priceEligible ? EXPLICIT_USD_STATUS : priceRaw == null ? 'NO_PRICE_SUPPLIED' : 'NON_USD_USER_SUPPLIED',
    price_research_eligible: priceEligible, confidence: 1, verdict: row.review_status,
    listing_status: row.publication_status, source: 'AUTHENTICATED_USER_FORM',
    source_type: 'authenticated_user_form', source_file: null, source_row_number: null,
    source_record_id: row.id, item_category: row.category, multi_listing: multiListing,
    is_unbundled_child: false,
    has_images: !multiListing && imageUrls.length > 0,
    thumbnail_url: multiListing ? null : (imageUrls[0] || null),
    image_urls: multiListing ? [] : imageUrls,
    image_evidence_type: multiListing ? 'NO_IMAGE' : 'SOURCE_LISTING_IMAGE',
    image_evidence_label: multiListing ? null : 'Posting-user supplied item image',
    image_evidence_notice: multiListing
      ? 'A multi-item source image is withheld until each item is separated and verified.'
      : 'Photo supplied directly with this authenticated post.',
    location: claimed.location || null, evidence_coverage: evidenceCoverage,
  };
}

function directSubmissionMatches(record, filters) {
  if (filters.itemCategory && filters.itemCategory !== 'ALL' && record.item_category !== filters.itemCategory) return false;
  if (filters.imagesOnly && !record.has_images) return false;
  if (filters.pricedOnly && record.price_raw == null) return false;
  if (filters.listingType && record.listing_type !== filters.listingType) return false;
  if (filters.brand && record.brand?.toLowerCase() !== filters.brand.toLowerCase()) return false;
  if (filters.reference && record.reference_search_key !== filters.reference) return false;
  if (filters.dial && record.dial_color?.toLowerCase() !== filters.dial.toLowerCase()) return false;
  if (filters.condition && record.condition?.toLowerCase() !== filters.condition.toLowerCase()) return false;
  if (filters.region) {
    if (!locationMatches(record.location, filters.region)) return false;
  }
  if (!ratingMatches(record, filters.rating)) return false;
  if (filters.postedAfter && new Date(record.listing_date || record.created_at || 0).getTime() < new Date(filters.postedAfter).getTime()) return false;
  if (filters.search) {
    if (!searchTermsMatch(record, filters.search)) return false;
  }
  return true;
}

function directSubmissionMatchesImageLane(record, lane) {
  return lane === 'images' ? record.has_images === true : record.has_images === false;
}

function mapReviewedRecord(row) {
  // Publish only user_image_url, the exact source upload retained by the view.
  const candidateImageUrl = row.user_image_url || null;
  const hasExactSourceImage = row.has_exact_source_image === true
    && candidateImageUrl
    && String(candidateImageUrl).trim().length > 0
    && /^https?:\/\/[^\s]+$/i.test(String(candidateImageUrl).trim());
  const hasVerifiedUsdPrice = row.has_verified_usd_price === true
    && row.verified_price_usd > 0;
  const verifiedPriceUsd = hasVerifiedUsdPrice ? row.verified_price_usd : null;

  // The production workbook index and view already enforce an exact supplied
  // HTTP(S) token with no whitespace. Preserve that source token verbatim;
  // URL() is unnecessarily stricter for legacy object names and can move a
  // database-qualified source image into the wrong pagination lane.
  const exactImageUrl = hasExactSourceImage
    ? String(candidateImageUrl).trim()
    : null;
  const contactApproved = row.contact_publication_approved === true;
  const sourceAmount = positiveNumber(row.source_price_amount);
  const workbookUsd = positiveNumber(row.workbook_price_usd);
  const workbookPriceReview = workbookPriceReviewReason(row.workbook_price_usd);
  const verifiedUsd = hasVerifiedUsdPrice
    ? positiveNumber(verifiedPriceUsd)
    : null;
  const brand = row.supplied_brand || row.canonical_brand || row.brand_scope;
  const model = row.model || row.catalog_model || null;
  const sourceReference = row.normalized_reference || row.raw_reference || row.catalog_reference || null;
  const invalidReference = row.reference_is_price_token === true
    || referenceIsPriceToken(sourceReference, sourceAmount, row.source_currency);
  const approvedReference = invalidReference ? null : (row.public_reference || sourceReference);
  const reference = !invalidReference
    && evidenceValuePresent(row.raw_reference)
    && referenceComparisonKey(row.raw_reference) === referenceComparisonKey(approvedReference)
    ? row.raw_reference
    : approvedReference;
  const dialColor = row.dial_color || row.catalog_dial || null;
  const sellerName = evidenceValuePresent(row.posted_by || row.seller_name || row.from_name)
    ? (row.posted_by || row.seller_name || row.from_name)
    : null;
  const sellerPhone = contactApproved && evidenceValuePresent(row.phone_number || row.seller_phone || row.from_number)
    ? (row.phone_number || row.seller_phone || row.from_number)
    : null;
  const referenceSearchKey = row.reference_search_key
    || referenceComparisonKey(reference)
    || null;

  const locallyCompleteIdentity = [brand, model, reference, dialColor]
    .every(evidenceValuePresent);
  const hasCompleteIdentity = locallyCompleteIdentity && !invalidReference;
  const priceEligible = hasCompleteIdentity && verifiedUsd !== null;
  const normalizedSummary = isNormalizedWorkbookSummary(row);
  const multiListing = isMultiListing(row);
  const isUnbundledChild = evidenceValuePresent(row.parent_id);
  const publicImageUrl = multiListing || isUnbundledChild ? null : exactImageUrl;
  const storedConfidence = Number(row.confidence);
  const confidencePercent = storedConfidence >= 0 && storedConfidence <= 1
    ? storedConfidence * 100
    : storedConfidence;
  const priorityHumanReview = isPriorityHumanReviewBrand(brand)
    && (!Number.isFinite(confidencePercent) || confidencePercent < 90
      || /(?:HUMAN|NEEDS_REVIEW|UNVERIFIED|CONFLICT)/i.test(String(row.verification_status || row.verdict || '')));
  const pendingVerification = priorityHumanReview
    || String(row.publication_state || '').toUpperCase() === 'PENDING_VERIFICATION'
    || String(row.trading_floor_status || '').toUpperCase() === 'PUBLISHED_PENDING_VERIFICATION';
  const evidenceCoverage = recordEvidenceCoverage({
    brand,
    model,
    reference,
    dialColor,
    sellerName,
    sellerPhone,
    contactApproved,
    exactImageUrl: publicImageUrl,
    sourceAmount,
    sourceCurrency: row.source_currency,
    hasCompleteIdentity,
    invalidReferenceReason: invalidReference ? 'PRICE_CURRENCY_TOKEN' : null,
    priceEligible,
  });

  return {
    id: row.id,
    brand,
    model,
    reference,
    reference_search_key: invalidReference ? null : referenceSearchKey,
    raw_reference: row.raw_reference || null,
    normalized_reference: row.normalized_reference || null,
    catalog_reference: row.catalog_reference || null,
    reference_invalid_reason: invalidReference ? 'PRICE_CURRENCY_TOKEN' : null,
    has_complete_identity: hasCompleteIdentity,
    dial_color: dialColor,
    condition: row.condition || null,
    listing_type: row.listing_type || 'OTHER',
    listing_date: row.posting_date || null,
    created_at: row.posting_date || row.imported_at || null,
    raw_message: row.raw_message || null,
    raw_message_scope: normalizedSummary ? 'normalized_summary' : 'stored_source_message',
    raw_message_evidence_type: normalizedSummary ? 'WORKBOOK_NORMALIZED_SUMMARY' : 'SOURCE_RAW_MESSAGE',
    seller_name: sellerName,
    seller_phone: sellerPhone,
    seller_rating: positiveNumber(row.dealer_rating),
    seller_review_count: 0,
    seller_rating_evidence_status: positiveNumber(row.dealer_rating) !== null
      ? 'SOURCE_SUPPLIED'
      : 'UNAVAILABLE',
    contact_publication_approved: contactApproved,
    price_usd: verifiedUsd,
    price_raw: sourceAmount,
    currency: row.source_currency || null,
    workbook_price_usd: workbookUsd,
    workbook_price_review_reason: workbookPriceReview,
    source_price_amount: sourceAmount,
    source_price_text: row.source_price_text || null,
    source_currency: row.source_currency || null,
    price_evidence_status: row.price_evidence_status,
    price_research_eligible: priceEligible,
    confidence: row.confidence == null ? null : Number(row.confidence),
    verdict: row.verdict || row.verification_status || null,
    listing_status: row.trading_floor_status || row.listing_status || row.verification_status || null,
    source: 'REVIEWED_WORKBOOK_INVENTORY',
    source_type: 'owner_reviewed_workbook',
    source_file: row.source_file,
    source_row_number: row.source_row_number,
    source_record_id: row.source_record_id || null,
    location: evidenceValuePresent(row.location || row.region) ? (row.location || row.region) : null,
    item_category: effectiveItemCategory(row),
    publication_state: row.publication_state || 'APPROVED',
    verification_label: pendingVerification ? 'Human review' : 'Verified listing',
    data_quality_review_required: pendingVerification,
    multi_listing: multiListing,
    is_unbundled_child: isUnbundledChild,
    has_images: publicImageUrl !== null,
    thumbnail_url: publicImageUrl,
    image_urls: publicImageUrl ? [publicImageUrl] : [],
    image_evidence_type: publicImageUrl ? 'SOURCE_LISTING_IMAGE' : 'NO_IMAGE',
    image_evidence_label: publicImageUrl ? 'Source-supplied listing image' : null,
    image_evidence_notice: multiListing || isUnbundledChild
      ? 'A multi-item source image is withheld until it can be assigned to the correct child listing.'
      : publicImageUrl
      ? 'Exact image URL supplied with this source listing.'
      : null,
    evidence_coverage: evidenceCoverage,
  };
}

function parseCursorPage(value) {
  const cursor = cleanExactText(value, 80);
  if (!cursor) return null;
  if (/^[1-9]\d*$/.test(cursor)) {
    const page = Number(cursor);
    return Number.isSafeInteger(page) ? page : null;
  }
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    if (!/^[1-9]\d*$/.test(decoded)) return null;
    const page = Number(decoded);
    return Number.isSafeInteger(page) ? page : null;
  } catch {
    return null;
  }
}

function parseInventoryCursor(value, pageSize) {
  const cursor = cleanExactText(value, 240);
  if (!cursor) return { lane: 'images', offset: 0, page: 1 };
  const legacyPage = parseCursorPage(cursor);
  if (legacyPage !== null) {
    return {
      lane: 'images',
      offset: (legacyPage - 1) * pageSize,
      page: legacyPage,
    };
  }
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const lane = decoded?.l === 'i' ? 'images' : decoded?.l === 'n' ? 'no-images' : null;
    const offset = Number(decoded?.o);
    const page = Number(decoded?.p);
    if (!lane || !Number.isSafeInteger(offset) || offset < 0
      || !Number.isSafeInteger(page) || page < 1) return null;
    return { lane, offset, page };
  } catch {
    return null;
  }
}

function encodeInventoryCursor({ lane, offset, page }) {
  return Buffer.from(JSON.stringify({
    v: 1,
    l: lane === 'images' ? 'i' : 'n',
    o: offset,
    p: page,
  })).toString('base64url');
}

function publicationBrandsFromSummary(summary) {
  return (summary.brands || [])
    .filter(brand => Number(brand.canonical_listings || 0) > 0)
    .map(brand => brand.brand)
    .filter(Boolean);
}

function boundedPage(rows, pageSize, hasLookaheadQuery) {
  const ordered = rows || [];
  return {
    records: hasLookaheadQuery ? ordered.slice(0, pageSize) : ordered,
    hasLookahead: hasLookaheadQuery && ordered.length > pageSize,
  };
}

function isLegacyReviewedInventoryRecord(record) {
  const storedConfidence = Number(record?.confidence);
  const confidence = storedConfidence >= 0 && storedConfidence <= 1
    ? storedConfidence * 100
    : storedConfidence;
  const status = String(record?.listing_status || record?.verdict || '').trim().toUpperCase();
  const blocked = /(?:BUNDLE_CHILD_PENDING_REVIEW|BUNDLE_PENDING_SEPARATION|SUPPRESSED_EXACT_DUPLICATE|REJECTED|HIDDEN|DELETED|ARCHIVED)/.test(status);
  if (blocked) return false;
  if (Number.isFinite(confidence) && confidence >= 90) return true;
  return isPriorityHumanReviewBrand(record?.brand)
    && evidenceValuePresent(record?.reference)
    && !isMultiListing(record);
}

function buildLegacyMarketQueryParams({
  pageSize,
  offset = 0,
  imageLane = 'images',
  brand,
  requestedReference,
  exactDialVariants,
  listingType,
  imagesOnly,
  pricedOnly,
  search,
  postedAfter,
}) {
  const legacyColumns = [
    'id,source_file,source_row_number,source_record_id,posting_date,posted_by',
    'phone_number,contact_publication_approved,raw_message,listing_type,brand_scope',
    'supplied_brand,canonical_brand,model,catalog_model,raw_reference',
    'normalized_reference,catalog_reference,dial_color,catalog_dial,condition',
    'workbook_price_usd,source_price_amount,source_price_text,source_currency',
    'price_evidence_status,confidence,verification_status,user_image_url,imported_at',
    'has_exact_source_image,verified_price_usd,has_verified_usd_price,has_complete_identity',
  ].join(',');
  const params = new URLSearchParams({
    select: legacyColumns,
    // Page each side of the image boundary independently. The production
    // expression index uses has_exact_source_image as its leading key, so an
    // equality lane plus descending ID stays indexed without an 8.5M-row sort.
    order: 'id.desc',
    limit: String(pageSize + 1),
  });
  params.set('has_exact_source_image', imageLane === 'images' ? 'eq.true' : 'eq.false');
  if (offset > 0) params.set('offset', String(offset));
  if (brand) params.set('brand_scope', `eq.${brand}`);
  if (requestedReference) {
    const exactVariants = listEquivalentReferences(requestedReference, brand || null);
    params.set('normalized_reference', `in.(${exactVariants.join(',')})`);
  }
  if (exactDialVariants.length) params.set('dial_color', `in.(${exactDialVariants.join(',')})`);
  if (listingType) params.set('listing_type', `eq.${listingType}`);
  if (imagesOnly) params.set('has_exact_source_image', 'eq.true');
  if (pricedOnly) params.set('has_supplied_price', 'eq.true');
  if (postedAfter) params.set('posting_date', `gte.${postedAfter}`);
  const genericSearch = safeSearchTerm(search);
  if (genericSearch && !genericSearch.includes(' ') && !requestedReference && !exactDialVariants.length) {
    const pattern = `*${genericSearch}*`;
    params.set('or', `(${[
      `supplied_brand.ilike.${pattern}`,
      `canonical_brand.ilike.${pattern}`,
      `brand_scope.ilike.${pattern}`,
      `model.ilike.${pattern}`,
      `catalog_model.ilike.${pattern}`,
      `raw_reference.ilike.${pattern}`,
      `normalized_reference.ilike.${pattern}`,
      `catalog_reference.ilike.${pattern}`,
      `posted_by.ilike.${pattern}`,
      `phone_number.ilike.${pattern}`,
      `raw_message.ilike.${pattern}`,
    ].join(',')})`);
  }
  return params;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const pagination = cleanExactText(req.query?.pagination, 20).toLowerCase();
    const requestedPageSize = Number.parseInt(
      String(req.query?.pageSize || DEFAULT_PAGE_SIZE),
      10,
    );
    // Honor the 50-card marketplace page. The old 12-row cap was applied
    // before safety filtering and produced visibly sparse Rolex/Patek pages.
    const pageSizeLimit = pagination === 'cursor' ? 50 : MAX_PAGE_SIZE;
    const pageSize = Number.isInteger(requestedPageSize)
      ? Math.min(Math.max(requestedPageSize, 12), pageSizeLimit)
      : Math.min(DEFAULT_PAGE_SIZE, pageSizeLimit);
    const cursorProvided = req.query?.cursor != null && String(req.query.cursor).trim() !== '';
    const inventoryCursor = pagination === 'cursor'
      ? parseInventoryCursor(req.query?.cursor, pageSize)
      : null;
    if (cursorProvided && inventoryCursor === null) {
      return res.status(400).json({ status: 'error', error: 'Invalid pagination cursor' });
    }
    const requestedPage = Number.parseInt(String(req.query?.page || '1'), 10);
    const page = pagination === 'cursor' && inventoryCursor !== null
      ? inventoryCursor.page
      : (Number.isInteger(requestedPage) ? Math.max(1, requestedPage) : 1);
    const search = cleanExactText(req.query?.q, 120);
    const parsedSearch = parseTradingSearch(search);
    // Only an explicit brand filter is exact. Free-text brand/model/seller terms
    // remain case-insensitive searches; parsing them as exact brand names made
    // aliases such as "patek" incorrectly exclude "Patek Philippe".
    const requestedBrand = cleanExactText(req.query?.brand, 80);
    const requestedReference = cleanExactText(req.query?.reference || parsedSearch.reference, 80);
    const reference = referenceComparisonKey(requestedReference);
    const requestedDial = cleanExactText(req.query?.dial || parsedSearch.dial, 40);
    const exactDialVariants = requestedDial
      ? [...new Set([
          requestedDial.toLowerCase(),
          `${requestedDial[0].toUpperCase()}${requestedDial.slice(1).toLowerCase()}`,
          requestedDial.toUpperCase(),
        ])]
      : [];
    const imagesOnly = String(req.query?.images || '').toLowerCase() === 'true';
    const pricedOnly = String(req.query?.priced || '').toLowerCase() === 'true';
    const listingType = cleanExactText(req.query?.type, 12).toUpperCase();
    const condition = cleanExactText(req.query?.condition, 80);
    const requestedItem = cleanExactText(req.query?.item, 20).toLowerCase();
    const itemCategories = { all: 'ALL', watches: 'WATCH', handbags: 'HANDBAG', jewelry: 'JEWELRY', accessories: 'ACCESSORY', other: 'OTHER' };
    const itemCategory = requestedItem ? itemCategories[requestedItem] : 'ALL';
    const region = cleanExactText(req.query?.region, 100);
    const rating = cleanExactText(req.query?.rating, 12).toLowerCase();
    const dateWindow = cleanExactText(req.query?.date, 4).toUpperCase();
    const postedAfter = dateWindowStart(dateWindow);

    if (listingType && !['WTS', 'WTB', 'OTHER'].includes(listingType)) {
      return res.status(400).json({ status: 'error', error: 'Invalid listing type' });
    }
    if (rating && !['rated', 'unrated'].includes(rating)) {
      return res.status(400).json({ status: 'error', error: 'Invalid dealer rating filter' });
    }
    if (dateWindow && !postedAfter) {
      return res.status(400).json({ status: 'error', error: 'Invalid posting date window' });
    }
    if (requestedReference && !reference) {
      return res.status(400).json({ status: 'error', error: 'Invalid exact reference' });
    }
    if (condition && !(requestedBrand && reference)) {
      return res.status(400).json({
        status: 'error',
        error: 'Condition filters require an exact brand and reference until a dedicated publication index is available',
      });
    }

    const client = getClient();
    // Summary and authenticated direct-post reads are independent of the
    // reviewed market REST request. Start them without serializing three
    // remote database round trips on every page load.
    const summaryPromise = MARKET_SOURCE_VIEW === 'qnsa_rolex_patek_trading_floor_source'
      ? Promise.resolve(qnsaReviewedReleaseSummary())
      : loadSummary(client);
    const brand = requestedBrand;
    // Cursor pages publish the current reviewed inventory, including incomplete
    // identities and no-price rows; analytics eligibility remains stricter.
    const scopedFilter = true;
    const canReverse = !scopedFilter;
    // Historical workbook checkpoints contain repeated import attempts and are
    // not a trustworthy customer inventory count. Pagination is cursor-based,
    // so withhold the total until the reconciled publication ledger supplies an
    // exact count rather than presenting checkpoint rows as unique listings.
    const publicInventoryTotal = null;
    const pageWindow = resolvePageWindow({
      page,
      pageSize,
      total: 0,
      canReverse,
    });

    if (pageWindow.empty) {
      const summary = await summaryPromise;
      const publicationBrands = publicationBrandsFromSummary(summary);
      return res.status(200).json({
        status: 'ok', count: 0, total: publicInventoryTotal, page, pageSize,
        totalIsEstimate: false, totalStatus: 'withheld_unreconciled_checkpoint_history', hasMore: false, nextCursor: null,
        records: [], summary, publicationBrands,
        evidenceContract: EVIDENCE_CONTRACT,
        coverage: summarizeCoverage([]),
      });
    }

    const columns = [
      'id,parent_id,source_file,source_row_number,source_record_id,posting_date,seller_name',
      'seller_phone,contact_publication_approved,raw_message,listing_type,brand_scope',
      'supplied_brand,canonical_brand,model,catalog_model,raw_reference',
      'normalized_reference,catalog_reference,dial_color,catalog_dial,condition',
      'workbook_price_usd,source_price_amount,source_currency',
      'price_evidence_status,confidence,verdict,verification_status,user_image_url,imported_at',
      'has_exact_source_image,verified_price_usd,has_verified_usd_price,has_complete_identity,trading_floor_status,reference_search_key,location,item_category',
      'publication_state,publication_lane,normalization_run_complete,raw_lineage_verified,dealer_rating',
    ].join(',');

    // ponytail: use raw REST instead of Supabase client to avoid client-side issues
    const queryParams = new URLSearchParams();
    queryParams.set('select', columns);
    // The QNSA release view already excludes every blocked status and may carry
    // a NULL source status. Applying SQL NOT IN again would also reject NULL and
    // erase otherwise eligible reviewed rows.
    if (MARKET_SOURCE_VIEW !== 'qnsa_rolex_patek_trading_floor_source') {
      queryParams.set('trading_floor_status', 'not.in.(bundle_child_pending_review,bundle_pending_separation,suppressed_exact_duplicate)');
    }
    if (brand) queryParams.set('brand_scope', `eq.${brand}`);
    if (reference) {
      if (MARKET_SOURCE_VIEW === 'qnsa_rolex_patek_trading_floor_source') {
        const exactVariants = listEquivalentReferences(requestedReference, brand || null);
        queryParams.set('normalized_reference', `in.(${exactVariants.join(',')})`);
      } else {
        queryParams.set('reference_search_key', `eq.${reference}`);
      }
    }
    if (exactDialVariants.length) queryParams.set('dial_color', `in.(${exactDialVariants.join(',')})`);
    if (listingType) queryParams.set('listing_type', `eq.${listingType}`);
    if (itemCategory === 'WATCH') {
      // Include legacy OTHER rows only so the fail-closed brand/reference rule
      // above can recover real watches. The mapped category filter removes
      // every OTHER row that lacks that evidence.
      queryParams.set('item_category', 'in.(WATCH,OTHER)');
    } else if (itemCategory !== 'ALL') {
      queryParams.set('item_category', `eq.${itemCategory}`);
    }
    if (imagesOnly) queryParams.set('has_exact_source_image', 'eq.true');
    if (pricedOnly) queryParams.set('source_price_amount', 'gt.0');
    const regionPattern = locationSearchPattern(region);
    if (regionPattern) queryParams.set('location', `ilike.${regionPattern}`);
    if (postedAfter) queryParams.set('posting_date', `gte.${postedAfter}`);
    const genericSearch = safeSearchTerm(search);
    if (genericSearch && !genericSearch.includes(' ') && !requestedReference && !requestedDial) {
      const pattern = `*${genericSearch}*`;
      queryParams.set('or', `(${[
        `supplied_brand.ilike.${pattern}`,
        `canonical_brand.ilike.${pattern}`,
        `brand_scope.ilike.${pattern}`,
        `model.ilike.${pattern}`,
        `catalog_model.ilike.${pattern}`,
        `raw_reference.ilike.${pattern}`,
        `normalized_reference.ilike.${pattern}`,
        `catalog_reference.ilike.${pattern}`,
        `seller_name.ilike.${pattern}`,
        `seller_phone.ilike.${pattern}`,
        `location.ilike.${pattern}`,
        `raw_message.ilike.${pattern}`,
      ].join(',')})`);
    }
    if (!itemCategory) return res.status(400).json({ status: 'error', error: 'Invalid item category' });
    // ponytail: simplified query — ORDER BY with offset times out on large views
    // The reconciled QNSA archive currently has no visually-approved historical
    // images. Start it in the no-image lane so the first customer page does not
    // scan every reviewed row looking for a true image flag. Direct submissions
    // with approved images are still merged above this lane.
    const qnsaNoImageDefault = MARKET_SOURCE_VIEW === 'qnsa_rolex_patek_trading_floor_source'
      && !imagesOnly
      && inventoryCursor === null;
    const requestedLane = imagesOnly ? 'images' : (inventoryCursor?.lane || (qnsaNoImageDefault ? 'no-images' : 'images'));
    const requestedOffset = pagination === 'cursor'
      ? (inventoryCursor?.offset || 0)
      : pageWindow.start;
    const firstPageOfLane = requestedOffset === 0
      && (requestedLane === 'images' ? page === 1 : true);
    let directRowsPromise = Promise.resolve({ data: [], error: null });
    if (firstPageOfLane) {
      let directQuery = client.from('dealer_listing_submissions')
        .select('id,intent,category,raw_message,claimed_fields,image_urls,poster_image_url,review_status,publication_status,created_at')
        .eq('publication_status', 'PUBLISHED')
        .eq('review_status', 'APPROVED')
        .order('created_at', { ascending: false })
        .limit(100);
      if (itemCategory !== 'ALL') directQuery = directQuery.eq('category', itemCategory);
      if (postedAfter) directQuery = directQuery.gte('created_at', postedAfter);
      directRowsPromise = Promise.resolve(directQuery);
    }
    queryParams.set('has_exact_source_image', requestedLane === 'images' ? 'eq.true' : 'eq.false');
    queryParams.set('order', MARKET_SOURCE_VIEW === 'qnsa_rolex_patek_trading_floor_source'
      ? 'posting_date.desc'
      : 'id.desc');
    queryParams.set('limit', String(pageSize + 1));
    if (requestedOffset > 0) queryParams.set('offset', String(requestedOffset));
    
    const headers = {
      'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY}`,
    };
    let activeQueryParams = legacyMarketViewContractDetected
      ? buildLegacyMarketQueryParams({
          pageSize, offset: requestedOffset, imageLane: requestedLane,
          brand, requestedReference, exactDialVariants,
          listingType, imagesOnly, pricedOnly, search, postedAfter,
        })
      : queryParams;
    let usedLegacyViewContract = legacyMarketViewContractDetected;
    let restUrl = `${process.env.SUPABASE_URL}/rest/v1/${MARKET_SOURCE_VIEW}?${activeQueryParams.toString()}`;
    let restRes = await fetch(restUrl, {
      headers,
    });
    let errText = restRes.ok ? '' : await restRes.text();
    if (!restRes.ok && restRes.status === 400 && /42703|does not exist/i.test(errText)) {
      // Production may temporarily lag the forward view migration. Fall back
      // to the last proven public contract instead of returning an empty 200 or
      // taking the entire Trading Floor offline. Publication gates remain
      // enforced again after row mapping below.
      legacyMarketViewContractDetected = true;
      usedLegacyViewContract = true;
      activeQueryParams = buildLegacyMarketQueryParams({
        pageSize, offset: requestedOffset, imageLane: requestedLane,
        brand, requestedReference, exactDialVariants,
        listingType, imagesOnly, pricedOnly, search, postedAfter,
      });
      restUrl = `${process.env.SUPABASE_URL}/rest/v1/${MARKET_SOURCE_VIEW}?${activeQueryParams.toString()}`;
      restRes = await fetch(restUrl, { headers });
      errText = restRes.ok ? '' : await restRes.text();
    }
    if (!restRes.ok) {
      throw new Error(`REST query failed: ${restRes.status} ${errText.slice(0, 200)}`);
    }
    const data = await restRes.json();
    let rawRows = (data || []).slice(0, pageSize);
    let hasMore = (data || []).length > pageSize;
    let nextLane = requestedLane;
    let nextOffset = requestedOffset + rawRows.length;

    // Fill the final image page from the no-image lane. The two equality lanes
    // preserve one global boundary without a full-view boolean sort or count.
    if (!imagesOnly && requestedLane === 'images' && !hasMore) {
      const remaining = pageSize - rawRows.length;
      nextLane = 'no-images';
      nextOffset = 0;
      if (remaining > 0) {
        const noImageParams = usedLegacyViewContract
          ? buildLegacyMarketQueryParams({
              pageSize: remaining, offset: 0, imageLane: 'no-images',
              brand, requestedReference, exactDialVariants,
              listingType, imagesOnly: false, pricedOnly, search, postedAfter,
            })
          : new URLSearchParams(queryParams);
        if (!usedLegacyViewContract) {
          noImageParams.set('has_exact_source_image', 'eq.false');
          noImageParams.set('order', 'id.desc');
          noImageParams.set('limit', String(remaining + 1));
          noImageParams.set('offset', '0');
        }
        const noImageUrl = `${process.env.SUPABASE_URL}/rest/v1/${MARKET_SOURCE_VIEW}?${noImageParams.toString()}`;
        const noImageRes = await fetch(noImageUrl, { headers });
        const noImageError = noImageRes.ok ? '' : await noImageRes.text();
        if (!noImageRes.ok) {
          throw new Error(`REST no-image query failed: ${noImageRes.status} ${noImageError.slice(0, 200)}`);
        }
        const noImageData = await noImageRes.json();
        const noImageRows = (noImageData || []).slice(0, remaining);
        rawRows = [...rawRows, ...noImageRows];
        hasMore = (noImageData || []).length > remaining;
        nextOffset = noImageRows.length;
      } else {
        hasMore = true;
      }
    }
    const rows = pageWindow.reverse ? [...rawRows].reverse() : rawRows;
    const pageResult = boundedPage(rows, pageSize, false);
    const eligibleRows = usedLegacyViewContract
      ? pageResult.records
      : pageResult.records.filter(isTradingFloorSourceRow);
    let records = eligibleRows
      .map(mapReviewedRecord)
      .filter(record => (usedLegacyViewContract ? isLegacyReviewedInventoryRecord(record) : true) && !record.multi_listing)
      .filter(record => !search || searchTermsMatch(record, search))
      .filter(record => !region || locationMatches(record.location, region))
      .filter(record => ratingMatches(record, rating))
      .filter(record => itemCategory === 'ALL' || record.item_category === itemCategory);
    if (firstPageOfLane) {
      const { data: directRows, error: directError } = await directRowsPromise;
      if (!directError) {
        const directRecords = (directRows || [])
          .map(mapDealerSubmission)
          .filter(record => directSubmissionMatchesImageLane(record, requestedLane))
          .filter(record => !record.multi_listing && directSubmissionMatches(record, {
            imagesOnly, pricedOnly, listingType, brand, reference, dial: requestedDial, condition, search, itemCategory, region,
            rating, postedAfter,
          }));
        records = [...directRecords, ...records]
          .sort(compareInventoryForDisplay)
          .slice(0, pageSize);
      }
    }
    const nextCursor = hasMore
      ? encodeInventoryCursor({ lane: nextLane, offset: nextOffset, page: page + 1 })
      : null;
    const summary = await summaryPromise;
    const publicationBrands = publicationBrandsFromSummary(summary);

    return res.status(200).json({
      status: 'ok',
      count: records.length,
      total: publicInventoryTotal,
      page,
      pageSize,
      totalIsEstimate: false,
      totalStatus: 'withheld_unreconciled_checkpoint_history',
      hasMore,
      nextCursor,
      records,
      summary,
      publicationBrands,
      evidenceContract: EVIDENCE_CONTRACT,
      coverage: summarizeCoverage(records),
      displayPolicy: {
        unpriced_listings_visible: true,
        unpriced_listings_count_toward_activity: true,
        unpriced_listings_excluded_from_price_analytics: true,
        within_reference_order: 'SUPPLIED_PRICE_FIRST_THEN_PRICE_NOT_SUPPLIED',
      },
      viewContract: usedLegacyViewContract ? 'legacy-compatible' : 'strict',
    });
  } catch (error) {
    console.error('[reviewed-market-inventory] error:', error.message);
    return res.status(503).json({
      status: 'error',
      error: 'Reviewed market inventory is temporarily unavailable',
    });
  }
};

module.exports.EXPLICIT_USD_STATUS = EXPLICIT_USD_STATUS;
module.exports.MARKET_SOURCE_VIEW = MARKET_SOURCE_VIEW;
module.exports.MULTIPLE_LISTING_IDENTITY_VALUES = MULTIPLE_LISTING_IDENTITY_VALUES;
module.exports.EVIDENCE_CONTRACT = EVIDENCE_CONTRACT;
module.exports.exactHttpUrl = exactHttpUrl;
module.exports.referenceComparisonKey = referenceComparisonKey;
module.exports.referenceIsPriceToken = referenceIsPriceToken;
module.exports.recordEvidenceCoverage = recordEvidenceCoverage;
module.exports.mapDealerSubmission = mapDealerSubmission;
module.exports.directSubmissionMatches = directSubmissionMatches;
module.exports.directSubmissionMatchesImageLane = directSubmissionMatchesImageLane;
module.exports.summarizeCoverage = summarizeCoverage;
module.exports.hasUsableSourcePrice = hasUsableSourcePrice;
module.exports.inventoryIdentityKey = inventoryIdentityKey;
module.exports.compareInventoryForDisplay = compareInventoryForDisplay;
module.exports.isApprovedInventoryRecord = isApprovedInventoryRecord;
module.exports.isTradingFloorSourceRow = isTradingFloorSourceRow;
module.exports.normalizeItemCategory = normalizeItemCategory;
module.exports.effectiveItemCategory = effectiveItemCategory;
module.exports.isLegacyReviewedInventoryRecord = isLegacyReviewedInventoryRecord;
module.exports.mapReviewedRecord = mapReviewedRecord;
module.exports.isNormalizedWorkbookSummary = isNormalizedWorkbookSummary;
module.exports.isMultiListing = isMultiListing;
module.exports.safeSearchTerm = safeSearchTerm;
module.exports.locationSearchPattern = locationSearchPattern;
module.exports.locationMatches = locationMatches;
module.exports.dateWindowStart = dateWindowStart;
module.exports.isSourceBackedRatedDealer = isSourceBackedRatedDealer;
module.exports.ratingMatches = ratingMatches;
module.exports.isPriorityHumanReviewBrand = isPriorityHumanReviewBrand;
module.exports.searchTermsMatch = searchTermsMatch;
module.exports.parseCursorPage = parseCursorPage;
module.exports.parseInventoryCursor = parseInventoryCursor;
module.exports.encodeInventoryCursor = encodeInventoryCursor;
module.exports.publicationBrandsFromSummary = publicationBrandsFromSummary;
module.exports.boundedPage = boundedPage;
module.exports.buildLegacyMarketQueryParams = buildLegacyMarketQueryParams;

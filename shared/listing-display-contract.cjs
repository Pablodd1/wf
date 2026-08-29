'use strict';

const LISTING_DISPLAY_CONTRACT_VERSION = 'watchfacts-listing-display-v1';
const PUBLIC_IMAGE_EVIDENCE = new Set([
  'SELLER_LISTING_IMAGE',
  'SOURCE_LISTING_IMAGE',
  'SOURCE_LINKED_IMAGE',
]);

const NULLABLE_KEYS = [
  'source_listing_id', 'parent_listing_id', 'child_listing_id', 'duplicate_group_id',
  'brand', 'model', 'reference', 'dial_color', 'configuration', 'condition',
  'listing_type', 'listing_date', 'created_at', 'raw_message',
  'source_price_text', 'source_price_amount', 'source_currency', 'price_usd',
  'price_evidence_status', 'analytics_fx_rate', 'analytics_fx_source', 'analytics_fx_date',
  'seller_id', 'seller_name', 'seller_phone', 'seller_rating', 'seller_review_count',
  'seller_group_count', 'dealer_id', 'dealer_profile_path', 'location',
  'source', 'source_type', 'source_file', 'source_row_number', 'source_record_id',
  'parser_version', 'decision_evidence', 'review_status', 'outlier_reason',
  'included_in_statistics', 'price_research_eligible',
  'image_evidence_label', 'image_evidence_notice',
];

const VERIFIED_USD_EVIDENCE = new Set([
  'SOURCE_EXPLICIT_USD_MATCH',
  'SOURCE_EXPLICIT_USD_USDT',
  'EXPLICIT_SOURCE_FX_CONVERTED',
  'DATED_VERIFIED_FX',
]);

function cleanUrl(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function enforceListingDisplayContract(input = {}) {
  const record = { ...input };
  for (const key of NULLABLE_KEYS) {
    if (record[key] === undefined || record[key] === '') record[key] = null;
  }

  record.listing_display_contract_version = LISTING_DISPLAY_CONTRACT_VERSION;
  record.source_listing_id = record.source_listing_id || record.source_record_id || record.id || null;
  record.parent_listing_id = record.parent_listing_id || record.parent_id || record.parent_source_message_id || null;
  record.child_listing_id = record.child_listing_id || (record.parent_listing_id ? record.id || null : null);
  record.seller_id = record.seller_id || record.dealer_id || null;
  record.contact_publication_approved = record.contact_publication_approved === true;
  record.seller_phone = record.contact_publication_approved === true ? record.seller_phone : null;

  const priceUsd = Number(record.price_usd);
  const priceEvidence = String(record.price_evidence_status || '').toUpperCase();
  record.price_display_verified = Number.isFinite(priceUsd)
    && priceUsd > 0
    && VERIFIED_USD_EVIDENCE.has(priceEvidence);

  const evidence = String(record.image_evidence_type || '').toUpperCase();
  const imageUrls = [
    record.thumbnail_url,
    record.image_url,
    ...(Array.isArray(record.image_urls) ? record.image_urls : []),
  ].map(cleanUrl).filter(Boolean);
  const uniqueImageUrls = [...new Set(imageUrls)];
  const imageIsPublic = PUBLIC_IMAGE_EVIDENCE.has(evidence)
    && record.multi_listing !== true
    && record.is_unbundled_child !== true
    && uniqueImageUrls.length > 0;

  record.image_evidence_type = imageIsPublic ? evidence : 'NO_IMAGE';
  record.has_images = imageIsPublic;
  record.thumbnail_url = imageIsPublic ? uniqueImageUrls[0] : null;
  record.image_urls = imageIsPublic ? uniqueImageUrls : [];
  if (!imageIsPublic) {
    record.image_url = null;
    record.image_evidence_label = null;
  }

  if (record.included_in_statistics !== true && record.included_in_statistics !== false) {
    record.included_in_statistics = null;
  }
  if (record.price_research_eligible !== true && record.price_research_eligible !== false) {
    record.price_research_eligible = null;
  }

  return record;
}

module.exports = {
  LISTING_DISPLAY_CONTRACT_VERSION,
  NULLABLE_KEYS,
  PUBLIC_IMAGE_EVIDENCE,
  VERIFIED_USD_EVIDENCE,
  enforceListingDisplayContract,
};

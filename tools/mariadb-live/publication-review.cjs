'use strict';

const { extractPriceObservations, explicitIntent, parseNumber } = require('../../api/_lib/normalization-v4.cjs');
const { classify } = require('./audit-non-watch.cjs');

const ACCEPTABLE_PRICE_EVIDENCE = new Set([
  'explicit_line_currency',
  'section_context',
  'message_context',
  'usd_defaulted_by_policy',
]);
const PUBLIC_CATEGORIES = new Set(['WATCH', 'HANDBAG', 'JEWELRY', 'ACCESSORY']);
const DO_ORIGIN = 'https://thecollective-prod.nyc3.digitaloceanspaces.com/';
const DO_LISTINGS_FULL_BASE = `${DO_ORIGIN}listings/full/`;

function text(value) {
  const cleaned = value == null ? '' : String(value).trim();
  return cleaned || null;
}

function sourceIntent(source) {
  const explicit = explicitIntent(source.raw_message);
  if (explicit) return explicit;
  return String(source.raw_data?.type || '').toLowerCase() === 'search' ? 'WTB' : 'WTS';
}

function sourceMediaUrl(value) {
  const supplied = text(value);
  if (!supplied) return null;
  if (/^https?:\/\//i.test(supplied)) return supplied;
  const key = supplied.replace(/^\/+/, '');
  if (/^listings\/full\//i.test(key)) return `${DO_ORIGIN}${key}`;
  if (/^full\//i.test(key)) return `${DO_ORIGIN}listings/${key}`;
  return `${DO_LISTINGS_FULL_BASE}${key}`;
}

function mediaEvidence(source) {
  const supplied = text(source.raw_data?.front_image);
  if (!supplied) {
    return {
      source_media_key: null,
      source_media_url_candidate: null,
      exact_source_lineage: false,
      visually_verified: false,
      public_image_eligible: false,
      review_reason: 'NO_SOURCE_MEDIA',
    };
  }
  const url = sourceMediaUrl(supplied);
  return {
    source_media_key: supplied,
    source_media_url_candidate: url,
    exact_source_lineage: true,
    visually_verified: false,
    public_image_eligible: false,
    review_reason: 'VISUAL_IDENTITY_REVIEW_REQUIRED',
  };
}

function sellerEvidence(source) {
  const raw = source.raw_data || {};
  return {
    public: {
      name: text(raw.from_name),
      location: text(raw.region),
      phone: null,
      rating: null,
    },
    private_source_evidence: {
      phone: text(raw.from_number),
      phone_code: text(raw.phone_code),
      company_id: raw.company_id == null ? null : raw.company_id,
      source_claimed_rating: text(raw.dealer_rating),
      is_from_verified_user: raw.is_from_verified_user === true,
      is_from_paid_user: raw.is_from_paid_user === true,
      is_seller_approved: raw.is_seller_approved === true,
    },
    contact_publication_approved: false,
    rating_publication_status: 'UNVERIFIED_SOURCE_FIELD',
  };
}

function currencyUnconfirmedSourcePrice(candidate) {
  const rawLine = text(candidate?.raw_line ?? candidate?.rawLine);
  if (!rawLine) return null;

  // A bare dollar sign is useful source evidence, but it is not proof of USD.
  // Preserve the explicitly supplied amount for Trading Floor display while
  // leaving both currency and USD conversion unresolved for Price Research.
  const match = rawLine.match(/(?<![A-Za-z])\$\s*([\d][\d.,]*)(?:\s*(k|thousand|m|mn|mil|mill|million|b|bn|billion)(?![A-Za-z]))?/i);
  if (!match) return null;
  const amount = parseNumber(match[1], match[2]);
  if (!amount) return null;
  return {
    amount_original: amount,
    currency_original: null,
    amount_usd: null,
    raw_price_text: match[0].trim(),
    currency_evidence: 'bare_dollar_unconfirmed',
    analytics_currency_evidence_eligible: false,
  };
}

function normalizedPrice(candidate) {
  const primary = candidate?.prices?.find(price => price.is_primary) || candidate?.prices?.[0] || null;
  if (!primary?.amount_original || !primary.currency_original) return currencyUnconfirmedSourcePrice(candidate);
  return {
    amount_original: primary.amount_original,
    currency_original: primary.currency_original,
    amount_usd: primary.amount_usd || null,
    raw_price_text: primary.raw_price_text || null,
    currency_evidence: primary.currency_evidence || null,
    analytics_currency_evidence_eligible: ACCEPTABLE_PRICE_EVIDENCE.has(primary.currency_evidence),
    conversion_rate: primary.conversion_rate ?? null,
    conversion_timestamp: primary.conversion_timestamp || null,
    conversion_source: primary.conversion_source || null,
  };
}

function nonWatchCandidate(source, category) {
  const raw = source.raw_data || {};
  const prices = extractPriceObservations(source.raw_message || '', {});
  const candidate = {
    raw_line: source.raw_message || null,
    brand: text(raw.brand),
    // Non-watch source rows do not have a watch model/reference contract. Keep
    // the source title as the customer-facing item identity when no structured
    // model was supplied; the immutable raw message remains the audit source.
    model: text(raw.model) || text(raw.title),
    reference: text(raw.reference || raw.normalized_reference),
    dial_color: null,
    condition: null,
    listing_type: sourceIntent(source),
    category,
    prices,
  };
  return { ...candidate, price: normalizedPrice(candidate) };
}

function priceResearchStatus({ category, bundleStatus, candidate, catalogConfirmation, reviewDisposition }) {
  if (category !== 'WATCH') return 'INELIGIBLE_NON_WATCH';
  if (bundleStatus !== 'SINGLE_CANDIDATE') return 'INELIGIBLE_BUNDLE_OR_IDENTITY';
  if (!candidate?.brand || !candidate?.reference) return 'INELIGIBLE_IDENTITY';
  if (!catalogConfirmation?.confirmed) return 'INELIGIBLE_UNCONFIRMED_IDENTITY';
  if (candidate.listing_type === 'WTB') return 'DEMAND_PENDING_HUMAN_APPROVAL';
  const price = normalizedPrice(candidate);
  if (!price) return 'INELIGIBLE_NO_PRICE';
  if (!price.analytics_currency_evidence_eligible || !price.amount_usd) return 'INELIGIBLE_CURRENCY_OR_FX';
  if (!['USD', 'USDT'].includes(String(price.currency_original).toUpperCase())
    && (!price.conversion_rate || !price.conversion_timestamp || !price.conversion_source)) {
    return 'INELIGIBLE_FX_UNVERIFIED';
  }
  if (!candidate.dial_color) return 'INELIGIBLE_DIAL';
  return reviewDisposition === 'READY_FOR_HUMAN_APPROVAL'
    ? 'SALE_PENDING_HUMAN_APPROVAL'
    : 'INELIGIBLE_REVIEW_REQUIRED';
}

function tradingFloorStatus({ category, bundleStatus, hasCandidate, reviewDisposition }) {
  if (!PUBLIC_CATEGORIES.has(category)) return 'CATEGORY_REVIEW_ONLY';
  if (bundleStatus === 'BUNDLE_SPLIT_REQUIRED') return 'BUNDLE_REVIEW_ONLY';
  if (category === 'WATCH' && !hasCandidate) return 'PUBLISHED_PENDING_VERIFICATION';
  return reviewDisposition === 'READY_FOR_HUMAN_APPROVAL'
    ? 'READY_FOR_PUBLICATION_REVIEW'
    : 'PUBLISHED_PENDING_VERIFICATION';
}

function assertLineage(source, proposal) {
  if (!source?.source_record_id || source.source_record_id !== proposal?.source_record_id) {
    throw new Error('Source/proposal record identity mismatch');
  }
  if (!source.raw_sha256 || source.raw_sha256 !== proposal.source_hash) {
    throw new Error(`Source/proposal hash mismatch for ${source.source_record_id}`);
  }
}

function buildPublicationReview(source, proposal) {
  assertLineage(source, proposal);
  const categoryResult = classify(source);
  const category = categoryResult.category;
  const candidates = proposal.normalization?.proposed_candidates || [];
  // Never reuse watch-parser attributes for an explicitly classified
  // non-watch item. Numeric style/SKU tokens frequently resemble watch
  // references; the non-watch record is built only from its source fields.
  const candidate = category === 'WATCH'
    ? (candidates.length === 1
      ? { ...candidates[0], category, price: normalizedPrice(candidates[0]) }
      : null)
    : (PUBLIC_CATEGORIES.has(category) ? nonWatchCandidate(source, category) : null);
  const media = mediaEvidence(source);
  const sourceDeclaresBundle = source.raw_data?.is_bundle === true
    || source.raw_data?.is_bundle === 1
    || String(source.raw_data?.is_bundle || '') === '1';
  const proposalBundleStatus = proposal.bundle_status;
  // The watch parser correctly produces NO_CANDIDATE for a handbag, jewelry
  // item, or accessory. Once explicit category evidence creates exactly one
  // non-watch candidate, promote only the *shape* to SINGLE_CANDIDATE so the
  // existing staging RPC can materialize it. Source-declared bundles always
  // remain deferred and retain their parent media.
  const bundleStatus = sourceDeclaresBundle
    ? 'BUNDLE_SPLIT_REQUIRED'
    : (category !== 'WATCH'
      && PUBLIC_CATEGORIES.has(category)
      && proposalBundleStatus === 'NO_CANDIDATE'
        ? 'SINGLE_CANDIDATE'
        : proposalBundleStatus);
  const tradingStatus = tradingFloorStatus({
    category,
    bundleStatus,
    hasCandidate: Boolean(candidate),
    reviewDisposition: proposal.review_disposition,
  });
  const researchStatus = priceResearchStatus({
    category,
    bundleStatus,
    candidate,
    catalogConfirmation: proposal.catalog_confirmation,
    reviewDisposition: proposal.review_disposition,
  });
  const reviewChildren = bundleStatus === 'BUNDLE_SPLIT_REQUIRED'
    ? candidates.map((child, index) => ({
      candidate_index: index,
      ...child,
      category: 'WATCH',
      price: normalizedPrice(child),
      source_media_key: null,
      source_media_url_candidate: null,
      public_image_eligible: false,
      trading_floor_status: 'BUNDLE_CHILD_REVIEW_ONLY',
      price_research_status: 'INELIGIBLE_BUNDLE_CHILD_PENDING_REVIEW',
    }))
    : [];

  return {
    contract: 'wf-mariadb-publication-review-v1',
    source_record_id: source.source_record_id,
    source_id: source.source_id,
    source_hash: source.raw_sha256,
    source_created_on: source.source_created_on,
    raw_message: source.raw_message,
    raw_message_source: source.raw_message_source,
    category,
    category_reasons: categoryResult.reasons,
    bundle_status: bundleStatus,
    normalization_version: proposal.normalization?.normalization_version || null,
    review_disposition: proposal.review_disposition,
    review_reasons: proposal.review_reasons || [],
    trading_floor_status: tradingStatus,
    price_research_status: researchStatus,
    candidate,
    review_children: reviewChildren,
    media,
    seller: sellerEvidence(source),
    publication_write_authorized: false,
  };
}

module.exports = {
  ACCEPTABLE_PRICE_EVIDENCE,
  buildPublicationReview,
  currencyUnconfirmedSourcePrice,
  mediaEvidence,
  normalizedPrice,
  priceResearchStatus,
  sellerEvidence,
  sourceIntent,
  sourceMediaUrl,
  tradingFloorStatus,
};

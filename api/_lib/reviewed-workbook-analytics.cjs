'use strict';

const { applyEffectivePrice } = require('./corrected-price-source.cjs');
const { isReviewedWorkbookBrowseBrand } = require('./reviewed-workbook-browse.cjs');
const {
  loadRolexPatekOverlayRows,
} = require('./rolex-patek-reviewed-overlay.cjs');

const MARKET_SOURCE_VIEW = 'reviewed_workbook_market_source_v2';

function clean(value) {
  const text = String(value || '').trim();
  return text || null;
}

function mapWorkbookAnalyticsRow(row) {
  row = applyEffectivePrice(row);
  const isBundle = String(row.listing_type || '').toUpperCase() === 'BUNDLE';
  const imageCandidate = clean(row.final_image_url) || clean(row.user_image_url);
  const exactImage = !isBundle && (row.has_exact_source_image === true || Boolean(imageCandidate)) ? imageCandidate : null;
  const imageEvidenceType = exactImage
    ? (clean(row.image_evidence_type) === 'SELLER_LISTING_IMAGE' ? 'SELLER_LISTING_IMAGE' : 'SOURCE_LISTING_IMAGE')
    : 'NO_IMAGE';
  const contactApproved = row.contact_publication_approved === true;
  const explicitAdmissionUsd = row.price_evidence_status === 'SOURCE_EXPLICIT_USD_MATCH'
    ? Number(row.workbook_price_usd)
    : null;
  const verifiedUsd = row.verified_price_usd == null ? explicitAdmissionUsd : Number(row.verified_price_usd);
  const hasVerifiedUsd = String(row.listing_type || '').toUpperCase() === 'WTS'
    && (row.has_verified_usd_price === true
    || (row.price_evidence_status === 'SOURCE_EXPLICIT_USD_MATCH' && Number(row.workbook_price_usd) > 0))
    && Number.isFinite(verifiedUsd)
    && verifiedUsd > 0;
  const priceUsd = hasVerifiedUsd ? verifiedUsd : null;
  return {
    id: row.id,
    brand: clean(row.supplied_brand) || clean(row.canonical_brand) || clean(row.brand_scope),
    model: clean(row.model) || clean(row.catalog_model),
    reference: clean(row.public_reference) || clean(row.normalized_reference)
      || clean(row.raw_reference) || clean(row.catalog_reference),
    dial_color: clean(row.dial_color) || clean(row.catalog_dial),
    condition: clean(row.condition),
    price_raw: row.source_price_amount == null ? null : Number(row.source_price_amount),
    price_usd: priceUsd,
    verified_price_usd: verifiedUsd,
    has_verified_usd_price: hasVerifiedUsd,
    effective_price_source: clean(row.effective_price_source),
    price_correction_applied: row.price_correction_applied === true,
    price_correction_id: clean(row.price_correction_id),
    price_correction_key: clean(row.price_correction_key),
    analytics_fx_rate: row.effective_fx_rate == null ? null : Number(row.effective_fx_rate),
    analytics_fx_source: clean(row.effective_fx_source),
    analytics_fx_date: clean(row.effective_fx_date),
    currency: clean(row.source_currency),
    raw_message: clean(row.raw_message),
    flags: {},
    created_at: row.posting_date || row.imported_at || null,
    listing_date: row.posting_date || null,
    source: 'REVIEWED_WORKBOOK_INVENTORY',
    source_type: 'owner_reviewed_workbook',
    year: null,
    listing_type: clean(row.listing_type) || 'WTS',
    dealer_id: null,
    owner_reviewed_identity: true,
    analytics_currency_status: priceUsd === null ? 'CURRENCY_UNVERIFIED' : 'VERIFIED',
    source_price_amount: row.source_price_amount == null ? null : Number(row.source_price_amount),
    source_currency: clean(row.source_currency),
    price_evidence_status: clean(row.price_evidence_status),
    workbook_source_file: clean(row.source_file),
    source_file_sha256: clean(row.source_file_sha256),
    workbook_source_row_number: row.source_row_number == null ? null : Number(row.source_row_number),
    workbook_source_record_id: clean(row.source_record_id),
    source_record_id: clean(row.source_record_id),
    thumbnail_url: exactImage,
    image_urls: exactImage ? [exactImage] : [],
    has_images: Boolean(exactImage),
    image_evidence_type: imageEvidenceType,
    seller_name: clean(row.seller_name) || clean(row.posted_by),
    seller_phone: contactApproved ? (clean(row.seller_phone) || clean(row.phone_number)) : null,
    contact_publication_approved: contactApproved,
    verdict: clean(row.verdict) || clean(row.verification_status) || 'APPROVED',
    confidence: row.confidence == null ? 100 : Number(row.confidence),
    listing_status: clean(row.listing_status) || clean(row.verification_status) || 'ACTIVE',
    source_file: clean(row.source_file),
    source_row_number: row.source_row_number == null ? null : Number(row.source_row_number),
  };
}

const WORKBOOK_COLUMNS = [
  'id,source_file,source_row_number,source_record_id,posting_date,raw_message,listing_type',
  'brand_scope,supplied_brand,canonical_brand,model,catalog_model,raw_reference',
  'normalized_reference,catalog_reference,public_reference,dial_color,catalog_dial,condition',
  'source_price_amount,source_currency,price_evidence_status,confidence,verification_status',
  'user_image_url,verified_price_usd,imported_at,has_exact_source_image,has_verified_usd_price',
  'corrected_price_usd,corrected_source_amount,corrected_source_currency,corrected_fx_rate',
  'corrected_fx_source,corrected_fx_date,price_correction_status,price_correction_id,price_correction_key',
  'reference_search_key,has_complete_identity,seller_name,seller_phone,contact_publication_approved,verdict,listing_status',
].join(',');

const LEGACY_WORKBOOK_COLUMNS = WORKBOOK_COLUMNS
  .replace(/,corrected_price_usd,corrected_source_amount,corrected_source_currency,corrected_fx_rate,corrected_fx_source,corrected_fx_date,price_correction_status,price_correction_id,price_correction_key/, '')
  .replace('seller_name,seller_phone,', 'posted_by,phone_number,')
  .replace(',verdict,listing_status', '');

const ADMISSION_WORKBOOK_COLUMNS = [
  'id,source_file,source_row_number,source_record_id,posting_date,raw_message,listing_type',
  'brand_scope,supplied_brand,canonical_brand,model,catalog_model,raw_reference',
  'normalized_reference,catalog_reference,dial_color,catalog_dial,condition',
  'source_price_amount,source_currency,price_evidence_status,confidence,verification_status',
  'user_image_url,workbook_price_usd,imported_at,image_evidence_type,seller_name:posted_by,phone_number',
  'contact_publication_approved',
].join(',');

function isMissingColumnError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || error || '');
  return /42703|does not exist/i.test(`${code} ${message}`);
}

async function executeAnalyticsQuery(client, columns, { brand, references, limit }) {
  let query = client
    .from(MARKET_SOURCE_VIEW)
    .select(columns)
    .eq('brand_scope', clean(brand))
    // Production has a composite B-tree index beginning with
    // (brand_scope, normalized_reference, posting_date, id). Filtering the
    // computed reference_search_key forced a full scan of the 8.5M-row view.
    .in('normalized_reference', references)
    .neq('verification_status', 'QUARANTINED_SOURCE_CONFLICT')
    .eq('has_complete_identity', true)
    .eq('has_verified_usd_price', true)
    .eq('listing_type', 'WTS');

  for (const value of ['multiple', 'multi', 'mixed']) {
    query = query.not('dial_color', 'ilike', value);
    query = query.not('model', 'ilike', value);
  }

  return query
    .order('posting_date', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true })
    .limit(Math.min(10000, Math.max(1, Number(limit) || 10000)));
}

async function loadReviewedWorkbookAnalyticsRows(client, { brand, references, limit = 10000 }) {
  const indexedReferences = [...new Set((references || []).map(clean).filter(Boolean))];
  if (!clean(brand) || !indexedReferences.length) return [];

  if (isReviewedWorkbookBrowseBrand(brand)) {
    const { data, error } = await client
      .from('reviewed_workbook_inventory')
      .select(ADMISSION_WORKBOOK_COLUMNS)
      .eq('brand_scope', clean(brand))
      .in('normalized_reference', indexedReferences)
      .eq('verification_status', 'APPROVED_SINGLE_CANDIDATE')
      .eq('confidence', 100)
      .eq('price_evidence_status', 'SOURCE_EXPLICIT_USD_MATCH')
      .eq('listing_type', 'WTS')
      .gt('workbook_price_usd', 0)
      .order('posting_date', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true })
      .limit(Math.min(10000, Math.max(1, Number(limit) || 10000)));
    if (error) throw error;
    return (data || []).map(mapWorkbookAnalyticsRow);
  }

  let { data, error } = await executeAnalyticsQuery(client, WORKBOOK_COLUMNS, {
    brand, references: indexedReferences, limit,
  });
  if (error && isMissingColumnError(error)) {
    ({ data, error } = await executeAnalyticsQuery(client, LEGACY_WORKBOOK_COLUMNS, {
      brand, references: indexedReferences, limit,
    }));
  }

  if (error) throw error;
  return (data || []).map(mapWorkbookAnalyticsRow);
}

async function loadReviewedWorkbookEvidenceRows(client, { brand, references, limit = 10000 }) {
  const indexedReferences = [...new Set((references || []).map(clean).filter(Boolean))];
  if (!clean(brand) || !indexedReferences.length || !isReviewedWorkbookBrowseBrand(brand)) return [];

  const { data, error } = await client
    .from('reviewed_workbook_inventory')
    .select(ADMISSION_WORKBOOK_COLUMNS)
    .eq('brand_scope', clean(brand))
    .in('normalized_reference', indexedReferences)
    .eq('verification_status', 'APPROVED_SINGLE_CANDIDATE')
    .eq('confidence', 100)
    .in('listing_type', ['WTS', 'WTB'])
    .order('posting_date', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true })
    .limit(Math.min(10000, Math.max(1, Number(limit) || 10000)));
  if (error) throw error;
  return (data || []).map(mapWorkbookAnalyticsRow);
}

async function loadRolexPatekOverlayEvidenceRows(client, { brand, references, limit = 10000 }) {
  const { rows } = await loadRolexPatekOverlayRows(client, {
    brand,
    references,
    listingTypes: ['WTS', 'WTB'],
    limit,
  });
  return rows.map(mapWorkbookAnalyticsRow).map(row => ({
    ...row,
    owner_reviewed_identity: true,
    reviewed_overlay: true,
  }));
}

async function loadReviewedWorkbookListing(client, id) {
  if (String(id || '').startsWith('admission_') || String(id || '').startsWith('rpdelta_')) {
    const { data, error } = await client
      .from('reviewed_workbook_inventory')
      .select(ADMISSION_WORKBOOK_COLUMNS)
      .eq('id', id)
      .eq('verification_status', 'APPROVED_SINGLE_CANDIDATE')
      .eq('confidence', 100)
      .in('listing_type', ['WTS', 'WTB'])
      .maybeSingle();
    if (error) throw error;
    return data ? mapWorkbookAnalyticsRow(data) : null;
  }
  const executeListingQuery = columns => client
    .from(MARKET_SOURCE_VIEW)
    .select(columns)
    .eq('id', id)
    .eq('has_complete_identity', true)
    .eq('has_verified_usd_price', true)
    .eq('listing_type', 'WTS')
    .maybeSingle();
  let { data, error } = await executeListingQuery(WORKBOOK_COLUMNS);
  if (error && isMissingColumnError(error)) {
    ({ data, error } = await executeListingQuery(LEGACY_WORKBOOK_COLUMNS));
  }
  if (error) throw error;
  return data ? mapWorkbookAnalyticsRow(data) : null;
}

module.exports = {
  MARKET_SOURCE_VIEW,
  WORKBOOK_COLUMNS,
  LEGACY_WORKBOOK_COLUMNS,
  ADMISSION_WORKBOOK_COLUMNS,
  isMissingColumnError,
  loadReviewedWorkbookEvidenceRows,
  loadRolexPatekOverlayEvidenceRows,
  loadReviewedWorkbookAnalyticsRows,
  loadReviewedWorkbookListing,
  mapWorkbookAnalyticsRow,
};


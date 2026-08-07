'use strict';

const MARKET_SOURCE_VIEW = 'reviewed_workbook_market_source_v2';

function clean(value) {
  const text = String(value || '').trim();
  return text || null;
}

function mapWorkbookAnalyticsRow(row) {
  const isBundle = String(row.listing_type || '').toUpperCase() === 'BUNDLE';
  const imageCandidate = clean(row.final_image_url) || clean(row.user_image_url);
  const exactImage = !isBundle && (row.has_exact_source_image === true || Boolean(imageCandidate)) ? imageCandidate : null;
  const contactApproved = row.contact_publication_approved === true;
  const verifiedUsd = row.verified_price_usd == null ? null : Number(row.verified_price_usd);
  const workbookUsd = row.workbook_price_usd == null ? null : Number(row.workbook_price_usd);
  const priceUsd = verifiedUsd ?? workbookUsd ?? (row.source_price_amount == null ? null : Number(row.source_price_amount));
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
    workbook_price_usd: workbookUsd,
    has_verified_usd_price: row.has_verified_usd_price === true,
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
    analytics_currency_status: 'VERIFIED',
    source_price_amount: row.source_price_amount == null ? null : Number(row.source_price_amount),
    source_currency: clean(row.source_currency),
    workbook_source_file: clean(row.source_file),
    workbook_source_row_number: row.source_row_number == null ? null : Number(row.source_row_number),
    workbook_source_record_id: clean(row.source_record_id),
    thumbnail_url: exactImage,
    image_urls: exactImage ? [exactImage] : [],
    has_images: Boolean(exactImage),
    seller_name: clean(row.seller_name),
    seller_phone: clean(row.seller_phone),
    contact_publication_approved: contactApproved,
    verdict: clean(row.verdict) || 'APPROVED',
    confidence: row.confidence == null ? 100 : Number(row.confidence),
    listing_status: clean(row.listing_status) || 'ACTIVE',
    source_file: clean(row.source_file),
    source_row_number: row.source_row_number == null ? null : Number(row.source_row_number),
  };
}

const WORKBOOK_COLUMNS = [
  'id,source_file,source_row_number,source_record_id,posting_date,raw_message,listing_type',
  'brand_scope,supplied_brand,canonical_brand,model,catalog_model,raw_reference',
  'normalized_reference,catalog_reference,public_reference,dial_color,catalog_dial,condition',
  'source_price_amount,source_currency,price_evidence_status,confidence,verification_status',
  'user_image_url,verified_price_usd,workbook_price_usd,imported_at,has_exact_source_image,has_verified_usd_price',
  'reference_search_key,has_complete_identity,seller_name,seller_phone,contact_publication_approved,verdict,listing_status',
].join(',');

async function loadReviewedWorkbookAnalyticsRows(client, { brand, referenceKeys, limit = 10000 }) {
  const keys = [...new Set((referenceKeys || []).map(clean).filter(Boolean).map(k => k.toLowerCase()))];
  if (!clean(brand) || !keys.length) return [];

  let query = client
    .from(MARKET_SOURCE_VIEW)
    .select(WORKBOOK_COLUMNS)
    .eq('brand_scope', clean(brand))
    .in('reference_search_key', keys)
  const { data, error } = await client
    .from(MARKET_SOURCE_VIEW)
    .select(WORKBOOK_COLUMNS)
    .eq('brand_scope', clean(brand))
    .in('reference_search_key', keys)
    .neq('verification_status', 'QUARANTINED_SOURCE_CONFLICT')
    .eq('has_complete_identity', true)
    .order('posting_date', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true })
    .limit(Math.min(10000, Math.max(1, Number(limit) || 10000)));

  if (error) throw error;
  const multiValues = new Set(['multiple', 'multi', 'mixed']);
  return (data || [])
    .filter(r => !multiValues.has(String(r.dial_color || '').trim().toLowerCase()) && !multiValues.has(String(r.model || '').trim().toLowerCase()))
    .map(mapWorkbookAnalyticsRow);
}

async function loadReviewedWorkbookListing(client, id) {
  const { data, error } = await client
    .from(MARKET_SOURCE_VIEW)
    .select(WORKBOOK_COLUMNS)
    .eq('id', id)
    .eq('has_complete_identity', true)
    .maybeSingle();
  if (error) throw error;
  return data ? mapWorkbookAnalyticsRow(data) : null;
}

module.exports = {
  MARKET_SOURCE_VIEW,
  WORKBOOK_COLUMNS,
  loadReviewedWorkbookAnalyticsRows,
  loadReviewedWorkbookListing,
  mapWorkbookAnalyticsRow,
};


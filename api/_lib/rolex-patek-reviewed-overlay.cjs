'use strict';

const ROLEX_PATEK_DELTA_TIER = 'QNSA_ROLEX_PATEK_REVIEWED_DELTA_V1';
const ROLEX_PATEK_MULTI_PARENT_ID = 'rpdelta_1ac10392cca161ba85a042a2f3efd4ef79cda691ccca2422f8b3280eebbf5972';
const ROLEX_PATEK_MULTI_PARENT_STATUS = 'APPROVED_MULTI_PARENT_TRADING_FLOOR_ONLY';
const MULTI_PARENT_PUBLICATION_LANE = 'OWNER_MULTI_PARENT_SOURCE_LINEAGE_V1';
const ROLEX_PATEK_DELTA_BRANDS = new Set(['rolex', 'patek philippe']);
const OWNER_APPROVED_USD_STATUSES = new Set([
  'SOURCE_EXPLICIT_USD_MATCH',
]);
const OVERLAY_LINEAGE_COLUMNS = [
  'id,source_record_id,source_message_id,source_file_sha256,source_row_number',
  'listing_type,brand_scope,normalized_reference,verification_status,verification_tier,confidence',
].join(',');
const OVERLAY_COLUMNS = [
  'id,source_file,source_file_sha256,source_row_number,source_record_id,source_payload_sha256',
  'source_platform,source_group_id,source_message_id,posting_date,posted_by,phone_number',
  'contact_publication_approved,raw_message,listing_type,brand_scope,supplied_brand,canonical_brand',
  'model,catalog_model,raw_reference,normalized_reference,catalog_reference,dial_color,catalog_dial,condition',
  'workbook_price_usd,source_price_amount,source_price_text,source_currency,price_evidence_status',
  'confidence,verification_status,verification_tier,user_image_url,final_image_url,display_image_url,has_image',
  'image_evidence_type,imported_at,review_reasons',
].join(',');

function clean(value) {
  return String(value || '').trim();
}

function isRolexPatekOverlayBrand(value) {
  return ROLEX_PATEK_DELTA_BRANDS.has(clean(value).toLowerCase());
}

function overlayExactKeys(row) {
  const keys = [];
  const id = clean(row?.id);
  const sourceRecordId = clean(row?.source_record_id);
  const sourceMessageId = clean(row?.source_message_id);
  const fileHash = clean(row?.source_file_sha256).toLowerCase();
  const rowNumber = Number(row?.source_row_number);
  if (id) keys.push(`id:${id}`);
  if (sourceRecordId) keys.push(`record:${sourceRecordId}`);
  if (sourceMessageId) keys.push(`message:${sourceMessageId}`);
  if (/^[0-9a-f]{64}$/.test(fileHash) && Number.isSafeInteger(rowNumber) && rowNumber >= 2) {
    keys.push(`file-row:${fileHash}:${rowNumber}`);
  }
  return keys;
}

function mergeByExactLineage(baseRows = [], overlayRows = []) {
  const result = [];
  const seen = new Set();
  let overlayDuplicates = 0;
  const append = (row, overlay) => {
    const keys = overlayExactKeys(row);
    if (keys.some(key => seen.has(key))) {
      if (overlay) overlayDuplicates += 1;
      return;
    }
    result.push(row);
    for (const key of keys) seen.add(key);
  };
  for (const row of baseRows || []) append(row, false);
  for (const row of overlayRows || []) append(row, true);
  return {
    rows: result,
    base_count: Array.isArray(baseRows) ? baseRows.length : 0,
    overlay_input_count: Array.isArray(overlayRows) ? overlayRows.length : 0,
    overlay_added_count: result.length - (Array.isArray(baseRows) ? baseRows.length : 0),
    overlay_duplicate_count: overlayDuplicates,
  };
}

function isExactRolexPatekMultiParent(row) {
  return clean(row?.id) === ROLEX_PATEK_MULTI_PARENT_ID
    && clean(row?.verification_tier) === ROLEX_PATEK_DELTA_TIER
    && clean(row?.verification_status) === ROLEX_PATEK_MULTI_PARENT_STATUS
    && clean(row?.listing_type).toUpperCase() === 'MULTI'
    && Boolean(clean(row?.source_message_id))
    && /^[0-9a-f]{64}$/i.test(clean(row?.source_payload_sha256))
    && Number(row?.workbook_price_usd || 0) === 0
    && !clean(row?.normalized_reference || row?.raw_reference)
    && !clean(row?.user_image_url || row?.final_image_url || row?.display_image_url);
}

function prepareOverlayRow(row) {
  const exactMultiParent = isExactRolexPatekMultiParent(row);
  const exactImage = row?.image_evidence_type === 'SELLER_LISTING_IMAGE'
    && /^https?:\/\/[^\s]+$/i.test(clean(row?.user_image_url || row?.final_image_url || row?.display_image_url));
  const imageUrl = exactImage
    ? clean(row.user_image_url || row.final_image_url || row.display_image_url)
    : null;
  const priceEvidenceStatus = clean(row?.price_evidence_status).toUpperCase();
  const approvedUsd = !exactMultiParent && OWNER_APPROVED_USD_STATUSES.has(priceEvidenceStatus)
    && clean(row?.listing_type).toUpperCase() === 'WTS'
    && Number(row?.workbook_price_usd) > 0;
  return {
    ...row,
    user_image_url: imageUrl,
    has_exact_source_image: Boolean(imageUrl),
    verified_price_usd: approvedUsd ? Number(row.workbook_price_usd) : null,
    has_verified_usd_price: approvedUsd,
    has_complete_identity: Boolean(clean(row?.canonical_brand || row?.supplied_brand || row?.brand_scope)
      && clean(row?.normalized_reference || row?.raw_reference)),
    verdict: exactMultiParent ? ROLEX_PATEK_MULTI_PARENT_STATUS : 'APPROVED',
    trading_floor_status: exactMultiParent ? 'PUBLISHED_MULTI_LISTING' : 'APPROVED',
    item_category: 'WATCH',
    publication_state: 'APPROVED',
    publication_lane: exactMultiParent ? MULTI_PARENT_PUBLICATION_LANE : ROLEX_PATEK_DELTA_TIER,
    normalization_run_complete: true,
    raw_lineage_verified: Boolean(clean(row?.source_message_id))
      && /^[0-9a-f]{64}$/i.test(clean(row?.source_payload_sha256)),
  };
}

async function loadRolexPatekOverlayRows(client, {
  brand,
  references = [],
  listingTypes = ['WTS', 'WTB'],
  includeMissingIntent = false,
  limit = 1000,
  offset = 0,
  count = false,
  includeMultiParents = false,
} = {}) {
  if (!isRolexPatekOverlayBrand(brand)) return { rows: [], count: 0 };
  let query = client
    .from('reviewed_workbook_inventory')
    // The exact single count is also needed to place the one multi parent at
    // the end of its deterministic brand stream when fetching a later page.
    .select(OVERLAY_COLUMNS, { count: 'exact' })
    .eq('brand_scope', clean(brand))
    .eq('verification_tier', ROLEX_PATEK_DELTA_TIER)
    .eq('verification_status', 'APPROVED_SINGLE_CANDIDATE')
    .eq('confidence', 100)
    .not('source_message_id', 'is', null);
  const normalizedListingTypes = [...new Set((listingTypes || [])
    .map(value => clean(value).toUpperCase())
    .filter(Boolean))];
  if (includeMissingIntent) {
    query = query.or(`listing_type.in.(${normalizedListingTypes.join(',')}),listing_type.is.null`);
  } else {
    query = query.in('listing_type', normalizedListingTypes);
  }
  const exactReferences = [...new Set((references || []).map(clean).filter(Boolean))];
  if (exactReferences.length) query = query.in('normalized_reference', exactReferences);
  const boundedLimit = Math.min(10000, Math.max(1, Number(limit) || 1000));
  const boundedOffset = Math.max(0, Number(offset) || 0);
  const { data, error, count: exactCount } = await query
    .order('has_image', { ascending: false })
    .order('posting_date', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true })
    .range(boundedOffset, boundedOffset + boundedLimit - 1);
  if (error) throw error;
  const rows = (data || []).map(prepareOverlayRow).filter(row => row.raw_lineage_verified === true);
  let parent = null;
  const parentEligible = includeMultiParents
    && clean(brand).toLowerCase() === 'rolex'
    && !exactReferences.length
    && (listingTypes || []).map(value => clean(value).toUpperCase()).includes('MULTI');
  if (parentEligible) {
    const { data: parentData, error: parentError } = await client
      .from('reviewed_workbook_inventory')
      .select(OVERLAY_COLUMNS)
      .eq('id', ROLEX_PATEK_MULTI_PARENT_ID)
      .eq('brand_scope', 'Rolex')
      .eq('verification_tier', ROLEX_PATEK_DELTA_TIER)
      .eq('verification_status', ROLEX_PATEK_MULTI_PARENT_STATUS)
      .eq('listing_type', 'MULTI')
      .eq('confidence', 100)
      .maybeSingle();
    if (parentError) throw parentError;
    if (isExactRolexPatekMultiParent(parentData)) parent = prepareOverlayRow(parentData);
  }
  const singleCount = Number(exactCount || 0);
  if (parent && offset <= singleCount && singleCount < offset + boundedLimit) rows.push(parent);
  return {
    rows,
    count: count ? singleCount + (parent ? 1 : 0) : null,
    singleCount: count ? singleCount : null,
    multiParentCount: count ? (parent ? 1 : 0) : null,
  };
}

async function loadRolexPatekOverlayExactKeys(client, {
  brand,
  references = [],
  listingTypes = ['WTS', 'WTB'],
  includeMissingIntent = false,
  includeMultiParents = false,
} = {}) {
  if (!isRolexPatekOverlayBrand(brand)) return new Set();
  const normalizedListingTypes = [...new Set((listingTypes || [])
    .map(value => clean(value).toUpperCase())
    .filter(Boolean))];
  let query = client
    .from('reviewed_workbook_inventory')
    .select(OVERLAY_LINEAGE_COLUMNS)
    .eq('brand_scope', clean(brand))
    .eq('verification_tier', ROLEX_PATEK_DELTA_TIER)
    .eq('verification_status', 'APPROVED_SINGLE_CANDIDATE')
    .eq('confidence', 100)
    .not('source_message_id', 'is', null);
  if (includeMissingIntent) {
    query = query.or(`listing_type.in.(${normalizedListingTypes.join(',')}),listing_type.is.null`);
  } else {
    query = query.in('listing_type', normalizedListingTypes);
  }
  const exactReferences = [...new Set((references || []).map(clean).filter(Boolean))];
  if (exactReferences.length) query = query.in('normalized_reference', exactReferences);
  const { data, error } = await query
    .order('id', { ascending: true })
    .range(0, 9_999);
  if (error) throw error;
  const rows = data || [];
  if (includeMultiParents
    && clean(brand).toLowerCase() === 'rolex'
    && !exactReferences.length
    && normalizedListingTypes.includes('MULTI')) {
    const { data: parentData, error: parentError } = await client
      .from('reviewed_workbook_inventory')
      .select(OVERLAY_LINEAGE_COLUMNS)
      .eq('id', ROLEX_PATEK_MULTI_PARENT_ID)
      .eq('brand_scope', 'Rolex')
      .eq('verification_tier', ROLEX_PATEK_DELTA_TIER)
      .eq('verification_status', ROLEX_PATEK_MULTI_PARENT_STATUS)
      .eq('listing_type', 'MULTI')
      .eq('confidence', 100)
      .maybeSingle();
    if (parentError) throw parentError;
    if (parentData) rows.push(parentData);
  }
  return new Set(rows.flatMap(overlayExactKeys));
}

module.exports = {
  OVERLAY_COLUMNS,
  OWNER_APPROVED_USD_STATUSES,
  MULTI_PARENT_PUBLICATION_LANE,
  ROLEX_PATEK_DELTA_BRANDS,
  ROLEX_PATEK_DELTA_TIER,
  ROLEX_PATEK_MULTI_PARENT_ID,
  ROLEX_PATEK_MULTI_PARENT_STATUS,
  isExactRolexPatekMultiParent,
  isRolexPatekOverlayBrand,
  loadRolexPatekOverlayExactKeys,
  loadRolexPatekOverlayRows,
  mergeByExactLineage,
  overlayExactKeys,
  prepareOverlayRow,
};

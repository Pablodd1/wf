'use strict';

const { getClient } = require('./_lib/supabase');
const {
  cleanExactText,
  cleanFilter,
  loadSummary,
  normalizeReference,
  resolvePageWindow,
} = require('./reviewed-workbook-inventory.js');

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;
const EXPLICIT_USD_STATUS = 'SOURCE_EXPLICIT_USD_MATCH';

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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

function mapReviewedRecord(row) {
  const exactImageUrl = exactHttpUrl(row.user_image_url);
  const contactApproved = row.contact_publication_approved === true;
  const sourceAmount = positiveNumber(row.source_price_amount);
  const workbookUsd = positiveNumber(row.workbook_price_usd);
  const verifiedUsd = row.price_evidence_status === EXPLICIT_USD_STATUS
    ? workbookUsd
    : null;

  return {
    id: row.id,
    brand: row.supplied_brand || row.canonical_brand || row.brand_scope,
    model: row.model || row.catalog_model || null,
    reference: row.normalized_reference || row.raw_reference || row.catalog_reference || null,
    dial_color: row.dial_color || row.catalog_dial || null,
    condition: row.condition || null,
    listing_type: row.listing_type || 'OTHER',
    listing_date: row.posting_date || null,
    created_at: row.posting_date || row.imported_at || null,
    raw_message: row.raw_message || null,
    seller_name: contactApproved ? row.posted_by || null : null,
    seller_phone: contactApproved ? row.phone_number || null : null,
    contact_publication_approved: contactApproved,
    price_usd: verifiedUsd,
    price_raw: sourceAmount,
    currency: row.source_currency || null,
    workbook_price_usd: workbookUsd,
    source_price_amount: sourceAmount,
    source_price_text: row.source_price_text || null,
    source_currency: row.source_currency || null,
    price_evidence_status: row.price_evidence_status,
    price_research_eligible: verifiedUsd !== null,
    confidence: row.confidence == null ? null : Number(row.confidence),
    verdict: row.verification_status || null,
    listing_status: row.verification_status || null,
    source: 'REVIEWED_WORKBOOK_INVENTORY',
    source_type: 'owner_reviewed_workbook',
    source_file: row.source_file,
    source_row_number: row.source_row_number,
    source_record_id: row.source_record_id || null,
    item_category: 'WATCH',
    has_images: exactImageUrl !== null,
    thumbnail_url: exactImageUrl,
    image_urls: exactImageUrl ? [exactImageUrl] : [],
    image_evidence_type: exactImageUrl ? 'SOURCE_LISTING_IMAGE' : 'NO_IMAGE',
    image_evidence_label: exactImageUrl ? 'Original listing image' : null,
    image_evidence_notice: exactImageUrl
      ? 'Exact image URL supplied with the reviewed listing.'
      : null,
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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const requestedPageSize = Number.parseInt(
      String(req.query?.pageSize || DEFAULT_PAGE_SIZE),
      10,
    );
    const pageSize = Number.isInteger(requestedPageSize)
      ? Math.min(Math.max(requestedPageSize, 12), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;
    const pagination = cleanExactText(req.query?.pagination, 20).toLowerCase();
    const cursorProvided = req.query?.cursor != null && String(req.query.cursor).trim() !== '';
    const cursorPage = parseCursorPage(req.query?.cursor);
    if (cursorProvided && cursorPage === null) {
      return res.status(400).json({ status: 'error', error: 'Invalid pagination cursor' });
    }
    const requestedPage = Number.parseInt(String(req.query?.page || '1'), 10);
    const page = pagination === 'cursor' && cursorPage !== null
      ? cursorPage
      : (Number.isInteger(requestedPage) ? Math.max(1, requestedPage) : 1);
    const requestedBrand = cleanExactText(req.query?.brand, 80);
    const reference = normalizeReference(req.query?.reference || req.query?.q);
    const imagesOnly = String(req.query?.images || '').toLowerCase() === 'true';
    const listingType = cleanExactText(req.query?.type, 12).toUpperCase();
    const condition = cleanExactText(req.query?.condition, 80);

    if (listingType && !['WTS', 'WTB', 'OTHER'].includes(listingType)) {
      return res.status(400).json({ status: 'error', error: 'Invalid listing type' });
    }
    if (condition && !(brand && reference)) {
      return res.status(400).json({
        status: 'error',
        error: 'Condition filters require an exact brand and reference until a dedicated publication index is available',
      });
    }

    const client = getClient();
    const summary = await loadSummary(client);
    const matchedBrand = summary.brands.find(item =>
      item.brand?.toLocaleLowerCase() === requestedBrand.toLocaleLowerCase());
    const brand = matchedBrand?.brand || requestedBrand;
    const scopedFilter = Boolean(reference || imagesOnly || listingType || condition);
    const preciseCount = Boolean(reference);
    const canReverse = !scopedFilter;
    const summaryTotal = brand
      ? Number(summary.brands.find(item => item.brand === brand)?.canonical_listings || 0)
      : Number(summary.canonical_listings || 0);
    const pageWindow = resolvePageWindow({
      page,
      pageSize,
      total: scopedFilter ? 0 : summaryTotal,
      canReverse,
    });
    const publicationBrands = publicationBrandsFromSummary(summary);

    if (pageWindow.empty) {
      return res.status(200).json({
        status: 'ok', count: 0, total: summaryTotal, page, pageSize,
        totalIsEstimate: false, hasMore: false, nextCursor: null,
        records: [], summary, publicationBrands,
      });
    }

    const columns = [
      'id,source_file,source_row_number,source_record_id,posting_date,posted_by',
      'phone_number,contact_publication_approved,raw_message,listing_type,brand_scope',
      'supplied_brand,canonical_brand,model,catalog_model,raw_reference',
      'normalized_reference,catalog_reference,dial_color,catalog_dial,condition',
      'workbook_price_usd,source_price_amount,source_price_text,source_currency',
      'price_evidence_status,confidence,verification_status,user_image_url,imported_at',
    ].join(',');
    let query = client
      .from('reviewed_workbook_inventory')
      .select(columns, {
        count: preciseCount ? 'exact' : scopedFilter ? 'estimated' : undefined,
      });
    query = pageWindow.reverse
      ? query
        .order('has_image', { ascending: true })
        .order('workbook_price_usd', { ascending: true, nullsFirst: true })
        .order('id', { ascending: false })
      : query
        .order('has_image', { ascending: false })
        .order('workbook_price_usd', { ascending: false, nullsFirst: false })
        .order('id', { ascending: true });
    if (brand) query = query.eq('brand_scope', brand);
    if (reference) query = query.eq('normalized_reference', reference);
    if (imagesOnly) query = query.eq('has_image', true);
    if (listingType) query = query.eq('listing_type', listingType);
    if (condition) query = query.eq('condition', condition);
    query = query.range(
      pageWindow.start,
      pageWindow.end + Number(scopedFilter),
    );

    const { data, count, error } = await query;
    if (error) throw error;
    const total = scopedFilter ? Number(count || 0) : summaryTotal;
    const rows = pageWindow.reverse ? [...(data || [])].reverse() : (data || []);
    const pageResult = boundedPage(rows, pageSize, scopedFilter);
    const records = pageResult.records.map(mapReviewedRecord);
    const hasMore = scopedFilter
      ? pageResult.hasLookahead
      : pageWindow.requestedStart + records.length < total;

    return res.status(200).json({
      status: 'ok',
      count: records.length,
      total,
      page,
      pageSize,
      totalIsEstimate: scopedFilter && !preciseCount,
      hasMore,
      nextCursor: hasMore ? String(page + 1) : null,
      records,
      summary,
      publicationBrands,
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
module.exports.exactHttpUrl = exactHttpUrl;
module.exports.mapReviewedRecord = mapReviewedRecord;
module.exports.parseCursorPage = parseCursorPage;
module.exports.publicationBrandsFromSummary = publicationBrandsFromSummary;
module.exports.boundedPage = boundedPage;

'use strict';

const { getClient } = require('./_lib/supabase');
const { parseTradingSearch } = require('./_lib/trading-search.cjs');
const {
  cleanExactText,
  loadSummary,
  resolvePageWindow,
} = require('./reviewed-workbook-inventory.js');

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;
const EXPLICIT_USD_STATUS = 'SOURCE_EXPLICIT_USD_MATCH';
const MARKET_SOURCE_VIEW = 'reviewed_workbook_market_source';

const EVIDENCE_CONTRACT = Object.freeze({
  scope: 'returned_page',
  identity_fields: ['brand', 'model', 'reference', 'dial_color'],
  identity: 'All four identity fields must be present and the reference cannot be a price/currency token.',
  contact: 'Exact supplied contact is public only when owner-approved.',
  image: 'Only an exact supplied HTTP(S) source URL is image-eligible.',
  price: 'Only an exact explicit-source USD match is analytics-eligible.',
});

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
      available: contactApproved && evidenceValuePresent(sellerPhone),
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
    price_analytics_eligible: 0,
  };
  for (const record of records) {
    totals.identity_complete += Number(record.evidence_coverage.identity.complete);
    totals.contact_available += Number(record.evidence_coverage.contact.available);
    totals.exact_source_image += Number(record.evidence_coverage.image.available);
    totals.price_analytics_eligible += Number(record.evidence_coverage.price.analytics_eligible);
  }
  return totals;
}

function mapReviewedRecord(row) {
  const exactImageUrl = row.has_exact_source_image === true
    ? exactHttpUrl(row.user_image_url)
    : null;
  const contactApproved = row.contact_publication_approved === true;
  const sourceAmount = positiveNumber(row.source_price_amount);
  const workbookUsd = positiveNumber(row.workbook_price_usd);
  const verifiedUsd = row.has_verified_usd_price === true
    && row.price_evidence_status === EXPLICIT_USD_STATUS
    ? positiveNumber(row.verified_price_usd)
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
  const sellerName = contactApproved && evidenceValuePresent(row.posted_by)
    ? row.posted_by
    : null;
  const sellerPhone = contactApproved && evidenceValuePresent(row.phone_number)
    ? row.phone_number
    : null;
  const referenceSearchKey = row.reference_search_key
    || referenceComparisonKey(reference)
    || null;
  const locallyCompleteIdentity = [brand, model, reference, dialColor]
    .every(evidenceValuePresent);
  const hasCompleteIdentity = row.has_complete_identity === true
    && locallyCompleteIdentity
    && !invalidReference;
  const priceEligible = hasCompleteIdentity && verifiedUsd !== null;
  const normalizedSummary = isNormalizedWorkbookSummary(row);
  const evidenceCoverage = recordEvidenceCoverage({
    brand,
    model,
    reference,
    dialColor,
    sellerName,
    sellerPhone,
    contactApproved,
    exactImageUrl,
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
    contact_publication_approved: contactApproved,
    price_usd: verifiedUsd,
    price_raw: sourceAmount,
    currency: row.source_currency || null,
    workbook_price_usd: workbookUsd,
    source_price_amount: sourceAmount,
    source_price_text: row.source_price_text || null,
    source_currency: row.source_currency || null,
    price_evidence_status: row.price_evidence_status,
    price_research_eligible: priceEligible,
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
    image_evidence_label: exactImageUrl ? 'Source-supplied listing image' : null,
    image_evidence_notice: exactImageUrl
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
    const search = cleanExactText(req.query?.q, 120);
    const parsedSearch = parseTradingSearch(search);
    const requestedBrand = cleanExactText(req.query?.brand || parsedSearch.brand, 80);
    const requestedReference = cleanExactText(req.query?.reference || parsedSearch.reference, 80);
    const reference = referenceComparisonKey(requestedReference);
    const requestedDial = cleanExactText(parsedSearch.dial, 40);
    const exactDialVariants = requestedDial
      ? [...new Set([
          requestedDial.toLowerCase(),
          `${requestedDial[0].toUpperCase()}${requestedDial.slice(1).toLowerCase()}`,
          requestedDial.toUpperCase(),
        ])]
      : [];
    const imagesOnly = String(req.query?.images || '').toLowerCase() === 'true';
    const listingType = cleanExactText(req.query?.type, 12).toUpperCase();
    const condition = cleanExactText(req.query?.condition, 80);

    if (listingType && !['WTS', 'WTB', 'OTHER'].includes(listingType)) {
      return res.status(400).json({ status: 'error', error: 'Invalid listing type' });
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
    const summary = await loadSummary(client);
    const matchedBrand = summary.brands.find(item =>
      item.brand?.toLocaleLowerCase() === requestedBrand.toLocaleLowerCase());
    const brand = matchedBrand?.brand || requestedBrand;
    // Customer floors publish only complete source-backed watch identities.
    // Incomplete rows remain preserved in reviewed_workbook_inventory for review.
    const scopedFilter = true;
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
        evidenceContract: EVIDENCE_CONTRACT,
        coverage: summarizeCoverage([]),
      });
    }

    const columns = [
      'id,source_file,source_row_number,source_record_id,posting_date,posted_by',
      'phone_number,contact_publication_approved,raw_message,listing_type,brand_scope',
      'supplied_brand,canonical_brand,model,catalog_model,raw_reference',
      'normalized_reference,catalog_reference,dial_color,catalog_dial,condition',
      'workbook_price_usd,source_price_amount,source_price_text,source_currency',
      'price_evidence_status,confidence,verification_status,user_image_url,imported_at',
      'has_exact_source_image,has_verified_usd_price,verified_price_usd,reference_search_key',
      'public_reference,reference_is_price_token,has_complete_identity',
    ].join(',');
    let query = client
      .from(MARKET_SOURCE_VIEW)
      .select(columns, {
        count: preciseCount ? 'exact' : scopedFilter ? 'estimated' : undefined,
      });
    query = pageWindow.reverse
      ? query
        .order('has_exact_source_image', { ascending: true })
        .order('has_verified_usd_price', { ascending: true })
        .order('verified_price_usd', { ascending: true, nullsFirst: true })
        .order('posting_date', { ascending: true, nullsFirst: true })
        .order('id', { ascending: false })
      : query
        .order('has_exact_source_image', { ascending: false })
        .order('has_verified_usd_price', { ascending: false })
        .order('verified_price_usd', { ascending: false, nullsFirst: false })
        .order('posting_date', { ascending: false, nullsFirst: false })
        .order('id', { ascending: true });
    if (brand) query = query.eq('brand_scope', brand);
    if (reference) query = query.eq('reference_search_key', reference);
    if (exactDialVariants.length) query = query.in('dial_color', exactDialVariants);
    query = query.neq('verification_status', 'QUARANTINED_SOURCE_CONFLICT');
    query = query.eq('has_complete_identity', true);
    if (imagesOnly) query = query.eq('has_exact_source_image', true);
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
      evidenceContract: EVIDENCE_CONTRACT,
      coverage: summarizeCoverage(records),
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
module.exports.EVIDENCE_CONTRACT = EVIDENCE_CONTRACT;
module.exports.exactHttpUrl = exactHttpUrl;
module.exports.referenceComparisonKey = referenceComparisonKey;
module.exports.referenceIsPriceToken = referenceIsPriceToken;
module.exports.recordEvidenceCoverage = recordEvidenceCoverage;
module.exports.summarizeCoverage = summarizeCoverage;
module.exports.mapReviewedRecord = mapReviewedRecord;
module.exports.isNormalizedWorkbookSummary = isNormalizedWorkbookSummary;
module.exports.parseCursorPage = parseCursorPage;
module.exports.publicationBrandsFromSummary = publicationBrandsFromSummary;
module.exports.boundedPage = boundedPage;

/**
 * LIVE INGEST ENDPOINT  —  POST /api/ingest
 * JASS-5 Control System & Normalization Engine
 *
 * Receives raw WhatsApp/Telegram dealer messages, splits listing candidates,
 * normalizes attributes using dynamic dictionaries, converts prices to USD,
 * validates configurations against the master catalog, scores confidence,
 * and routes to Supabase tables.
 */

'use strict';

const { lookupCatalog } = require('./_lib/catalog.js');
const path = require('node:path');
const fs = require('node:fs');
const {
  extractPriceObservations,
  segmentDealerMessage,
} = require('./_lib/normalization-v4.cjs');
const { normalizeMarketRow } = require('./_lib/market-row-normalization.cjs');
const { parseTradingSearch } = require('./_lib/trading-search.cjs');
const { requireServiceToken } = require('./_lib/require-service-token.cjs');
const { isCustomerIdentitySafe, sanitizeTradingRecord } = require('./_lib/trading-record-safety.cjs');
const { confirmCatalogCandidate } = require('./_lib/catalog-confirmation.cjs');
const { listEquivalentReferences } = require('./_lib/catalog');
const { decodeTradingCursor, encodeTradingCursor, tradingCursorFilter } = require('./_lib/trading-cursor.cjs');
const {
  isPublicationBrandAllowed,
  publicationBrandPostgrestFilter,
  publicationBrands,
} = require('./_lib/publication-brands.cjs');
const {
  REVIEWED_PANERAI_RECORD_IDS,
  REVIEWED_PANERAI_REFERENCES,
  REVIEWED_ZENITH_RECORD_END,
  REVIEWED_ZENITH_RECORD_START,
  REVIEWED_ZENITH_SOURCE,
  isFullReviewedBrandRelease,
  isReleaseListingEligible,
  isReviewedPaneraiReleaseRecord,
  isReviewedZenithReleaseRecord,
  publicationReferencePostgrestFilter,
  publicationReferences,
} = require('./_lib/publication-references.cjs');
const { repostSignature } = require('./_lib/repost-deduplication.cjs');
const { publicImageProvenance } = require('./_lib/public-image-provenance.cjs');

// ============================================================
// Load Dictionaries (With Safe Fallbacks)
// ============================================================
const DICT_DIR = path.join(__dirname, 'dictionaries');

function loadJsonSafe(filename, defaultVal) {
  try {
    const filePath = path.join(DICT_DIR, filename);
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {
    console.warn(`[JASS-5 Ingest] Warn loading ${filename}: ${e.message}`);
  }
  return defaultVal;
}

const BRANDS = loadJsonSafe('brands.json', { brands: {} }).brands;
const DIALS = loadJsonSafe('dials.json', { dial_colors: {}, dial_types: {} });
const CONDITIONS = loadJsonSafe('conditions.json', { conditions: {}, set_status: {} });
const CURRENCIES = loadJsonSafe('currencies.json', { currencies: {}, price_multipliers: {} });
const MATERIALS = loadJsonSafe('materials.json', { materials: {}, bracelets: {}, bezels: {} });
const MASTER_CATALOG = loadJsonSafe('master_catalog.json', {});

async function loadVerifiedPublicListings(
  supabaseUrl,
  readKey,
  ids,
  mediaSourceTable = 'trading_floor_verified_listings',
) {
  if (!ids.length) return new Map();
  const verifiedMediaEndpoint = mediaSourceTable === 'trading_floor_verified_listings'
    ? `${supabaseUrl}/rest/v1/trading_floor_verified_listings`
    : `${supabaseUrl}/rest/v1/${mediaSourceTable}`;
  const batches = [];
  for (let index = 0; index < ids.length; index += 50) {
    batches.push(ids.slice(index, index + 50));
  }

  const identityResults = await Promise.all(batches.map(async batch => {
    const params = new URLSearchParams({
      select: 'record_id,canonical_brand,canonical_model,canonical_reference,canonical_dial_color,status',
      record_id: `in.(${batch.map(id => `"${String(id).replaceAll('"', '')}"`).join(',')})`,
      status: 'in.(CATALOG_CONFIRMED,HUMAN_APPROVED)',
    });
    try {
      const response = await fetch(
        `${supabaseUrl}/rest/v1/listing_identity_reviews?${params.toString()}`,
        { headers: { apikey: readKey, Authorization: `Bearer ${readKey}` } },
      );
      if (!response.ok) throw new Error(`identity review read returned ${response.status}`);
      return response.json();
    } catch (error) {
      console.warn(`[Trading Floor] Identity verification batch withheld: ${error.message}`);
      return [];
    }
  }));
  const verified = new Map(identityResults.flat().map(row => [String(row.record_id), {
    id: row.record_id,
    brand: row.canonical_brand,
    model: row.canonical_model,
    reference: row.canonical_reference,
    dial_color: row.canonical_dial_color,
    has_images: false,
    thumbnail_url: null,
    image_urls: [],
  }]));
  const verifiedIds = [...verified.keys()];
  if (!verifiedIds.length) return verified;

  const mediaBatches = [];
  for (let index = 0; index < verifiedIds.length; index += 50) {
    mediaBatches.push(verifiedIds.slice(index, index + 50));
  }
  const [mediaResults, evidenceResults] = await Promise.all([
    Promise.all(mediaBatches.map(async batch => {
      const params = new URLSearchParams({
        select: 'id,has_images,thumbnail_url,image_urls',
        id: `in.(${batch.map(id => `"${String(id).replaceAll('"', '')}"`).join(',')})`,
      });
      try {
        const response = await fetch(
          `${verifiedMediaEndpoint}?${params.toString()}`,
          { headers: { apikey: readKey, Authorization: `Bearer ${readKey}` } },
        );
        if (!response.ok) throw new Error(`verified media read returned ${response.status}`);
        return response.json();
      } catch (error) {
        console.warn(`[Trading Floor] Verified media batch unavailable; images remain withheld: ${error.message}`);
        return [];
      }
    })),
    Promise.all(mediaBatches.map(async batch => {
      const params = new URLSearchParams({
        select: 'id,raw_message',
        id: `in.(${batch.map(id => `"${String(id).replaceAll('"', '')}"`).join(',')})`,
      });
      try {
        const response = await fetch(
          `${supabaseUrl}/rest/v1/watch_records?${params.toString()}`,
          { headers: { apikey: readKey, Authorization: `Bearer ${readKey}` } },
        );
        if (!response.ok) throw new Error(`raw price evidence read returned ${response.status}`);
        return response.json();
      } catch (error) {
        console.warn(`[Trading Floor] Raw price evidence unavailable; price remains withheld: ${error.message}`);
        return [];
      }
    })),
  ]);
  for (const media of mediaResults.flat()) {
    const current = verified.get(String(media.id));
    if (current) verified.set(String(media.id), { ...current, ...media });
  }
  for (const evidence of evidenceResults.flat()) {
    const current = verified.get(String(evidence.id));
    if (current) {
      verified.set(String(evidence.id), {
        ...current,
        raw_message: evidence.raw_message || null,
      });
    }
  }
  return verified;
}

async function loadStrictIdentityCandidates(supabaseUrl, readKey, limit = 999) {
  const params = new URLSearchParams({
    select: 'record_id,canonical_brand,canonical_model,canonical_reference,canonical_dial_color,status,updated_at',
    status: 'in.(CATALOG_CONFIRMED,HUMAN_APPROVED)',
    order: 'updated_at.desc,record_id.desc',
  });
  const releaseReferenceFilter = publicationReferencePostgrestFilter();
  if (releaseReferenceFilter) params.set('canonical_reference', releaseReferenceFilter);
  const response = await fetch(
    `${supabaseUrl}/rest/v1/listing_identity_reviews?${params.toString()}`,
    {
      headers: {
        apikey: readKey,
        Authorization: `Bearer ${readKey}`,
        'Range-Unit': 'items',
        Range: `0-${limit}`,
        Prefer: 'return=representation',
      },
    },
  );
  if (!response.ok) throw new Error(`identity candidate read returned ${response.status}`);
  const rows = await response.json();
  return {
    rows: Array.isArray(rows) ? rows.slice(0, limit) : [],
    hasMore: Array.isArray(rows) && rows.length > limit,
  };
}

async function loadMarketRowsById(
  supabaseUrl,
  readKey,
  ids,
  sourceTable = 'trading_floor_verified_listings',
) {
  const batches = [];
  for (let index = 0; index < ids.length; index += 50) {
    batches.push(ids.slice(index, index + 50));
  }
  const results = await Promise.all(batches.map(async batch => {
    const params = new URLSearchParams({
      select: sourceTable === 'price_research_verified_source'
        ? 'id,brand,reference,price_usd,price_raw,currency,dial_color,condition,year,verdict,listing_type,source,listing_date,listing_status,created_at,confidence'
        : 'id,brand,reference,price_usd,price_raw,currency,dial_color,condition,year,verdict,listing_type,source,source_type,listing_date,listing_status,created_at,confidence,region',
      id: `in.(${batch.map(id => `"${String(id).replaceAll('"', '')}"`).join(',')})`,
      verdict: 'eq.APPROVED',
      confidence: 'gte.90',
    });
    const response = await fetch(
      `${supabaseUrl}/rest/v1/${sourceTable}?${params.toString()}`,
      { headers: { apikey: readKey, Authorization: `Bearer ${readKey}` } },
    );
    if (!response.ok) throw new Error(`market listing batch returned ${response.status}`);
    const marketRows = await response.json();
    if (!marketRows.length) return [];
    const rawParams = new URLSearchParams({
      select: 'id,dealer_id,raw_message',
      id: `in.(${marketRows.map(row => `"${String(row.id).replaceAll('"', '')}"`).join(',')})`,
    });
    const rawResponse = await fetch(
      `${supabaseUrl}/rest/v1/watch_records?${rawParams.toString()}`,
      { headers: { apikey: readKey, Authorization: `Bearer ${readKey}` } },
    );
    if (!rawResponse.ok) throw new Error(`raw evidence batch returned ${rawResponse.status}`);
    const evidenceById = new Map((await rawResponse.json()).map(row => [String(row.id), row]));
    return marketRows.map(row => {
      const evidence = evidenceById.get(String(row.id));
      return {
        ...row,
        dealer_id: evidence?.dealer_id || null,
        raw_message: evidence?.raw_message || null,
      };
    });
  }));
  return new Map(results.flat().map(row => [String(row.id), row]));
}

async function loadReviewedZenithRows(supabaseUrl, readKey) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const params = new URLSearchParams({
      select: 'id,brand,model,reference,price_usd,price_raw,currency,dial_color,condition,year,verdict,listing_type,source,listing_date,listing_status,created_at,confidence,has_images,thumbnail_url,image_urls,dealer_id,raw_message',
      id: `gte.${REVIEWED_ZENITH_RECORD_START}`,
      brand: 'eq.Zenith',
      source: `eq.${REVIEWED_ZENITH_SOURCE}`,
      verdict: 'eq.APPROVED',
      confidence: 'gte.90',
      order: 'id.asc',
    });
    params.append('id', `lt.${REVIEWED_ZENITH_RECORD_END}`);
    const response = await fetch(
      `${supabaseUrl}/rest/v1/watch_records?${params.toString()}`,
      {
        headers: {
          apikey: readKey,
          Authorization: `Bearer ${readKey}`,
          'Range-Unit': 'items',
          Range: `${from}-${from + pageSize - 1}`,
        },
      },
    );
    if (!response.ok) throw new Error(`reviewed Zenith source returned ${response.status}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function loadReviewedZenithPublicRows(supabaseUrl, readKey, rows) {
  const approvedImageIds = new Set();
  for (let index = 0; index < rows.length; index += 50) {
    const batch = rows.slice(index, index + 50);
    const params = new URLSearchParams({
      select: 'record_id',
      record_id: `in.(${batch.map(row => `"${String(row.id).replaceAll('"', '')}"`).join(',')})`,
      status: 'eq.VISUALLY_VERIFIED',
    });
    const response = await fetch(
      `${supabaseUrl}/rest/v1/listing_image_reviews?${params.toString()}`,
      { headers: { apikey: readKey, Authorization: `Bearer ${readKey}` } },
    );
    if (!response.ok) throw new Error(`reviewed Zenith image gate returned ${response.status}`);
    for (const review of await response.json()) approvedImageIds.add(String(review.record_id));
  }
  return new Map(rows
    .filter(isReviewedZenithReleaseRecord)
    .map(row => {
      const hasVerifiedImage = approvedImageIds.has(String(row.id));
      return [String(row.id), {
        id: row.id,
        brand: row.brand,
        model: row.model,
        reference: row.reference,
        dial_color: row.dial_color,
        has_images: hasVerifiedImage,
        thumbnail_url: hasVerifiedImage ? row.thumbnail_url : null,
        image_urls: hasVerifiedImage && Array.isArray(row.image_urls) ? row.image_urls : [],
        dealer_id: row.dealer_id || null,
        raw_message: row.raw_message || null,
      }];
    }));
}

async function loadRepostEvidenceById(supabaseUrl, readKey, ids) {
  if (!ids.length) return new Map();
  const batches = [];
  for (let index = 0; index < ids.length; index += 50) {
    batches.push(ids.slice(index, index + 50));
  }
  const results = await Promise.all(batches.map(async batch => {
    const params = new URLSearchParams({
      select: 'id,dealer_id,raw_message',
      id: `in.(${batch.map(id => `"${String(id).replaceAll('"', '')}"`).join(',')})`,
    });
    const response = await fetch(
      `${supabaseUrl}/rest/v1/watch_records?${params.toString()}`,
      { headers: { apikey: readKey, Authorization: `Bearer ${readKey}` } },
    );
    if (!response.ok) throw new Error(`repost evidence batch returned ${response.status}`);
    return response.json();
  }));
  return new Map(results.flat().map(row => [String(row.id), row]));
}

function deduplicateTradingItems(items) {
  const preferredBySignature = new Map();
  for (const item of items) {
    const signature = repostSignature(item.resolved);
    const current = preferredBySignature.get(signature);
    if (!current || (item.resolved?.has_images && !current.resolved?.has_images)) {
      preferredBySignature.set(signature, item);
    }
  }
  return [...preferredBySignature.values()];
}

function listingIsAfterCursor(record, cursor) {
  if (!cursor) return true;
  const recordId = String(record?.id || '');
  const timestamp = Date.parse(record?.created_at || '');
  const createdAt = Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  if (!cursor.createdAt) return createdAt === null && recordId < cursor.id;
  if (createdAt === null) return true;
  return createdAt < cursor.createdAt || (createdAt === cursor.createdAt && recordId < cursor.id);
}

function sortTradingItems(items) {
  return [...items].sort((left, right) => {
    const leftHasImage = Boolean(
      left.resolved?.has_images
      && (left.resolved?.thumbnail_url || left.resolved?.image_urls?.length),
    );
    const rightHasImage = Boolean(
      right.resolved?.has_images
      && (right.resolved?.thumbnail_url || right.resolved?.image_urls?.length),
    );
    const leftReviewedWorkbook = isReviewedPaneraiReleaseRecord(left.resolved)
      || isReviewedZenithReleaseRecord(left.resolved);
    const rightReviewedWorkbook = isReviewedPaneraiReleaseRecord(right.resolved)
      || isReviewedZenithReleaseRecord(right.resolved);
    const leftPrice = String(left.resolved?.currency || '').toUpperCase() === 'USD' || leftReviewedWorkbook
      ? Number(left.resolved?.price_usd) || 0
      : 0;
    const rightPrice = String(right.resolved?.currency || '').toUpperCase() === 'USD' || rightReviewedWorkbook
      ? Number(right.resolved?.price_usd) || 0
      : 0;
    const leftHasPrice = leftPrice > 0;
    const rightHasPrice = rightPrice > 0;
    if (leftHasPrice !== rightHasPrice) return Number(rightHasPrice) - Number(leftHasPrice);
    if (leftHasImage !== rightHasImage) return Number(rightHasImage) - Number(leftHasImage);
    if (leftPrice !== rightPrice) return rightPrice - leftPrice;
    const leftTime = Date.parse(left.resolved?.created_at || '') || Number.NEGATIVE_INFINITY;
    const rightTime = Date.parse(right.resolved?.created_at || '') || Number.NEGATIVE_INFINITY;
    if (leftTime !== rightTime) return rightTime - leftTime;
    return String(right.resolved?.id || '').localeCompare(String(left.resolved?.id || ''));
  });
}

function matchesStrictReleaseFilters(record, {
  listingType,
  itemType,
  requestedBrand,
  condition,
  region,
  search,
}) {
  if (!record || !isPublicationBrandAllowed(record.brand)) return false;
  if (!isReleaseListingEligible(record)) return false;
  if (requestedBrand && String(record.brand).toLowerCase() !== requestedBrand.toLowerCase()) return false;
  if (itemType && !['all', 'watches'].includes(itemType)) return false;
  if (listingType === 'WTB' && !['WTB', 'NTQ'].includes(record.listing_type)) return false;
  if (listingType && listingType !== 'WTB' && record.listing_type !== listingType) return false;
  if (!listingType && !['WTS', 'WTB', 'NTQ', 'OTHER'].includes(record.listing_type)) return false;
  if (String(record.id || '').startsWith('preview_demo_')) return false;
  if (condition && String(record.condition || '').toLowerCase() !== condition.toLowerCase()) return false;
  if (region && !String(record.region || '').toLowerCase().includes(region.toLowerCase())) return false;
  if (search) {
    const parsed = parseTradingSearch(search);
    if (parsed.reference && String(record.reference || '').toUpperCase() !== parsed.reference.toUpperCase()) return false;
    if (parsed.brand && String(record.brand || '').toLowerCase() !== parsed.brand.toLowerCase()) return false;
    if (parsed.dial && String(record.dial_color || '').toLowerCase() !== parsed.dial.toLowerCase()) return false;
  }
  return isReviewedPaneraiReleaseRecord(record)
    || isReviewedZenithReleaseRecord(record)
    || isCustomerIdentitySafe(record);
}

async function loadFullReviewedBrandCursorPage({
  supabaseUrl,
  readKey,
  cursor,
  page,
  pageSize,
  listingType,
  itemType,
  requestedBrand,
  condition,
  region,
  search,
  imagesOnly,
}) {
  const requestedBrandKey = String(requestedBrand || '').trim().toLowerCase();
  const controlledPaneraiRelease = requestedBrandKey === 'panerai';
  const controlledZenithRelease = requestedBrandKey === 'zenith';
  const controlledFileRelease = controlledPaneraiRelease || controlledZenithRelease;
  const controlledReferences = controlledPaneraiRelease ? REVIEWED_PANERAI_REFERENCES : [];
  let controlledVerifiedById = null;
  if (itemType && !['all', 'watches'].includes(itemType)) {
    return {
      count: 0,
      total: 0,
      page,
      pageSize,
      totalIsEstimate: false,
      nextCursor: null,
      hasMore: false,
      records: [],
      status: 'ok',
      publicationBrands: publicationBrands(),
      publicationReferences: controlledReferences,
      publicationScope: controlledFileRelease ? 'REVIEWED_FILE' : 'ALL_REVIEWED',
      accessMode: 'server_key',
    };
  }

  let selected;
  let totalCount;
  let hasMore;
  let nextOffset = null;
  if (controlledFileRelease) {
    const sourceRows = controlledPaneraiRelease
      ? [...(await loadMarketRowsById(
          supabaseUrl,
          readKey,
          REVIEWED_PANERAI_RECORD_IDS,
          'price_research_verified_source',
        )).values()]
      : await loadReviewedZenithRows(supabaseUrl, readKey);
    controlledVerifiedById = controlledZenithRelease
      ? await loadReviewedZenithPublicRows(supabaseUrl, readKey, sourceRows)
      : await loadVerifiedPublicListings(
          supabaseUrl,
          readKey,
          sourceRows.map(row => row.id),
          'price_research_verified_source',
        );
    const controlledRows = sourceRows.map(row => {
      const verified = controlledVerifiedById.get(String(row.id));
      return {
        ...row,
        brand: verified?.brand || row.brand,
        model: verified?.model || row.model,
        reference: verified?.reference || row.reference,
        dial_color: verified?.dial_color || row.dial_color,
        has_images: Boolean(verified?.has_images),
        thumbnail_url: verified?.thumbnail_url || null,
        image_urls: verified?.image_urls || [],
      };
    });
    const controlledItems = sortTradingItems(controlledRows.map(resolved => ({ resolved })))
      .filter(item => matchesStrictReleaseFilters(item.resolved, {
        listingType,
        itemType,
        requestedBrand,
        condition,
        region,
        search,
      }))
      .filter(item => !imagesOnly || item.resolved.has_images !== false);
    const matched = deduplicateTradingItems(controlledItems)
      .map(item => item.resolved);
    totalCount = matched.length;
    const offset = Number.isSafeInteger(cursor?.offset)
      ? cursor.offset
      : (page - 1) * pageSize;
    selected = matched.slice(offset, offset + pageSize);
    nextOffset = offset + selected.length;
    hasMore = nextOffset < matched.length;
  } else {
    const reviewedReleaseCache = process.env.THREE_BRAND_RELEASE_CACHE === 'true'
      ? 'three_brand_verified_trading_release_cache'
      : 'two_brand_verified_trading_release_cache';
    const reviewedDisplaySource = reviewedReleaseCache.replace('_release_cache', '_display_source');
    const candidateLimit = Math.min(Math.max(pageSize * 5, 50), 500);
    const start = Number.isSafeInteger(cursor?.offset)
      ? cursor.offset
      : (page - 1) * pageSize;
    const end = start + candidateLimit - 1;
    const params = new URLSearchParams({
      select: [
        'id,brand,model,reference,dial_color,condition,year,price_raw,price_usd,currency',
        'confidence,verdict,source,source_type,listing_type,listing_date,listing_status',
        'created_at,has_images,thumbnail_url,image_urls,region,identity_review_status',
        'has_display_price,has_source_image',
      ].join(','),
      order: 'has_display_price.desc,has_source_image.desc,price_usd.desc.nullslast,created_at.desc.nullslast,id.desc',
    });
    if (listingType === 'WTB') params.set('listing_type', 'in.(WTB,NTQ)');
    else if (listingType) params.set('listing_type', `eq.${listingType}`);
    if (requestedBrand) params.set('brand', `eq.${requestedBrand}`);
    if (condition) params.set('condition', `ilike.${condition}`);
    if (region) params.set('region', `ilike.*${region}*`);
    if (imagesOnly) params.set('has_images', 'eq.true');
    const parsedSearch = parseTradingSearch(search);
    if (parsedSearch.reference) params.set('reference', `eq.${parsedSearch.reference}`);
    if (parsedSearch.brand && !requestedBrand) params.set('brand', `ilike.${parsedSearch.brand}`);
    if (parsedSearch.dial) params.set('dial_color', `ilike.${parsedSearch.dial}`);
    const response = await fetch(
      `${supabaseUrl}/rest/v1/${reviewedDisplaySource}?${params.toString()}`,
      {
        headers: {
          apikey: readKey,
          Authorization: `Bearer ${readKey}`,
          'Range-Unit': 'items',
          Range: `${start}-${end}`,
        },
      },
    );
    if (!response.ok) throw new Error(`reviewed release cache returned ${response.status}`);
    const candidateRows = await response.json();
    const matched = candidateRows.filter(record => matchesStrictReleaseFilters(record, {
      listingType,
      itemType,
      requestedBrand,
      condition,
      region,
      search,
    }));
    selected = matched.slice(0, pageSize);
    nextOffset = start + selected.length;
    const contentRange = response.headers.get('content-range') || '';
    const totalText = contentRange.split('/')[1] || '';
    const parsedTotal = Number.parseInt(totalText, 10);
    const total = Number.isFinite(parsedTotal) ? parsedTotal : null;
    totalCount = total;
    hasMore = matched.length > pageSize || candidateRows.length > pageSize;
  }
  const verifiedById = controlledVerifiedById || await loadVerifiedPublicListings(
        supabaseUrl,
        readKey,
        selected.map(row => row.id),
        controlledFileRelease ? 'price_research_verified_source' : 'trading_floor_verified_listings',
      );
  const current = selected
    .map(row => {
      const verified = verifiedById.get(String(row.id));
      return verified ? {
        ...row,
        brand: verified.brand || row.brand,
        model: verified.model || row.model,
        reference: verified.reference || row.reference,
        dial_color: verified.dial_color || row.dial_color,
        has_images: verified.has_images,
        thumbnail_url: verified.thumbnail_url,
        image_urls: verified.image_urls,
      } : null;
    })
    .filter(Boolean);
  const records = current.map(resolved => {
    const verified = verifiedById.get(String(resolved.id));
    const normalized = normalizeMarketRow(
      {
        ...resolved,
        raw_message: verified?.raw_message || null,
      },
      listEquivalentReferences(resolved.reference, resolved.brand),
    );
    const reviewedWorkbookPrice = controlledFileRelease
      && Number.isFinite(Number(resolved.price_usd))
      && Number(resolved.price_usd) > 0;
    const priceVerified = resolved.listing_type === 'WTS'
      && (reviewedWorkbookPrice || (
        normalized.analytics_currency_status === 'VERIFIED'
        && Number.isFinite(Number(normalized.analytics_price_usd))
        && Number(normalized.analytics_price_usd) > 0
      ));
    const safe = sanitizeTradingRecord({
      ...resolved,
      price_usd: priceVerified
        ? (reviewedWorkbookPrice ? Number(resolved.price_usd) : normalized.analytics_price_usd)
        : null,
      price_raw: reviewedWorkbookPrice ? resolved.price_raw : normalized.source_price_amount || null,
      currency: priceVerified
        ? (reviewedWorkbookPrice ? resolved.currency : 'USD')
        : normalized.source_currency || null,
    }, { verifiedImages: Boolean(resolved.has_images) });
    if (resolved.listing_type !== 'WTS' || priceVerified) {
      return {
        ...safe,
        ...publicImageProvenance(resolved),
        price_evidence_status: resolved.listing_type === 'WTS'
          ? (reviewedWorkbookPrice ? 'HUMAN_APPROVED_WORKBOOK' : normalized.analytics_currency_status)
          : null,
      };
    }
    return {
      ...safe,
      ...publicImageProvenance(resolved),
      data_quality_issues: [...new Set([
        ...(safe.data_quality_issues || []),
        normalized.analytics_currency_status,
      ])],
      data_quality_review_required: true,
      price_evidence_status: reviewedWorkbookPrice
        ? 'HUMAN_APPROVED_WORKBOOK'
        : normalized.analytics_currency_status,
    };
  });
  const cursorRecord = selected.at(-1);
  return {
    count: records.length,
    total: totalCount,
    page,
    pageSize,
    totalIsEstimate: false,
    nextCursor: hasMore && cursorRecord
      ? encodeTradingCursor({ ...cursorRecord, offset: nextOffset })
      : null,
    hasMore,
    records,
    status: 'ok',
    publicationBrands: publicationBrands(),
    publicationReferences: controlledReferences,
    publicationScope: controlledFileRelease ? 'REVIEWED_FILE' : 'ALL_REVIEWED',
    accessMode: 'server_key',
  };
}

async function loadStrictCursorPage({
  supabaseUrl,
  readKey,
  cursor,
  page,
  pageSize,
  listingType,
  itemType,
  requestedBrand,
  condition,
  region,
  search,
  imagesOnly,
}) {
  if (String(requestedBrand || '').trim().toLowerCase() === 'panerai') {
    return loadFullReviewedBrandCursorPage({
      supabaseUrl,
      readKey,
      cursor,
      page,
      pageSize,
      listingType,
      itemType,
      requestedBrand: 'Panerai',
      condition,
      region,
      search,
      imagesOnly,
    });
  }
  if (isFullReviewedBrandRelease()) {
    return loadFullReviewedBrandCursorPage({
      supabaseUrl,
      readKey,
      cursor,
      page,
      pageSize,
      listingType,
      itemType,
      requestedBrand,
      condition,
      region,
      search,
      imagesOnly,
    });
  }
  // The three-reference release currently contains fewer than 999 reviewed
  // identities. Load that bounded set once so repost selection is global for
  // the release and cannot repeat the same offer on a later browser page.
  const identityPage = await loadStrictIdentityCandidates(supabaseUrl, readKey);
  if (identityPage.hasMore) {
    throw new Error('Reviewed release exceeds the 999-row global repost-deduplication window');
  }
  const marketById = await loadMarketRowsById(
    supabaseUrl,
    readKey,
    identityPage.rows.map(row => row.record_id),
  );
  const matched = identityPage.rows
    .map(identity => {
      const market = marketById.get(String(identity.record_id));
      if (!market) return null;
      const resolved = {
        ...market,
        brand: identity.canonical_brand || market.brand,
        reference: identity.canonical_reference || market.reference,
        dial_color: identity.canonical_dial_color || market.dial_color,
      };
      return matchesStrictReleaseFilters(resolved, {
        listingType,
        itemType,
        requestedBrand,
        condition,
        region,
        search,
      }) ? { identity, resolved } : null;
    })
    .filter(Boolean);
  const verifiedById = await loadVerifiedPublicListings(
    supabaseUrl,
    readKey,
    matched.map(item => item.resolved.id),
  );
  const mediaResolved = matched.map(item => {
    const verified = verifiedById.get(String(item.resolved.id));
    return {
      ...item,
      resolved: {
        ...item.resolved,
        has_images: Boolean(verified?.has_images),
        thumbnail_url: verified?.thumbnail_url || null,
        image_urls: verified?.image_urls || [],
      },
    };
  });
  const uniqueMatched = sortTradingItems(deduplicateTradingItems(mediaResolved));
  const afterCursor = uniqueMatched.filter(item => listingIsAfterCursor(item.resolved, cursor));
  const offset = cursor ? 0 : (page - 1) * pageSize;
  const selected = afterCursor.slice(offset, offset + pageSize);
  const records = selected.map(({ resolved }) => {
    const verified = verifiedById.get(String(resolved.id));
    const normalized = normalizeMarketRow(
      resolved,
      listEquivalentReferences(resolved.reference, resolved.brand),
    );
    const priceVerified = resolved.listing_type === 'WTS'
      && normalized.analytics_currency_status === 'VERIFIED'
      && Number.isFinite(Number(normalized.analytics_price_usd))
      && Number(normalized.analytics_price_usd) > 0;
    const { dealer_id: _dealerId, raw_message: _rawMessage, ...publicResolved } = resolved;
    const safe = sanitizeTradingRecord({
      ...publicResolved,
      brand: verified?.brand || resolved.brand,
      reference: verified?.reference || resolved.reference,
      dial_color: verified?.dial_color || resolved.dial_color,
      has_images: Boolean(verified?.has_images),
      thumbnail_url: verified?.thumbnail_url || null,
      image_urls: verified?.image_urls || [],
      price_usd: priceVerified ? normalized.analytics_price_usd : null,
      price_raw: normalized.source_price_amount || null,
      currency: priceVerified ? 'USD' : normalized.source_currency || null,
    }, { verifiedImages: Boolean(verified?.has_images) });
    if (resolved.listing_type !== 'WTS' || priceVerified) {
      return {
        ...safe,
        price_evidence_status: resolved.listing_type === 'WTS'
          ? normalized.analytics_currency_status
          : null,
      };
    }
    return {
      ...safe,
      data_quality_issues: [...new Set([
        ...(safe.data_quality_issues || []),
        normalized.analytics_currency_status,
      ])],
      data_quality_review_required: true,
      price_evidence_status: normalized.analytics_currency_status,
    };
  });
  const hasMore = afterCursor.length > offset + pageSize;
  const cursorRecord = selected.at(-1)?.resolved;
  const nextCursor = hasMore && cursorRecord
    ? encodeTradingCursor(cursorRecord)
    : null;
  return {
    count: records.length,
    total: uniqueMatched.length,
    page,
    pageSize,
    totalIsEstimate: false,
    nextCursor,
    hasMore,
    records,
    status: 'ok',
    publicationBrands: publicationBrands(),
    publicationReferences: publicationReferences().map(entry => ({
      brand: entry.brand || null,
      reference: entry.reference,
    })),
    accessMode: 'server_key',
  };
}

// Standard USD exchange rates
const RATES = {
  USD: 1.0, USDT: 1.0, HKD: 0.128, EUR: 1.08,
  GBP: 1.25, CHF: 1.10, SGD: 0.74, AUD: 0.65,
  CAD: 0.73, JPY: 0.0065, CNY: 0.138, RMB: 0.138,
};

// Legacy Slang and suffix maps from JASS v4.0 (fully integrated)
const SLANG_TO_COLLECTION = {
  'hulk': 'Submariner Date', 'kermit': 'Submariner Date', 'starbucks': 'Submariner Date',
  'smurf': 'Submariner Date', 'batman': 'GMT Master II', 'batgirl': 'GMT Master II',
  'pepsi': 'GMT Master II', 'rootbeer': 'GMT Master II', 'coke': 'GMT Master II',
  'sprite': 'GMT Master II', 'bruce wayne': 'GMT Master II',
  'polar': 'Explorer II', 'ghost': 'Daytona', 'panda': 'Daytona',
  'reverse panda': 'Daytona', 'zebra': 'Daytona', 'land dweller': 'Sky-Dweller',
  'tiffany': 'Oyster Perpetual', 'wimbledon': 'Datejust', 'daytona': 'Daytona',
  'submariner': 'Submariner', 'sea-dweller': 'Sea-Dweller', 'deepsea': 'Deepsea',
  'explorer': 'Explorer', 'gmt': 'GMT Master II', 'datejust': 'Datejust',
  'nautilus': 'Nautilus', 'aquanaut': 'Aquanaut', 'overseas': 'Overseas',
  'royal oak': 'Royal Oak', 'royal oak offshore': 'Royal Oak Offshore',
  'day-date': 'Day-Date', 'president': 'Day-Date',
};

const ROLEX_SUFFIX_MAP = {
  LN: 'Black', LB: 'Blue', LV: 'Green', CHNR: 'Brown', OR: 'Pink',
  TI: 'Grey', BC: 'Black', ST: 'Blue', GRNR: 'Black', BLNR: 'Blue',
  BLRO: 'Red Blue', VTNR: 'Green Black', RBR: 'Diamond',
};

// ============================================================
// State Machine Helper Methods
// ============================================================

function assertField(fieldName, rawValue, normalizedValue, confidence, method) {
  return {
    field_name: fieldName,
    raw_value: rawValue,
    normalized_value: normalizedValue,
    confidence,
    source_method: method,
    catalog_confirmed: false,
    human_confirmed: false,
  };
}

function extractFromDictionary(text, dictMap, fieldName) {
  const lower = text.toLowerCase();
  for (const [key, value] of Object.entries(dictMap)) {
    const regex = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (regex.test(lower)) {
      return assertField(fieldName, key, value, 90, 'abbreviation_dictionary');
    }
  }
  return assertField(fieldName, null, null, 0, 'not_found');
}

// Brand mapping from reference
const REFERENCE_BRAND_MAP = [
  { pattern: /^(?:15|26|77|67)[0-9]{3}[A-Z]{2}\./, brand: 'Audemars Piguet', confidence: 82 },
  { pattern: /^(?:15|26|77|67)[0-9]{3}[A-Z]{2}/, brand: 'Audemars Piguet', confidence: 80 },
  { pattern: /^[1-3][0-9]{4,5}[A-Z]{0,4}$/, brand: 'Rolex', confidence: 72 },
  { pattern: /^[458][0-9]{3}[Vv]\//, brand: 'Vacheron Constantin', confidence: 85 },
  { pattern: /^[34567][0-9]{3}(?:\/[0-9]{1,3}[A-Z]{1,2})?/, brand: 'Patek Philippe', confidence: 75 },
  { pattern: /^[0-9]{3}\.[0-9]{3}$/, brand: 'A. Lange & Söhne', confidence: 90 },
  { pattern: /^RM\s*0*\d{2,3}/i, brand: 'Richard Mille', confidence: 85 },
  { pattern: /^PAM\s*0*\d{3,5}/i, brand: 'Panerai', confidence: 95 },
];

function extractBrand(text, ref, context) {
  const lower = text.toLowerCase();
  
  if (context.brand_context) {
    return assertField('brand', context.brand_context, context.brand_context, 65, 'context_inherited');
  }

  for (const [key, value] of Object.entries(BRANDS)) {
    if (new RegExp(`\\b${key}\\b`, 'i').test(lower)) {
      return assertField('brand', key, value, 88, 'abbreviation_dictionary');
    }
  }

  if (ref) {
    const mapped = REFERENCE_BRAND_MAP.find(m => m.pattern.test(ref));
    if (mapped) return assertField('brand', mapped.brand, mapped.brand, mapped.confidence, 'reference_inference');
    
    const catalogEntries = MASTER_CATALOG[ref] || MASTER_CATALOG[ref.replace(/-/g, '')];
    if (catalogEntries && catalogEntries.length > 0) {
      return assertField('brand', catalogEntries[0].brand, catalogEntries[0].brand, 90, 'catalog_reverse_lookup');
    }
  }
  return assertField('brand', null, null, 0, 'not_found');
}

function extractReference(text) {
  const patterns = [
    { pattern: /\b(\d{3}\.[A-Z0-9]{2,4}\.\d{4}\.[A-Z0-9.]{2,15})\b/i, confidence: 95 },
    { pattern: /\b((?:15|26|77|67)[0-9]{3}[A-Z]{2}\.[A-Z]{2}\.\d{4}[A-Z]{2}\.\d{2})\b/i, confidence: 95 },
    { pattern: /\b((?:15|26|77|67)[0-9]{3}[A-Z]{2}(?:\.OO\.[A-Z0-9.]+)?)\b/i, confidence: 92 },
    { pattern: /\b([458][0-9]{3}[Vv]\/[0-9A-Za-z-]{1,10})\b/i, confidence: 92 },
    { pattern: /\b([1-3][0-9]{4,5}[A-Z]{0,4})\b/, confidence: 90 },
    { pattern: /\b([34567][0-9]{3}[A-Z]{0,2}(?:\/[0-9]{1,3}[A-Z]{1,2})?(?:-[0-9]{3})?)\b/i, confidence: 88 },
    { pattern: /\b(RM\s*0*([0-9]{2,3})(?:[-\s][A-Z0-9]+)?)\b/i, confidence: 85 },
    { pattern: /\b([A-Z]{1,2}[0-9]{5,6}[A-Z0-9]{4,10})\b/i, confidence: 95 },
    { pattern: /\b(PAM\s*0*\d{3,5})\b/i, confidence: 90 },
    { pattern: /\b([0-9]{3}\.[0-9]{3})\b/i, confidence: 90 },
    { pattern: /(?<!(?:used|new|unused|mint|like new)[\s\t]*)\b([A-Z]?[0-9]{4,6}[A-Z]{0,4})\b/i, confidence: 70 },
  ];

  const textWithoutPrices = text.replace(/[0-9.,]+[kKmMwW万]?\s*(?:hkd|usd|rmb|chf|gbp|eur|jpy)/gi, '')
                                .replace(/(?:hkd|usd|rmb|chf|gbp|eur|jpy)\s*[0-9.,]+[kKmMwW万]/gi, '');

  for (const { pattern, confidence } of patterns) {
    const match = textWithoutPrices.match(pattern);
    if (match) return assertField('reference', match[0], match[1].toUpperCase(), confidence, 'regex_extract');
  }
  return assertField('reference', null, null, 0, 'not_found');
}

function inferDialFromRef(ref) {
  if (!ref) return null;
  const r = ref.toUpperCase();
  for (const [sfx, color] of Object.entries(ROLEX_SUFFIX_MAP)) {
    if (r.endsWith(sfx)) return color;
  }
  const last = r.split(/[\/\-]/).pop() || '';
  if (last.endsWith('G') && last.length > 2) return 'Blue';
  if (last.endsWith('J') && last.length > 2) return 'Champagne';
  if (last.endsWith('P') && last.length > 2) return 'Blue';
  if (last.endsWith('R') && last.length > 2) return 'Brown';
  return null;
}

function extractDial(text, ref) {
  const dictDial = extractFromDictionary(text, DIALS.dial_colors || {}, 'dial');
  if (dictDial.normalized_value) return dictDial;
  
  if (ref) {
    const inferred = inferDialFromRef(ref);
    if (inferred) return assertField('dial', ref, inferred, 80, 'reference_suffix_inference');
  }
  return dictDial;
}

function extractModel(text, ref) {
  const lower = text.toLowerCase();
  for (const [slang, collection] of Object.entries(SLANG_TO_COLLECTION)) {
    if (new RegExp(`\\b${slang}\\b`, 'i').test(lower)) {
      return assertField('model', slang, collection, 90, 'slang_dictionary');
    }
  }
  if (ref) {
    const catalogEntries = MASTER_CATALOG[ref] || MASTER_CATALOG[ref.replace(/-/g, '')];
    if (catalogEntries && catalogEntries.length > 0) {
      return assertField('model', catalogEntries[0].model, catalogEntries[0].model, 95, 'catalog_lookup');
    }
  }
  return assertField('model', null, null, 0, 'not_found');
}

function extractCondition(text, context) {
  let ctxCond = null;
  if (context.condition_context) {
    ctxCond = assertField('condition', context.condition_context, context.condition_context, 65, 'context_inherited');
  }
  const dictCond = extractFromDictionary(text, CONDITIONS.conditions || {}, 'condition');
  return dictCond.normalized_value ? dictCond : (ctxCond || dictCond);
}

function extractCardDate(text) {
  const cardPattern = /\bN\s*(\d{1,2})\s*\/\s*(\d{2,4})\b/i;
  const match = text.match(cardPattern);
  if (match) {
    const month = parseInt(match[1]);
    const yearRaw = parseInt(match[2]);
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    return {
      card_month: assertField('card_month', match[1], month, 92, 'regex_extract'),
      card_year: assertField('card_year', match[2], year, 92, 'regex_extract'),
    };
  }
  const yearOnlyPattern = /(?:\/|year\s*)(\d{2,4})/i;
  const yearMatch = text.match(yearOnlyPattern);
  if (yearMatch) {
    const yearRaw = parseInt(yearMatch[1]);
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    return {
      card_month: assertField('card_month', null, null, 0, 'not_found'),
      card_year: assertField('card_year', yearMatch[1], year, 75, 'regex_extract'),
    };
  }
  return {
    card_month: assertField('card_month', null, null, 0, 'not_found'),
    card_year: assertField('card_year', null, null, 0, 'not_found'),
  };
}

// Price and USD conversion
function extractPrices(text) {
  const prices = [];
  const currencyMap = CURRENCIES.currencies || {};
  const multipliers = CURRENCIES.price_multipliers || {};

  const currencyTokens = Object.keys(currencyMap)
    .filter(k => k.length >= 2)
    .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length)
    .join('|');

  const pricePattern = new RegExp(
    `(?:` +
    `(${currencyTokens})[\\s\\u00A0]*\\b([\\d,]+(?:\\.\\d+)?)[\\s\\u00A0]*(k|m|mn|mil|万|w)?` +
    `|` +
    `\\b(?!(?:19|20)\\d{2}\\b)([\\d,]+(?:\\.\\d+)?)[\\s\\u00A0]*(k|m|mn|mil|万|w)?[\\s\\u00A0]*(${currencyTokens})` +
    `)`,
    'gi'
  );

  let match;
  while ((match = pricePattern.exec(text)) !== null) {
    let rawCurrencyToken, amountStr, multiplierStr;

    if (match[1]) {
      rawCurrencyToken = match[1]; amountStr = match[2]; multiplierStr = match[3];
    } else {
      amountStr = match[4]; multiplierStr = match[5]; rawCurrencyToken = match[6];
    }

    const rawAmount = parseFloat(amountStr.replace(/,/g, ''));
    if (isNaN(rawAmount) || rawAmount <= 0) continue;

    const multiplier = multiplierStr ? (multipliers[multiplierStr.toLowerCase()] || 1) : 1;
    const amount = rawAmount * multiplier;

    if (!multiplierStr && amount < 5000) continue;

    const normalizedCurrency = currencyMap[rawCurrencyToken.toLowerCase()] || rawCurrencyToken.toUpperCase();
    const usdRate = RATES[normalizedCurrency] || 1.0;
    const amountUsd = Math.round(amount * usdRate);

    prices.push({
      price_type: prices.length === 0 ? 'ASK_PRICE' : 'ALT_CURRENCY_PRICE',
      amount_original: amount,
      currency_original: normalizedCurrency,
      amount_usd: amountUsd,
      is_primary: prices.length === 0,
      raw_price_text: match[0].trim(),
      confidence: 85,
    });
  }

  // Validate exchange rates between price pairs
  if (prices.length === 2) {
    const rate = prices[1].amount_original / prices[0].amount_original;
    const isReasonable =
      (prices[0].currency_original === 'USDT' && prices[1].currency_original === 'HKD' && rate > 5 && rate < 12) ||
      (prices[0].currency_original === 'HKD' && prices[1].currency_original === 'USDT' && rate > 0.08 && rate < 0.2);

    for (const p of prices) {
      p.implied_exchange_rate = rate;
      p.exchange_validation = isReasonable ? 'ALT_CURRENCY_CONSISTENT' : 'EXCHANGE_RATE_CONFLICT';
    }
  }

  return prices;
}

// Context headers parser
function parseContext(text) {
  const context = { brand_context: null, condition_context: null };
  if (/\bROLEX\b/i.test(text)) context.brand_context = 'Rolex';
  if (/\bPATEK\b/i.test(text) || /\bPP\b/.test(text)) context.brand_context = 'Patek Philippe';
  if (/\bAP\b/.test(text) || /\bAUDEMARS\b/i.test(text)) context.brand_context = 'Audemars Piguet';
  if (/\bRM\b/.test(text) || /\bRICHARD MILLE\b/i.test(text)) context.brand_context = 'Richard Mille';
  if (/\bVC\b/.test(text) || /\bVACHERON\b/i.test(text)) context.brand_context = 'Vacheron Constantin';
  
  if (/\bNEW\b/i.test(text)) context.condition_context = 'New';
  if (/\bUSED\b/i.test(text)) context.condition_context = 'Used';
  return context;
}

// Score JASS-5 Confidence
function scoreConfidence(bundle, assertions) {
  const identityFields = ['brand', 'reference', 'model', 'dial', 'material', 'condition'];
  const foundIdentity = identityFields.filter(f => assertions[f]?.normalized_value).length;
  let identityConf = (foundIdentity / identityFields.length) * 100;

  let catalogConf = 0;
  if (bundle.brand && bundle.reference) {
    const match = lookupCatalog(bundle.reference, bundle.brand);
    if (match && match.found) {
      if (match.matchType === 'exact' || match.matchType === 'exact_alias' || match.matchType === 'collapsed') {
        bundle.catalog_match_status = 'CATALOG_EXACT_MATCH';
        catalogConf = 100;
      } else {
        bundle.catalog_match_status = 'CATALOG_REFERENCE_FOUND_VARIANT_UNCONFIRMED';
        catalogConf = 80;
      }
    } else {
      bundle.catalog_match_status = 'CATALOG_NOT_FOUND';
      catalogConf = 10;
    }
  } else {
    bundle.catalog_match_status = 'CATALOG_NOT_FOUND';
    catalogConf = 10;
  }

  const prices = bundle.prices || [];
  const hasPrimary = prices.some(p => p.is_primary && p.amount_original > 0);
  const hasCurrencyClear = prices.some(p => p.currency_original);
  let commercialConf = 0;
  if (hasPrimary) commercialConf += 50;
  if (hasCurrencyClear) commercialConf += 50;

  let sourceConf = 100; // default for live API ingestion
  let mediaConf = bundle.images?.length > 0 ? 100 : 0;

  const total = (
    identityConf * 0.40 +
    catalogConf * 0.25 +
    commercialConf * 0.20 +
    sourceConf * 0.10 +
    mediaConf * 0.05
  );

  return {
    total_confidence: Math.round(total),
    catalog_match_status: bundle.catalog_match_status
  };
}

function routeListing(confidence, bundle) {
  const review_reasons = bundle.review_reasons || [];
  if (!bundle.brand) review_reasons.push('MISSING_BRAND');
  if (!bundle.reference) review_reasons.push('MISSING_REFERENCE');
  if (!bundle.prices?.length) review_reasons.push('MISSING_PRICE');
  if (bundle.catalog_match_status === 'CATALOG_NOT_FOUND') review_reasons.push('CATALOG_NOT_FOUND');

  let approval_state = 'QUARANTINED';
  if (confidence >= 98) approval_state = 'AUTO_APPROVED';
  else if (confidence >= 90) approval_state = 'REVIEW_SUGGESTED';
  else if (confidence >= 80) approval_state = 'MUST_REVIEW';
  else if (confidence >= 60) approval_state = 'MANUAL_INTERVENTION';

  return { approval_state, review_reasons };
}

// Parse watch details via JASS-5 parser pipeline
function parseJass5(text, context, referenceHint = null) {
  const refAssertion = referenceHint
    ? assertField('reference', referenceHint, referenceHint, 95, 'context_segmentation')
    : extractReference(text);
  const brandAssertion = extractBrand(text, refAssertion.normalized_value, context);
  const dialAssertion = extractDial(text, refAssertion.normalized_value);
  const modelAssertion = extractModel(text, refAssertion.normalized_value);
  const materialAssertion = extractFromDictionary(text, MATERIALS.materials || {}, 'material');
  const braceletAssertion = extractFromDictionary(text, MATERIALS.bracelets || {}, 'bracelet');
  const bezelAssertion = extractFromDictionary(text, MATERIALS.bezels || {}, 'bezel');
  const conditionAssertion = extractCondition(text, context);
  let setStatusAssertion = extractFromDictionary(text, CONDITIONS.set_status || {}, 'set_status');
  if (!setStatusAssertion.normalized_value && context.set_status_context) {
    setStatusAssertion = assertField('set_status', context.set_status_context, context.set_status_context, 85, 'context_inherited');
  }
  const cardDate = extractCardDate(text);

  
    if (brandAssertion.normalized_value && (brandAssertion.normalized_value.toUpperCase() === 'RICHARD MILLE' || brandAssertion.normalized_value.toUpperCase() === 'RM') && refAssertion.normalized_value) {
        const rmMatch = refAssertion.normalized_value.match(/^(RM\s*\d{2,3}(?:-\d{2})?)/i);
        if (rmMatch) {
            refAssertion.normalized_value = rmMatch[1].toUpperCase().replace(/\s+/, '');
        }
    }
    
    if (brandAssertion.normalized_value && brandAssertion.normalized_value.toUpperCase() === 'ZENITH') {
        const zMatch = text.match(/\b(\d{2}\.\d{4}\.\d{3,4}\/\d{2}\.[A-Z0-9]+)\b/i);
        if (zMatch) {
            refAssertion.normalized_value = zMatch[1].toUpperCase();
        }
    }

    const assertions = {
      brand: brandAssertion,
      reference: refAssertion,
      model: modelAssertion,
      dial: dialAssertion,
      material: materialAssertion,
      bracelet: braceletAssertion,
      bezel: bezelAssertion,
      condition: conditionAssertion,
      set_status: setStatusAssertion,
      card_month: cardDate.card_month,
      card_year: cardDate.card_year
    };


  const prices = extractPriceObservations(text, context);

  const bundle = {
    brand: brandAssertion.normalized_value,
    reference: refAssertion.normalized_value,
    model: modelAssertion.normalized_value,
    dial: dialAssertion.normalized_value,
    material: materialAssertion.normalized_value,
    bracelet: braceletAssertion.normalized_value,
    bezel: bezelAssertion.normalized_value,
    condition: conditionAssertion.normalized_value,
    set_status: setStatusAssertion.normalized_value,
    card_month: cardDate.card_month.normalized_value,
    card_year: cardDate.card_year.normalized_value,
    prices,
    images: [],
    catalog_match_status: 'CATALOG_NOT_FOUND',
    review_reasons: []
  };

  const score = scoreConfidence(bundle, assertions);
  const { approval_state, review_reasons } = routeListing(score.total_confidence, bundle);

  return {
    brand: bundle.brand || 'Unknown',
    ref: bundle.reference || null,
    model: bundle.model || null,
    dial: bundle.dial || null,
    material: bundle.material || null,
    bracelet: bundle.bracelet || null,
    bezel: bundle.bezel || null,
    condition: bundle.condition || null,
    set_status: bundle.set_status || null,
    year: bundle.card_year || null,
    prices: bundle.prices,
    confidence: score.total_confidence,
    catalog_status: score.catalog_match_status,
    approval_state,
    review_reasons,
    assertions: Object.values(assertions).filter(a => a.normalized_value !== null)
  };
}

// ── DEEPSEEK LLM ENRICH ──────────────────────────────────────────

async function llmEnrich(rawMsg, parsed, apiKey) {
  const resp = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: `You are a luxury watch expert. Extract watch attributes from raw chat listings. Return JSON ONLY with: brand, reference, model, dialColor, material, bracelet, bezel, condition, setStatus, year, price, currency, confidence (0-100). Be extremely precise about case abbreviations.`
        },
        {
          role: 'user',
          content: `Regex result: ${JSON.stringify(parsed)}\nMessage: "${rawMsg}"\nReturn JSON:`
        },
      ],
      max_tokens: 300, temperature: 0.1,
      response_format: { type: 'json_object' },
    }),
  });
  if (!resp.ok) throw new Error(`DeepSeek ${resp.status}`);
  const d = await resp.json();
  return JSON.parse(d.choices[0].message.content);
}

// ── MULTI-WATCH SPLITTER ────────────────────────────────────

function splitMulti(rawMsg) {
  const lines = rawMsg.split(/\n/).map(l => l.trim()).filter(Boolean);
  const candidates = [];
  let currentHeader = '';
  let context = { brand_context: null, condition_context: null };

  for (const line of lines) {
    const isSectionHeader = /\b(?:rolex|patek|ap|rm|vc|used|new|stock)\b/i.test(line) 
                          && !/\b\d{4,6}[A-Z]{0,4}\b/i.test(line) 
                          && line.length < 60;
                          
    if (isSectionHeader) {
      currentHeader = line;
      context = parseContext(line);
      continue;
    }

    const refM = line.match(/\b([A-Z]?[0-9]{4,6}[A-Z]{0,4})\b/i);
    if (!refM) continue;

    candidates.push({
      rawLine: currentHeader ? `${currentHeader}\n${line}` : line,
      context: { ...context }
    });
  }
  return candidates;
}

// ── HTTP SUBAPASE INSERTS ────────────────────────────────────

async function insertSupabase(tableName, record, url, key) {
  const resp = await fetch(`${url}/rest/v1/${tableName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Prefer': 'return=representation'
    },
    body: JSON.stringify([record]),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Supabase write to ${tableName} failed: ${err}`);
  }
  const data = await resp.json();
  return data[0];
}

function withoutCatalogColumns(record) {
  const { model: _model, catalog_confirmed: _confirmed, catalog_match: _match, ...legacy } = record;
  return legacy;
}

function isMissingCatalogColumn(error) {
  return /(?:model|catalog_confirmed|catalog_match).*(?:column|schema cache)|(?:column|schema cache).*(?:model|catalog_confirmed|catalog_match)/i
    .test(String(error?.message || ''));
}

// ============================================================
// Single Ingest Logic Flow
// ============================================================

async function processMessage(rawMessage, channelId, source, supabaseUrl, serviceKey, deepseekKey) {
  // Step 1: Save Raw Message
  let rawRecord = {
    raw_text: rawMessage,
    sender_phone: channelId,
    source_platform: source,
    processing_status: 'PROCESSING',
    parser_version: 'v4.0-context',
  };
  
  if (supabaseUrl && serviceKey) {
    try {
      rawRecord = await insertSupabase('raw_messages', rawRecord, supabaseUrl, serviceKey);
    } catch (e) {
      console.error('[JASS-5] Raw message save failed:', e.message);
    }
  }

  const results = [];
  const segmented = segmentDealerMessage(rawMessage);
  const candidates = segmented.length > 0
    ? segmented
    : [{ rawLine: rawMessage, context: {}, prices: extractPriceObservations(rawMessage, {}) }];

  for (const cand of candidates) {
    // Step 2: Parse watch candidate locally via JASS-5 State-Machine
    let parsed = parseJass5(cand.rawLine, cand.context, cand.reference || null);

    // Hit LLM fallback if local regex is low confidence
    if (parsed.confidence < 70 && parsed.ref && deepseekKey) {
      try {
        const llm = await llmEnrich(cand.rawLine, parsed, deepseekKey);
        if (llm.brand && llm.brand !== 'Unknown') parsed.brand = llm.brand;
        
          if (llm.reference) parsed.ref = llm.reference;
          
          let finalBrandLower = (parsed.brand || '').toLowerCase();
          if (finalBrandLower === 'richard mille' || finalBrandLower === 'rm') {
              if (parsed.ref) {
                  const rmMatch = parsed.ref.match(/^(RM\s*\d{2,3}(?:-\d{2})?)/i);
                  if (rmMatch) parsed.ref = rmMatch[1].toUpperCase().replace(/\s+/, '');
              }
          }
          if (finalBrandLower === 'zenith') {
              const zMatch = cand.rawLine.match(/\b(\d{2}\.\d{4}\.\d{3,4}\/\d{2}\.[A-Z0-9]+)\b/i);
              if (zMatch) parsed.ref = zMatch[1].toUpperCase();
          }

        if (llm.dialColor) parsed.dial = llm.dialColor;
        if (llm.material) parsed.material = llm.material;
        if (llm.bracelet) parsed.bracelet = llm.bracelet;
        if (llm.bezel) parsed.bezel = llm.bezel;
        if (llm.condition) parsed.condition = llm.condition;
        if (llm.setStatus) parsed.set_status = llm.setStatus;
        if (llm.year) parsed.year = llm.year;
        parsed.confidence = Math.max(parsed.confidence, parseInt(llm.confidence) || 0);
      } catch (e) {
        console.error('[JASS-5 Ingest] LLM fallback error:', e.message);
      }
    }

    const catalogConfirmation = confirmCatalogCandidate({
      brand: parsed.brand,
      reference: parsed.ref,
      dial_color: parsed.dial,
    });
    const catalogReviewRequired = !catalogConfirmation.confirmed
      || !catalogConfirmation.match?.model
      || (parsed.dial && catalogConfirmation.dialConfirmed !== true);
    parsed.model = catalogConfirmation.confirmed
      ? (catalogConfirmation.match?.model || null)
      : null;

    // Prepare JASS-5 structures
    const listingId = `list_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const primaryPrice = parsed.prices?.find(price => price.is_primary) || parsed.prices?.[0] || null;
    const normalizedListing = {
      id: listingId,
      brand: parsed.brand,
      reference: parsed.ref,
      model: parsed.model,
      dial_color: parsed.dial,
      condition: parsed.condition,
      year: parsed.year,
      price_raw: primaryPrice?.amount_original || null,
      price_usd: primaryPrice?.amount_usd || null,
      currency: primaryPrice?.currency_original || null,
      confidence: parsed.confidence,
      verdict: catalogReviewRequired ? 'MUST_REVIEW' : parsed.approval_state,
      source,
      raw_message: cand.rawLine,
      parser_version: 'v4.0-context',
      listing_type: cand.context.intent_context || 'WTS',
      listing_status: cand.context.listing_status_context || 'ACTIVE',
      processed_at: new Date().toISOString(),
      flags: {
        raw_message_id: rawRecord.id || null,
        set_status: parsed.set_status || null,
        catalog_status: catalogConfirmation.reason,
      },
      catalog_confirmed: catalogConfirmation.confirmed && Boolean(catalogConfirmation.match?.model),
      catalog_match: catalogConfirmation.match || {},
      review_reason: [...new Set([
        ...(parsed.review_reasons || []),
        ...(catalogReviewRequired
          ? [catalogConfirmation.dialReason || catalogConfirmation.reason || 'CATALOG_REVIEW_REQUIRED']
          : []),
      ])].join(',') || null,
    };

    if (supabaseUrl && serviceKey) {
      try {
        // Ingest into watch_records table
        try {
          await insertSupabase('watch_records', normalizedListing, supabaseUrl, serviceKey);
        } catch (error) {
          if (!isMissingCatalogColumn(error)) throw error;
          // Expand-before-deploy compatibility: preserve the source event if a
          // frontend deploy briefly precedes the additive database migration.
          // The row remains MUST_REVIEW and claims no persisted confirmation.
          await insertSupabase('watch_records', withoutCatalogColumns(normalizedListing), supabaseUrl, serviceKey);
        }

        // Ingest related prices
        if (parsed.prices && parsed.prices.length > 0) {
          for (const pr of parsed.prices) {
            await insertSupabase('listing_prices', {
              listing_id: listingId,
              price_type: pr.price_type,
              amount_original: pr.amount_original,
              currency_original: pr.currency_original,
              amount_usd: pr.amount_usd,
              is_primary: pr.is_primary,
              raw_price_text: pr.raw_price_text,
              confidence: pr.confidence,
              currency_evidence: pr.currency_evidence || null,
              discount_percent: pr.discount_percent || null,
              retail_price: pr.retail_price || null,
            }, supabaseUrl, serviceKey);
          }
        }

        // Ingest Assertions
        if (parsed.assertions && parsed.assertions.length > 0) {
          for (const ass of parsed.assertions) {
            await insertSupabase('listing_field_assertions', {
              listing_id: listingId,
              field_name: ass.field_name,
              raw_value: ass.raw_value == null ? null : String(ass.raw_value),
              normalized_value: ass.normalized_value == null ? null : String(ass.normalized_value),
              confidence: ass.confidence,
              source_method: ass.source_method
            }, supabaseUrl, serviceKey);
          }
        }
      } catch (dbErr) {
        console.error('[JASS-5 Ingest] DB Inserts failed:', dbErr.message);
      }
    }

    results.push({
      id: listingId,
      verdict: parsed.approval_state,
      brand: parsed.brand,
      reference: parsed.ref,
      confidence: parsed.confidence,
      catalog_status: parsed.catalog_status,
      prices: parsed.prices,
      listing_type: cand.context.intent_context || 'WTS',
    });
  }

  // Update original raw message status
  if (supabaseUrl && serviceKey && rawRecord.id) {
    try {
      await fetch(`${supabaseUrl}/rest/v1/raw_messages?id=eq.${rawRecord.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`
        },
        body: JSON.stringify({ processing_status: 'DONE' }),
      });
    } catch {}
  }

  return results;
}

// ============================================================
// Main API Router Handler
// ============================================================

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabaseUrl = process.env.SUPABASE_URL;
  // Supabase now labels newly-created server keys as "secret" keys. Keep the
  // established variable name working while supporting the current dashboard
  // convention. Neither value is ever returned to a client.
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const serviceKey = serviceRoleKey || secretKey;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  const deepseekKey = process.env.DEEPSEEK_API_KEY;

  if (req.method === 'GET') {
    const readKey = serviceKey || publishableKey;
    if (!supabaseUrl || !readKey) {
      return res.status(200).json({
        count: 0,
        total: 0,
        records: [],
        status: 'supabase_not_configured',
      });
    }
    try {
      const requestedPage = Number.parseInt(String(req.query?.page || '1'), 10);
      const requestedPageSize = Number.parseInt(String(req.query?.pageSize || '50'), 10);
      const page = Number.isFinite(requestedPage) ? Math.max(requestedPage, 1) : 1;
      const pageSize = Number.isFinite(requestedPageSize)
        ? Math.min(Math.max(requestedPageSize, 10), 100)
        : 50;
      const listingType = String(req.query?.type || '').toUpperCase();
      const itemType = String(req.query?.item || '').toLowerCase();
      const search = String(req.query?.q || '').trim().slice(0, 100);
      const quality = String(req.query?.quality || 'market').toLowerCase();
      const pagination = String(req.query?.pagination || '').toLowerCase();
      const cursorMode = pagination === 'cursor';
      const cursorValue = String(req.query?.cursor || '').trim();
      const cursor = cursorValue ? decodeTradingCursor(cursorValue) : null;
      if (cursorValue && !cursor) return res.status(400).json({ error: 'Invalid pagination cursor' });
      const condition = String(req.query?.condition || '').trim().slice(0, 30).replace(/[(),.%*]/g, ' ');
      const region = String(req.query?.region || '').trim().slice(0, 50).replace(/[(),.%*]/g, ' ');
      const requestedBrand = String(req.query?.brand || '').trim().slice(0, 80).replace(/[(),.%*]/g, ' ');
      const imagesOnly = String(req.query?.images || '').toLowerCase() === 'true';
      const allowedTypes = new Set(['WTS', 'WTB', 'NTQ', 'OTHER']);
      const allowedItems = new Set(['all', 'watches', 'jewelry', 'handbags', 'accessories', 'other', 'luxury']);
      // Both server-key and publishable-key reads use the same customer-safe
      // database view so publication rules cannot drift by deployment mode.
      // Main inventory is intentionally stricter than the archive: incomplete
      // watch identity and implausible WTS prices remain reviewable in the full
      // archive but cannot consume customer-market page slots or totals.
      // The deadline release is always canonical-identity verified. An
      // environment omission must not reopen the legacy publication path.
      const strictVerifiedPublication = true;
      const candidatePageSize = strictVerifiedPublication
        ? Math.min(pageSize * 10, 500)
        : pageSize;
      const start = cursorMode ? 0 : (page - 1) * candidatePageSize;
      const end = start + candidatePageSize - (cursorMode ? 0 : 1);
      const tableName = strictVerifiedPublication
        ? quality === 'archive'
          ? 'trading_floor_listings'
          : 'trading_floor_market_listings'
        : imagesOnly
          ? 'trading_floor_verified_listings'
          : quality === 'archive'
          ? 'trading_floor_listings'
          : 'trading_floor_market_listings';
      const params = new URLSearchParams({
        // Keep this response marketplace-safe even when a server key is used.
        // Media is loaded separately for only the visible IDs. Projecting the
        // verified-thumbnail functions across an ordered/count query makes the
        // strict view evaluate media for thousands of rows before LIMIT.
        select: 'id,brand,reference,price_usd,price_raw,currency,dial_color,condition,year,verdict,listing_type,source,source_type,listing_date,listing_status,created_at,confidence,region',
        // This matches the production created_at DESC index. NULLS LAST needs a
        // dedicated index before it can be enabled safely on millions of rows.
        order: cursorMode ? 'created_at.desc,id.desc' : 'created_at.desc',
      });

      if (listingType && !allowedTypes.has(listingType)) {
        return res.status(400).json({ error: 'Unsupported public listing type' });
      }
      if (itemType && !allowedItems.has(itemType)) {
        return res.status(400).json({ error: 'Unsupported public inventory filter' });
      }
      if (itemType && !['all', 'watches'].includes(itemType) && listingType) {
        return res.status(400).json({ error: 'Intent filtering is unavailable for unnormalized luxury records' });
      }
      if (requestedBrand && !isPublicationBrandAllowed(requestedBrand)) {
        return res.status(400).json({ error: 'Brand is not included in this release' });
      }
      if (strictVerifiedPublication) {
        if (!serviceKey) {
          return res.status(503).json({ error: 'Strict publication requires server-side verification' });
        }
        const strictPage = await loadStrictCursorPage({
          supabaseUrl,
          readKey: serviceKey,
          cursor,
          page,
          pageSize,
          listingType,
          itemType,
          requestedBrand,
          condition,
          region,
          search,
          imagesOnly,
        });
        return res.status(200).json(strictPage);
      }

      // NTQ is historical buyer-intent shorthand. Customer-facing WTB must
      // include both values so every "looking for / want to buy" request is
      // found in one demand view while the stored source classification stays
      // unchanged for auditability.
      if (listingType === 'WTB') params.set('listing_type', 'in.(WTB,NTQ)');
      else if (allowedTypes.has(listingType)) params.set('listing_type', `eq.${listingType}`);
      if (!listingType && itemType === 'luxury') params.set('listing_type', 'eq.OTHER');
      if (!listingType && itemType === 'jewelry') {
        params.set('listing_type', 'eq.OTHER');
        params.set('source_type', 'eq.jewelry_archive');
      }
      if (!listingType && itemType === 'handbags') {
        params.set('listing_type', 'eq.OTHER');
        params.set('source_type', 'in.(handbag_archive,handbags_archive,bag_archive)');
      }
      if (!listingType && itemType === 'accessories') {
        params.set('listing_type', 'eq.OTHER');
        params.set('source_type', 'in.(accessory_archive,accessories_archive)');
      }
      if (!listingType && itemType === 'other') {
        params.set('listing_type', 'eq.OTHER');
        params.set('source_type', 'not.in.(jewelry_archive,handbag_archive,handbags_archive,bag_archive,accessory_archive,accessories_archive)');
      }
      if (!listingType && itemType === 'watches') params.set('listing_type', 'in.(WTS,WTB,NTQ)');
      if (!listingType && itemType === 'all') params.set('listing_type', 'in.(WTS,WTB,NTQ,OTHER)');
      if (imagesOnly) params.set('has_images', 'eq.true');
      if (condition) params.set('condition', `ilike.${condition}`);
      if (region) params.set('region', `ilike.*${region}*`);
      if (requestedBrand) params.set('brand', `eq.${requestedBrand}`);
      else {
        const releaseBrandFilter = publicationBrandPostgrestFilter();
        if (releaseBrandFilter) params.set('brand', releaseBrandFilter);
      }
      const releaseReferenceFilter = publicationReferencePostgrestFilter();
      if (!search && releaseReferenceFilter) params.set('reference', releaseReferenceFilter);
      // Customer-facing inventory never includes RECYCLE records. The recent
      // view avoids letting undated legacy imports dominate page one, while the
      // all-inventory view and every explicit search still include those rows.
      // Price Research applies its own stricter approved/comparable-data policy.
      params.set('verdict', 'eq.APPROVED');
      params.set('confidence', 'gte.90');
      // Supabase preview bootstrap rows are useful for deployment checks, but
      // must never be presented as dealer inventory in a customer environment.
      params.set('id', 'not.like.preview_demo_*');
      const cursorFilter = tradingCursorFilter(cursor);
      if (cursorFilter) params.set('and', `(${cursorFilter})`);
      if (quality !== 'archive' && !search) {
        params.set('created_at', 'not.is.null');
      }
      if (search) {
        const escapedSearch = search.replace(/[(),.]/g, ' ').replace(/%/g, '').replace(/\*/g, '').trim();
        if (escapedSearch) {
          // Reference lookups are the dominant workflow and must use the btree
          // equality index. Broad wildcard scans across millions of rows caused
          // database statement timeouts. Brand lookup remains exact but
          // case-insensitive; full-text message search belongs in a dedicated
          // indexed search service/RPC.
          const parsedSearch = parseTradingSearch(search);
          if (parsedSearch.reference) {
            const configuredReferences = publicationReferences();
            const referenceConfigured = configuredReferences.some(entry =>
              entry.reference.toUpperCase() === String(parsedSearch.reference || '').trim().toUpperCase()
              && (!requestedBrand || entry.brand.toLowerCase() === requestedBrand.toLowerCase()));
            if (!referenceConfigured) {
              return res.status(400).json({ error: 'Reference is not included in this release' });
            }
            params.set('reference', `eq.${parsedSearch.reference}`);
          }
          if (parsedSearch.brand && !requestedBrand) {
            if (!isPublicationBrandAllowed(parsedSearch.brand)) {
              return res.status(400).json({ error: 'Brand is not included in this release' });
            }
            params.set('brand', `ilike.${parsedSearch.brand}`);
          }
          if (parsedSearch.dial) params.set('dial_color', `ilike.${parsedSearch.dial}`);
        }
      }

      // Pagination and filtering happen in Postgres. The browser should never receive the whole archive.
      const resp = await fetch(
        `${supabaseUrl}/rest/v1/${tableName}?${params.toString()}`,
        {
          headers: {
            'apikey': readKey,
            'Authorization': `Bearer ${readKey}`,
            'Range-Unit': 'items',
            'Range': `${start}-${end}`,
            // Cursor pagination needs only the bounded rows plus one lookahead.
            // Do not count the full verified view on every client page request.
            'Prefer': cursorMode
              ? 'return=representation'
              : search
                ? 'count=planned'
                : 'count=estimated',
          },
        }
      );
      if (!resp.ok) throw new Error(`Supabase returned ${resp.status}`);
      const records = await resp.json();
      const candidateHasMore = cursorMode && Array.isArray(records) && records.length > candidatePageSize;
      const candidateRecords = Array.isArray(records) ? records.slice(0, candidatePageSize) : [];
      const verifiedById = await loadVerifiedPublicListings(
        supabaseUrl,
        readKey,
        candidateRecords.map(row => row.id),
      );
      const repostEvidenceById = await loadRepostEvidenceById(
        supabaseUrl,
        serviceKey || readKey,
        candidateRecords.map(row => row.id),
      );
      const preparedCandidates = candidateRecords
        .map(record => {
          const verified = verifiedById.get(String(record.id));
          const repostEvidence = repostEvidenceById.get(String(record.id));
          const resolved = verified
            ? {
                ...record,
                brand: verified.brand || record.brand,
                reference: verified.reference || record.reference,
                dial_color: verified.dial_color || record.dial_color,
                has_images: verified.has_images,
                thumbnail_url: verified.thumbnail_url,
                image_urls: verified.image_urls,
                dealer_id: repostEvidence?.dealer_id || record.dealer_id || null,
                raw_message: repostEvidence?.raw_message || null,
              }
            : {
                ...record,
                dealer_id: repostEvidence?.dealer_id || record.dealer_id || null,
                raw_message: repostEvidence?.raw_message || null,
              };
          const normalized = normalizeMarketRow(
            resolved,
            listEquivalentReferences(resolved.reference, resolved.brand),
          );
          const priceVerified = resolved.listing_type === 'WTS'
            && normalized.analytics_currency_status === 'VERIFIED'
            && Number.isFinite(Number(normalized.analytics_price_usd))
            && Number(normalized.analytics_price_usd) > 0;
          const customerResolved = {
            ...resolved,
            price_usd: priceVerified ? normalized.analytics_price_usd : null,
            price_raw: null,
            currency: priceVerified ? 'USD' : null,
          };
          return {
            resolved: customerResolved,
            verified,
            verifiedImages: Boolean(verified?.has_images),
            priceEvidenceRequired: resolved.listing_type === 'WTS' && !priceVerified,
            priceEvidenceStatus: resolved.listing_type === 'WTS'
              ? normalized.analytics_currency_status
              : null,
          };
        })
        .filter(({ resolved, verified }) =>
          Boolean(verified)
          && isReleaseListingEligible(resolved)
          && isCustomerIdentitySafe(resolved));
      const customerCandidates = deduplicateTradingItems(preparedCandidates)
        .map(({ resolved, verifiedImages, priceEvidenceRequired, priceEvidenceStatus }) => {
          const { dealer_id: _dealerId, raw_message: _rawMessage, ...publicResolved } = resolved;
          const customerRecord = sanitizeTradingRecord(publicResolved, { verifiedImages });
          if (!priceEvidenceRequired) {
            return { ...customerRecord, price_evidence_status: priceEvidenceStatus };
          }
          return {
            ...customerRecord,
            data_quality_issues: [...new Set([
              ...(customerRecord.data_quality_issues || []),
              priceEvidenceStatus,
            ])],
            data_quality_review_required: true,
            price_evidence_status: priceEvidenceStatus,
          };
        });
      const customerRecords = customerCandidates.slice(0, pageSize);
      const verifiedHasMore = customerCandidates.length > pageSize;
      const hasMore = cursorMode && (verifiedHasMore || candidateHasMore);
      const cursorRecord = verifiedHasMore
        ? customerCandidates[pageSize - 1]
        : candidateRecords[candidateRecords.length - 1];
      const nextCursor = hasMore && cursorRecord ? encodeTradingCursor(cursorRecord) : null;
      const contentRange = resp.headers.get('content-range') || '';
      const total = cursorMode
        ? null
        : Number.parseInt(contentRange.split('/')[1] || '0', 10) || 0;
      return res.status(200).json({
        count: customerRecords.length,
        total,
        page,
        pageSize,
        totalIsEstimate: !cursorMode,
        nextCursor,
        hasMore,
        records: customerRecords,
        status: 'ok',
        publicationBrands: publicationBrands(),
        publicationReferences: publicationReferences().map(entry => ({
          brand: entry.brand || null,
          reference: entry.reference,
        })),
        accessMode: serviceKey ? 'server_key' : 'publishable_read_only',
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireServiceToken(req, res)) return;

  if (!supabaseUrl || !serviceKey) {
    return res.status(503).json({
      error: 'Ingestion requires a Supabase server key',
      status: 'supabase_write_not_configured',
    });
  }

  const body = req.body || {};
  let rawMessage = body.rawMessage;
  let channelId = body.channelId || body.channel_id || 'direct';
  let source = body.source || 'api';

  if (!rawMessage && body.message?.text) {
    rawMessage = body.message.text;
    channelId = String(body.message.chat?.id || 'telegram');
    source = 'telegram';
  }

  if (!rawMessage || typeof rawMessage !== 'string' || rawMessage.trim().length < 5) {
    return res.status(400).json({ error: 'rawMessage required (min 5 characters)' });
  }

  try {
    const results = await processMessage(rawMessage, channelId, source, supabaseUrl, serviceKey, deepseekKey);
    return res.status(200).json({
      success: true,
      messageType: results.length > 1 ? 'MULTI' : 'WTS',
      isMulti: results.length > 1,
      records: results.map(r => ({
        id: r.id,
        verdict: r.verdict,
        brand: r.brand,
        reference: r.reference,
        confidence: r.confidence,
        catalog_status: r.catalog_status,
        prices: r.prices
      })),
    });
  } catch (e) {
    console.error('[JASS-5 Ingest Error]:', e.message);
    return res.status(500).json({ error: e.message });
  }
};

'use strict';

const crypto = require('node:crypto');

const RUN_ID = '17d6d831-86cd-5e67-9830-c881bcf16e0d';
const MARKET_SELECTOR = 'curated_luxury_current_shadow_v1';
const PRICE_SELECTOR = 'curated_luxury_price_research_shadow_v1';
const ROLEX_EVIDENCE_SELECTOR = 'curated_luxury_rolex_evidence_v1';
const CARD_EVIDENCE_SELECTOR = 'curated_luxury_card_evidence_v1';
const BRANDS = new Set(['Rolex', 'Patek Philippe']);

function normalizedReference(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function isShadowBrand(brand) {
  return BRANDS.has(String(brand || '').trim());
}

function rolexEvidenceEnabled() {
  return String(process.env.CURATED_ROLEX_EVIDENCE_SOURCE || '').trim() === ROLEX_EVIDENCE_SELECTOR;
}

function cardEvidenceEnabled() {
  return String(process.env.CURATED_LUXURY_CARD_EVIDENCE_SOURCE || '').trim() === CARD_EVIDENCE_SELECTOR;
}

function normalizedListingLane(value) {
  if (value === 0 || value === 'single') return 0;
  if (value === 1 || value === 'multi') return 1;
  return null;
}

function urlsFromMedia(value, found = new Set()) {
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value)) found.add(value);
    return [...found];
  }
  if (Array.isArray(value)) {
    for (const item of value) urlsFromMedia(item, found);
    return [...found];
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) urlsFromMedia(item, found);
  }
  return [...found];
}

function mapCard(row) {
  // Only the immutable exact-hash child bridge may supply customer images.
  // Raw parent/version media is lineage evidence, never an image fallback.
  const images = row.image_state === 'VERIFIED_CHILD_IMAGE'
    ? urlsFromMedia(row.verified_child_media) : [];
  const restoredRolex = row.brand === 'Rolex' && typeof row.price_display_verified === 'boolean';
  const sourceCurrency = row.source_currency || null;
  const verifiedUsd = row.price_verified === true && Number(row.price_usd) > 0
    ? Number(row.price_usd) : null;
  const sourceIdentityName = row.source_poster_name || null;
  const sourceAmount = Number(row.source_price_amount) > 0 ? Number(row.source_price_amount) : null;
  return {
    id: row.id,
    brand: row.brand,
    model: row.model || null,
    model_evidence_type: row.model_evidence_type || null,
    model_requires_review: !row.model,
    reference: row.reference || null,
    price_usd: verifiedUsd,
    workbook_price_usd: null,
    // USD remains the only primary customer price. Preserve the exact source
    // amount/currency as secondary evidence and in the immutable raw message.
    price_raw: sourceAmount,
    currency: verifiedUsd === null ? null : 'USD',
    source_price_amount: sourceAmount,
    source_currency: sourceCurrency,
    price_evidence_status: verifiedUsd === null ? null
      : row.price_evidence_classification
        || (['USD', 'USDT'].includes(String(sourceCurrency).toUpperCase())
          ? 'SOURCE_EXPLICIT_USD_MATCH' : 'DATED_VERIFIED_FX'),
    price_display_verified: verifiedUsd !== null
      && (!restoredRolex || row.price_display_verified === true),
    price_requires_review: verifiedUsd === null
      || (restoredRolex && row.price_requires_review === true),
    price_research_eligible: restoredRolex ? row.price_research_eligible === true
      : verifiedUsd !== null && row.listing_type === 'WTS',
    dial_color: row.dial_color || null,
    condition: row.condition || null,
    year: null,
    intent: row.listing_type || null,
    listing_type: row.listing_type || null,
    verdict: 'SOURCE_BACKED_CURRENT',
    source: restoredRolex ? 'CURATED_LUXURY_ROLEX_EVIDENCE_V1' : 'CURATED_LUXURY_SHADOW_V1',
    source_type: 'immutable_raw_observation',
    item_category: 'WATCH',
    listing_date: row.created_at || null,
    listing_status: row.current_status || null,
    current_status: row.current_status || null,
    cohort_status: row.cohort_status || null,
    availability_state: row.current_status || null,
    created_at: row.created_at || null,
    confidence: 0,
    has_images: images.length > 0,
    thumbnail_url: images[0] || null,
    image_url: images[0] || null,
    image_urls: images,
    image_state: images.length ? 'VERIFIED_CHILD_IMAGE' : 'NO_VERIFIED_CHILD_IMAGE',
    image_evidence_type: images.length ? 'SELLER_LISTING_IMAGE' : 'NO_VERIFIED_CHILD_IMAGE',
    image_evidence_label: images.length ? 'Source-supplied listing image' : null,
    region: row.country_code || null,
    location: row.country_code || null,
    seller_country: row.country_code || null,
    raw_message: row.raw_message || null,
    raw_line: row.raw_message || null,
    raw_message_scope: 'original_post',
    raw_message_evidence_type: 'SOURCE_RAW_MESSAGE',
    seller_name: row.dealer_name || sourceIdentityName,
    posted_by: row.dealer_name || sourceIdentityName,
    source_identity_name: sourceIdentityName,
    seller_phone: null,
    contact_publication_approved: row.contact_publication_approved === true,
    seller_rating: row.dealer_rating == null ? null : Number(row.dealer_rating),
    seller_review_count: row.dealer_review_count == null ? null : Number(row.dealer_review_count),
    seller_rating_evidence_status: row.dealer_rating == null ? 'UNAVAILABLE' : 'SOURCE_SUPPLIED',
    dealer_id: row.dealer_id || null,
    dealer_profile_path: row.dealer_slug ? `/dealers/${encodeURIComponent(row.dealer_slug)}` : null,
    data_quality_issues: [
      ...(!row.model ? ['MODEL_REQUIRES_REVIEW'] : []),
      ...(!row.dealer_name && !sourceIdentityName ? ['POSTER_REQUIRES_REVIEW'] : []),
      ...(verifiedUsd === null ? ['PRICE_REQUIRES_REVIEW'] : []),
    ],
    data_quality_review_required: !row.model || (!row.dealer_name && !sourceIdentityName) || verifiedUsd === null,
    listing_source_shape: row.listing_source_shape === 'DETERMINISTIC_MULTI_CHILD'
      ? 'DETERMINISTIC_MULTI_CHILD' : 'SINGLE_INPUT',
    multi_listing: false,
    is_unbundled_child: false,
  };
}

function countryCodes(value) {
  const values = (Array.isArray(value) ? value : [value]).flatMap(item => String(item || '').split(','));
  const codes = [...new Set(values.map(item => item.trim().toUpperCase())
    .filter(item => /^[A-Z]{2,3}$/.test(item) || item === '__NO_MATCH__'))];
  return codes.length ? codes : null;
}

function shadowScope(options) {
  const scope = {
    brand: String(options.brand || ''),
    listingType: ['WTS', 'WTB'].includes(options.listingType) ? options.listingType : null,
    countries: countryCodes(options.countries)?.sort() || null,
    pricedOnly: options.pricedOnly === true,
    imagesOnly: options.imagesOnly === true,
    reference: options.reference ? normalizedReference(options.reference) : null,
    search: options.reference ? null : normalizedReference(options.search),
    listingLane: normalizedListingLane(options.listingLane),
    pageSize: Number(options.pageSize),
  };
  return crypto.createHash('sha256').update(JSON.stringify(scope)).digest('hex');
}

function shadowCursorMatches(cursor, options) {
  return !cursor || cursor.scope === shadowScope(options);
}

function encodeShadowCursor({ listingLane, sourceTimestamp, currentListingKey, timestampIsNull, scope, page }) {
  return Buffer.from(JSON.stringify({
    v: 4, p: page, l: normalizedListingLane(listingLane), t: timestampIsNull ? null : sourceTimestamp,
    n: timestampIsNull === true, k: currentListingKey, s: scope,
  })).toString('base64url');
}

async function loadInventory(client, options) {
  const restoredRolex = options.brand === 'Rolex' && rolexEvidenceEnabled();
  const restoredCards = cardEvidenceEnabled() && isShadowBrand(options.brand);
  const intents = ['WTS', 'WTB'].includes(options.listingType) ? [options.listingType] : null;
  const countries = countryCodes(options.countries);
  const args = {
    p_run_id: RUN_ID,
    p_brands: [options.brand],
    p_intents: intents,
    p_countries: countries,
    p_priced_only: options.pricedOnly === true,
    p_images_only: options.imagesOnly === true,
    p_search: options.reference ? null : (options.search || null),
    p_reference_key: options.reference ? normalizedReference(options.reference) : null,
  };
  const cursor = options.cursor || null;
  if (!shadowCursorMatches(cursor, options)) throw new Error('Shadow cursor scope mismatch');
  const firstPage = !cursor;
  const rolexArgs = {
    p_run_id: RUN_ID,
    p_intents: intents,
    p_countries: countries,
    p_priced_only: options.pricedOnly === true,
    p_images_only: options.imagesOnly === true,
    p_search: options.reference ? null : (options.search || null),
    p_reference_key: options.reference ? normalizedReference(options.reference) : null,
  };
  const cardArgs = { ...rolexArgs, p_brand: options.brand };
  const pageRequest = client.rpc(restoredCards ? 'curated_luxury_shadow_customer_page_keys_v8'
    : 'curated_luxury_shadow_customer_page_keys_v7', {
    ...rolexArgs,
    p_brand: options.brand,
    p_listing_lane: normalizedListingLane(options.listingLane),
    p_after_lane: normalizedListingLane(cursor?.listingLane),
    p_after_timestamp: cursor?.sourceTimestamp || null,
    p_after_key: cursor?.currentListingKey || null,
    p_after_timestamp_is_null: cursor?.timestampIsNull === true,
    p_limit: options.pageSize,
  });
  const countRequest = firstPage
    ? client.rpc(restoredCards ? 'curated_luxury_shadow_customer_count_v4'
      : restoredRolex ? 'curated_luxury_rolex_customer_count_v3'
      : 'curated_luxury_shadow_customer_count_v2', restoredCards ? cardArgs
      : restoredRolex ? rolexArgs : args)
    : Promise.resolve({ data: null, error: null });
  const [{ data: page, error: pageError }, { data: countData, error: countError }] =
    await Promise.all([pageRequest, countRequest]);
  if (pageError) {
    throw new Error(`Curated shadow page selection failed: ${pageError.message || 'unknown database error'}`);
  }
  const listingKeys = Array.isArray(page?.keys) ? page.keys : [];
  const { data: cardData, error: cardError } = listingKeys.length
    ? await client.rpc(restoredCards ? 'curated_luxury_shadow_customer_cards_v5'
      : restoredRolex ? 'curated_luxury_rolex_customer_cards_v4'
      : 'curated_luxury_shadow_customer_cards_v3', {
      p_run_id: RUN_ID, p_listing_keys: listingKeys,
    })
    : { data: [], error: null };
  if (cardError) {
    throw new Error(`Curated shadow card enrichment failed: ${cardError.message || 'unknown database error'}`);
  }
  const rows = Array.isArray(cardData) ? cardData : [];
  const rowsByKey = new Map(rows.map(row => [row.id, row]));
  const orderedRows = listingKeys.map(key => rowsByKey.get(key)).filter(Boolean);
  const keyLanes = page?.key_lanes && typeof page.key_lanes === 'object' ? page.key_lanes : {};
  const exactTotal = countError || countData?.total == null ? null : Number(countData.total);
  const hasMore = page?.has_more === true;
  const scope = shadowScope(options);
  return {
    status: 'ok', count: rows.length, total: exactTotal, page: options.page, pageSize: options.pageSize,
    totalIsEstimate: exactTotal === null,
    totalStatus: exactTotal === null
      ? (firstPage ? 'withheld_after_nonblocking_count_failure' : 'withheld_on_cursor_continuation')
      : `exact_complete_shadow_${countData.source}`,
    hasMore,
    nextCursor: hasMore ? encodeShadowCursor({
      listingLane: page.next_lane,
      sourceTimestamp: page.next_timestamp,
      currentListingKey: page.next_key,
      timestampIsNull: page.next_timestamp_is_null === true,
      scope,
      page: options.page + 1,
    }) : null,
    records: orderedRows.map(row => mapCard({
      ...row,
      listing_source_shape: Number(keyLanes[row.id]) === 1
        ? 'DETERMINISTIC_MULTI_CHILD' : 'SINGLE_INPUT',
    })), publicationBrands: [...BRANDS],
    source: restoredCards ? CARD_EVIDENCE_SELECTOR
      : restoredRolex ? ROLEX_EVIDENCE_SELECTOR : MARKET_SELECTOR, run_id: RUN_ID,
    evidenceContract: {
      identity: 'Source-backed observed identity; catalog enrichment is optional.',
      price: 'Only explicit USD/USDT or verified normalized FX may populate USD analytics.',
      dealer: 'Dealer identity and rating require exact source-backed evidence.',
      availability: 'CONFIRMED_CURRENT and LATEST_OBSERVED remain distinct customer states.',
    },
  };
}

function percentileStats(stats) {
  const count = Number(stats?.count || 0);
  if (!count) return null;
  const q1 = Number(stats.q1);
  const q3 = Number(stats.q3);
  const min = Number(stats.min);
  const max = Number(stats.max);
  const avg = Number(stats.avg);
  const median = Number(stats.median);
  const iqr = q3 - q1;
  return { count, avg, median, min, max, range: max - min, q1, q3, iqr,
    lower_fence: Math.max(0, q1 - (3 * iqr)), upper_fence: q3 + (3 * iqr), iqr_multiplier: 3 };
}

function mapPriceRow(row, brand, reference, options = {}) {
  const images = urlsFromMedia(row.raw_media);
  const usdOnly = options.usdOnly === true;
  return {
    id: row.id, brand, reference, listing_type: 'WTS',
    price_raw: usdOnly ? null : row.source_price_amount == null ? null : Number(row.source_price_amount),
    source_price_amount: usdOnly ? null
      : row.source_price_amount == null ? null : Number(row.source_price_amount),
    source_currency: usdOnly ? null : row.source_currency || null,
    currency: usdOnly ? 'USD' : row.source_currency || null,
    price_usd: Number(row.price_usd), analytics_price_usd: Number(row.price_usd),
    price_evidence_status: String(row.source_currency).toUpperCase() === 'USDT'
      ? 'SOURCE_EXPLICIT_USD_USDT'
      : String(row.source_currency).toUpperCase() === 'USD'
        ? 'SOURCE_EXPLICIT_USD_MATCH' : 'DATED_VERIFIED_FX',
    raw_message: row.raw_message || null, created_at: row.created_at || null,
    listing_date: row.created_at || null, condition: row.condition || null,
    dial_color: row.dial_color || null, region: row.country_code || null,
    current_status: row.current_status || null, cohort_status: row.cohort_status || null,
    thumbnail_url: images[0] || null, image_url: images[0] || null, image_urls: images,
    has_images: images.length > 0,
    source: usdOnly ? 'CURATED_LUXURY_ROLEX_EVIDENCE_V1' : 'CURATED_LUXURY_SHADOW_V1',
  };
}

async function loadPriceResearch(client, { brand, reference, evidencePage = 1, evidencePageSize = 100 }) {
  const referenceKey = normalizedReference(reference);
  const restoredRolex = brand === 'Rolex' && rolexEvidenceEnabled();
  const restoredCards = cardEvidenceEnabled() && isShadowBrand(brand);
  const { data, error } = await client.rpc(restoredCards
    ? 'curated_luxury_shadow_price_research_v3'
    : restoredRolex
    ? 'curated_luxury_rolex_price_research_v2'
    : 'curated_luxury_shadow_price_research', restoredCards ? {
    p_run_id: RUN_ID, p_brand: brand, p_reference_key: referenceKey,
    p_limit: evidencePageSize, p_offset: (evidencePage - 1) * evidencePageSize,
  } : restoredRolex ? {
    p_run_id: RUN_ID, p_reference_key: referenceKey,
    p_limit: evidencePageSize, p_offset: (evidencePage - 1) * evidencePageSize,
  } : {
    p_run_id: RUN_ID, p_brand: brand, p_reference_key: referenceKey,
    p_limit: evidencePageSize, p_offset: (evidencePage - 1) * evidencePageSize,
  });
  if (error) throw error;
  const rawRows = Array.isArray(data?.rows) ? data.rows : [];
  const rows = rawRows.map(row => mapPriceRow(row, brand, reference, { usdOnly: true }));
  const stats = percentileStats(data?.stats);
  const total = Number(data?.stats?.count || 0);
  const wtb = Number(data?.wtb_count || 0);
  const reposts = Number(data?.stats?.repost_count || 0);
  return {
    success: true, brand, reference, resolvedRef: null, model: null, collection: null, dialColors: null,
    analytics_source: restoredCards ? CARD_EVIDENCE_SELECTOR
      : restoredRolex ? ROLEX_EVIDENCE_SELECTOR : PRICE_SELECTOR,
    total_tracked_listings: total + wtb,
    wts_eligible_analytics_count: total, wtb_demand_count: wtb,
    reference_qualified_wts_count: total, reference_analytics_ready: total >= 2,
    demand_scope: 'EXACT_REFERENCE_ALL_DIALS', demand_rows: [],
    excluded_count: 0, excluded_breakdown: { unpriced: 0, outliers: 0, unsplit_bundles: 0 },
    reconciliation: { total_tracked_listings: total + wtb, wts_eligible_analytics_count: total,
      wtb_demand_count: wtb, reference_qualified_wts_count: total, excluded_count: 0,
      wts_loaded_count: total, excluded_breakdown: { unpriced: 0, outliers: 0, unsplit_bundles: 0 } },
    totalListings: total, reference_listing_count: total, eligible_observation_count: total,
    unique_offer_count: total, repost_count: reposts, sampledListings: rows.length,
    sampleCapped: rows.length < total, count: rows.length, rawCount: total,
    outliersRemoved: 0, excludedEvidenceCount: 0, retained_evidence_count: total,
    analytics_ready: total >= 2, sample_quality: total >= 20 ? 'robust' : total >= 2 ? 'provisional' : 'observational',
    selected_cohort: { condition: 'All conditions', dial_color: 'Unspecified', count: total },
    cohorts: [], dial_groups: [], dial_analysis: [], stats, liquidity: {
      source: 'live_fallback', listing_count: total, eligible_observation_count: total,
      unique_offer_count: total, repost_count: reposts, demand_count: wtb,
    }, monthly: [], prices: rows.map(row => row.price_usd), rows, retained_rows: rows,
    outlier_rows: [], evidence: { comparable_returned: rows.length, comparable_total: total,
      comparable_page: evidencePage, comparable_page_size: evidencePageSize,
      comparable_pages: Math.max(1, Math.ceil(total / evidencePageSize)), retained_returned: rows.length,
      retained_total: total, retained_pages: Math.max(1, Math.ceil(total / evidencePageSize)),
      outliers_returned: 0, outliers_total: 0, truncated: rows.length < total },
    methodology: { method: 'IQR_3_0', minimum_sample: 2, included_count: total,
      excluded_count: 0, formula: 'Q1 - 3.0×IQR to Q3 + 3.0×IQR', iqr_multiplier: 3,
      repost_excluded_count: reposts, unsplit_bundle_excluded_count: 0,
      lower_fence: stats?.lower_fence ?? null, upper_fence: stats?.upper_fence ?? null },
    source: restoredCards ? CARD_EVIDENCE_SELECTOR
      : restoredRolex ? ROLEX_EVIDENCE_SELECTOR : PRICE_SELECTOR, run_id: RUN_ID,
  };
}

module.exports = { BRANDS, CARD_EVIDENCE_SELECTOR, MARKET_SELECTOR, PRICE_SELECTOR, ROLEX_EVIDENCE_SELECTOR, RUN_ID,
  cardEvidenceEnabled, countryCodes, isShadowBrand, normalizedListingLane, rolexEvidenceEnabled,
  encodeShadowCursor, loadInventory, loadPriceResearch, mapCard, normalizedReference,
  shadowCursorMatches, shadowScope, urlsFromMedia };

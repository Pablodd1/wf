'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const api = require('../api/reviewed-market-inventory.js');

test('QNSA Trading Floor does not depend on legacy workbook checkpoints', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../api/reviewed-market-inventory.js'),
    'utf8',
  );
  assert.match(source, /async function loadQnsaReviewedReleaseSummary\(client\)/);
  assert.match(source, /MARKET_SOURCE_VIEW === 'qnsa_rolex_patek_trading_floor_source'/);
  assert.match(source, /loadQnsaReviewedReleaseSummary\(client\)/);
});

test('QNSA pages use indexed brand/reference predicates and no-image lane', () => {
  assert.match(source, /queryParams\.set\('normalized_reference', `in\.\(\$\{exactVariants\.join\(','\)\}\)`\)/);
  assert.match(source, /qnsaUnpartitionedMedia[\s\S]*!imagesOnly/);
  assert.match(source, /if \(!qnsaUnpartitionedMedia\)[\s\S]*has_exact_source_image/);
  assert.match(source, /if \(brand\) queryParams\.set\('brand_scope', `eq\.\$\{brand\}`\)/);
  assert.match(source, /const qnsaBrandScanLimit = pageSize \+ 1/);
  assert.match(source, /rest\/v1\/rpc\/qnsa_market_feed_page_rows/);
  assert.match(source, /pageRowsRes\.json\(\)[\s\S]*row\.row_data/);
  assert.match(source, /\? 'created_at\.desc,id\.desc'/);
  assert.match(source, /normalized_reference', `like\.\$\{familyPrefix\}\*`/);
});

test('general QNSA market feed bounds pages and joins immutable evidence', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260812110000_qnsa_general_market_feed.sql'), 'utf8');
  assert.match(migration, /WITH eligible AS MATERIALIZED/);
  assert.match(migration, /JOIN staging\.listings l ON l\.id = e\.id/);
  assert.match(migration, /p_brand IS NULL OR l\.brand_normalized = p_brand/);
  assert.match(migration, /p_listing_type text DEFAULT NULL/);
  assert.match(migration, /p_listing_type IS NULL OR upper/);
  assert.match(migration, /upper\(COALESCE\(l\.category, ''\)\) = ANY\(v_categories\)/);
  assert.match(source, /p_brand: brand \|\| null/);
  assert.match(source, /p_category: itemCategory === 'ALL' \? null : itemCategory/);
});

test('same-reference Trading Floor listings preserve the global image boundary before price', () => {
  const priced = {
    id: 'priced', brand: 'Patek Philippe', reference: '5712/1A-001',
    source_price_amount: 92000, has_images: false, listing_date: '2026-01-01',
  };
  const unpriced = {
    id: 'unpriced', brand: 'Patek Philippe', reference: '5712/1A-001',
    source_price_amount: null, has_images: true, listing_date: '2026-08-01',
  };
  const records = [unpriced, priced].sort(api.compareInventoryForDisplay);
  assert.deepEqual(records.map(record => record.id), ['unpriced', 'priced']);
  assert.equal(api.hasUsableSourcePrice(priced), 92000);
  assert.equal(api.hasUsableSourcePrice(unpriced), null);
  assert.deepEqual(api.summarizeCoverage([
    { ...priced, evidence_coverage: { identity: { complete: true }, contact: { available: false }, image: { available: false }, price: { analytics_eligible: true } } },
    { ...unpriced, evidence_coverage: { identity: { complete: true }, contact: { available: true }, image: { available: true }, price: { analytics_eligible: false } } },
  ]), {
    scope: 'returned_page', record_count: 2, identity_complete: 2, contact_available: 1,
    exact_source_image: 1, supplied_price: 1, price_not_supplied: 1, price_analytics_eligible: 1,
  });
});

test('a count-snapshot failure does not take the bounded customer feed offline', () => {
  assert.match(source, /QNSA count snapshot unavailable/);
  assert.match(source, /const marketCounts = Array\.isArray\(data\) \? data : \[\]/);
  assert.match(source, /count_snapshot_available: !error/);
  assert.doesNotMatch(source, /if \(error\) throw error;\s*const marketCounts/);
});

test('broad pages bypass the reference-scoped FX sidecar', () => {
  const broadStart = source.indexOf('if (qnsaBroadPage && !legacyMarketViewContractDetected)');
  const broadBlock = source.slice(
    broadStart,
    source.indexOf('const pageRows =', broadStart),
  );
  assert.match(broadBlock, /qnsa_market_feed_page_rows/);
  assert.doesNotMatch(broadBlock, /qnsa_three_brand_fx_trading_floor_rows/);
});

test('customer inventory does not wait for the optional global count snapshot', () => {
  const requestBlock = source.slice(
    source.indexOf('const summaryPromise ='),
    source.indexOf('const brand = requestedBrand'),
  );
  assert.match(requestBlock, /Promise\.resolve\(unavailableQnsaReleaseSummary\(\)\)/);
  assert.doesNotMatch(requestBlock, /loadQnsaReviewedReleaseSummary\(client\)/);
});

test('Trading Floor source view is allowlisted and defaults to the legacy source', () => {
  assert.equal(api.MARKET_SOURCE_VIEW, 'reviewed_workbook_market_source_v2');
  const sourceText = fs.readFileSync(
    path.join(__dirname, '../api/reviewed-market-inventory.js'),
    'utf8',
  );
  assert.match(sourceText, /TRADING_FLOOR_SOURCE_VIEW/);
  assert.match(sourceText, /qnsa_rolex_patek_trading_floor_source/);
  assert.match(sourceText, /ALLOWED_MARKET_SOURCE_VIEWS\.has\(requestedMarketSourceView\)/);
  assert.match(sourceText, /rest\/v1\/\$\{MARKET_SOURCE_VIEW\}/);
});

test('authenticated form submissions map into the Trading Floor contract', () => {
  const record = api.mapDealerSubmission({
    id: 'submission-1', intent: 'WTS', category: 'WATCH', raw_message: 'WTS Rolex 124060 USD 11000',
    claimed_fields: { brand: 'Rolex', model: 'Submariner', reference: '124060', dial_color: 'Black', price_amount: 11000, currency: 'USD', poster_name: 'Daisy', poster_phone: '+17860000000', location: 'Miami', dealer_rating: 4.8, review_count: 12, group_count: 3, credential_status: 'VERIFIED' },
    image_urls: ['https://example.com/rolex.jpg'], poster_image_url: 'https://example.com/daisy.jpg',
    review_status: 'APPROVED', publication_status: 'PUBLISHED', created_at: '2026-08-06T12:00:00Z',
  });
  assert.equal(record.source_type, 'authenticated_user_form');
  assert.equal(record.price_research_eligible, true);
  assert.equal(record.thumbnail_url, 'https://example.com/rolex.jpg');
  assert.equal(record.seller_avatar_url, 'https://example.com/daisy.jpg');
  assert.equal(record.seller_rating, 4.8);
  assert.equal(record.seller_review_count, 12);
  assert.equal(record.seller_rating_evidence_status, 'SOURCE_SUPPLIED');
  assert.equal(record.seller_group_count, 3);
  assert.equal(record.location, 'Miami');
});

test('reviewed inventory cards inherit exact public Rated Dealer feedback evidence', () => {
  const record = api.mapReviewedRecord({
    id: 'rated-source-listing', supplied_brand: 'Rolex', model: 'Daytona',
    normalized_reference: '116500LN', raw_reference: '116500LN', dial_color: 'Black',
    listing_type: 'WTS', raw_message: 'WTS Rolex 116500LN USD 28000',
    posted_by: 'Federico Maman', phone_number: '+1 (305) 988-8263',
    contact_publication_approved: true, source_price_amount: 28000, source_currency: 'USD',
    has_exact_source_image: false,
  });
  assert.equal(record.seller_rating, null);
  assert.equal(record.seller_review_count, 22);
  assert.equal(record.seller_rating_evidence_status, 'SOURCE_FEEDBACK_COUNT');
  assert.equal(record.seller_trust_status, 'Trusted User');
  assert.equal(api.isSourceBackedRatedDealer(record), true);
});

test('reviewed direct submissions support category, intent, image, price, and location filters together', () => {
  const record = api.mapDealerSubmission({
    id: 'bag-1', intent: 'WTS', category: 'HANDBAG', raw_message: 'WTS Birkin 30 USD 25000',
    claimed_fields: { title: 'Birkin 30', price_amount: 25000, currency: 'USD', location: 'Miami, US', poster_name: 'Dealer' },
    image_urls: ['https://example.com/bag.jpg'], review_status: 'APPROVED', publication_status: 'PUBLISHED', created_at: '2026-08-09T12:00:00Z',
  });
  assert.equal(api.directSubmissionMatches(record, { itemCategory: 'HANDBAG', listingType: 'WTS', imagesOnly: true, pricedOnly: true, region: 'Miami, US' }), true);
  assert.equal(api.directSubmissionMatches(record, { itemCategory: 'JEWELRY' }), false);
  assert.equal(api.directSubmissionMatches(record, { search: 'MIAMI' }), true);
  assert.equal(api.directSubmissionMatches(record, { region: 'miami' }), true);
});

test('location filters are case-insensitive and preserve punctuation boundaries', () => {
  assert.equal(api.locationSearchPattern(' Miami, US '), '*Miami*US*');
  assert.equal(api.locationMatches('Miami, US', 'miami'), true);
  assert.equal(api.locationMatches('New York, United States', 'NEW YORK'), true);
  assert.equal(api.locationMatches('Hong Kong', 'Miami'), false);
});

test('free-text search is case-insensitive and matches all terms without requiring adjacency', () => {
  const record = {
    brand: 'Patek Philippe',
    model: 'Nautilus',
    reference: '5712/1A-001',
    seller_name: 'Pierre Duchateau',
    raw_message: 'WTS Patek Philippe Nautilus blue dial 5712/1A-001',
  };
  assert.equal(api.searchTermsMatch(record, 'pAtEk 5712'), true);
  assert.equal(api.searchTermsMatch(record, 'PIERRE nautilus'), true);
  assert.equal(api.searchTermsMatch(record, 'patek rolex'), false);
  assert.equal(api.searchTermsMatch({ ...record, raw_message: `${record.raw_message} full set 2018` }, 'black nautilus full-set 2018'), false);
  assert.equal(api.searchTermsMatch({ ...record, raw_message: `${record.raw_message} full set 2018` }, 'blue nautilus full-set 2018'), true);

  const legacyParams = api.buildLegacyMarketQueryParams({
    pageSize: 50,
    requestedReference: '5712',
    exactDialVariants: [],
    search: 'pAtEk 5712',
  });
  assert.equal(legacyParams.get('or'), null);
  assert.equal(legacyParams.get('normalized_reference'), 'in.(5712)');
});

test('reviewed records expose only supplied location and suppress bundle child media', () => {
  const mapped = api.mapReviewedRecord(record({
    parent_id: 'bundle-parent',
    location: 'Miami, US',
    user_image_url: 'https://example.com/group.jpg',
    has_exact_source_image: true,
  }));
  assert.equal(mapped.location, 'Miami, US');
  assert.equal(mapped.is_unbundled_child, true);
  assert.equal(mapped.has_images, false);
  assert.equal(mapped.thumbnail_url, null);
  assert.deepEqual(mapped.image_urls, []);
});

test('direct submissions cannot cross the global image boundary', () => {
  assert.equal(api.directSubmissionMatchesImageLane({ has_images: true }, 'images'), true);
  assert.equal(api.directSubmissionMatchesImageLane({ has_images: false }, 'images'), false);
  assert.equal(api.directSubmissionMatchesImageLane({ has_images: false }, 'no-images'), true);
  assert.equal(api.directSubmissionMatchesImageLane({ has_images: true }, 'no-images'), false);
});

test('rated filtering requires source-backed rating and review evidence', () => {
  const rated = { seller_rating: 4.8, seller_review_count: 12, seller_rating_evidence_status: 'SOURCE_SUPPLIED' };
  const feedbackRated = { seller_rating: null, seller_review_count: 22, seller_rating_evidence_status: 'SOURCE_FEEDBACK_COUNT' };
  assert.equal(api.isSourceBackedRatedDealer(rated), true);
  assert.equal(api.isSourceBackedRatedDealer(feedbackRated), true);
  assert.equal(api.isSourceBackedRatedDealer({ seller_rating: 5, seller_review_count: 0, seller_rating_evidence_status: 'SOURCE_SUPPLIED' }), false);
  assert.equal(api.isSourceBackedRatedDealer({ seller_rating: 5, seller_review_count: 50, seller_rating_evidence_status: 'UNAVAILABLE' }), false);
  assert.equal(api.ratingMatches(rated, 'rated'), true);
  assert.equal(api.ratingMatches(feedbackRated, 'rated'), true);
  assert.equal(api.ratingMatches(rated, 'unrated'), false);
  assert.equal(api.ratingMatches({ seller_rating: null, seller_review_count: 0, seller_rating_evidence_status: 'UNAVAILABLE' }, 'unrated'), true);
});

test('rated and unrated direct submission filters use the mapped evidence contract', () => {
  const rated = api.mapDealerSubmission({
    id: 'rated-1', intent: 'WTS', category: 'WATCH', raw_message: 'WTS Rolex 116500LN USD 30000',
    claimed_fields: { brand: 'Rolex', model: 'Daytona', reference: '116500LN', dial_color: 'Black', dealer_rating: 4.9, review_count: 22 },
    image_urls: [], review_status: 'APPROVED', publication_status: 'PUBLISHED', created_at: '2026-08-11T00:00:00Z',
  });
  assert.equal(api.directSubmissionMatches(rated, { rating: 'rated' }), true);
  assert.equal(api.directSubmissionMatches(rated, { rating: 'unrated' }), false);
});

test('date windows produce deterministic inclusive lower bounds', () => {
  const now = new Date('2026-08-11T12:00:00.000Z');
  assert.equal(api.dateWindowStart('1D', now), '2026-08-10T12:00:00.000Z');
  assert.equal(api.dateWindowStart('7D', now), '2026-08-04T12:00:00.000Z');
  assert.equal(api.dateWindowStart('1M', now), '2026-07-12T12:00:00.000Z');
  assert.equal(api.dateWindowStart('invalid', now), null);
});

test('only reconciled Rolex, Patek, and Audemars Piguet pending-review singles enter the Trading Floor', () => {
  const pending = {
    item_category: 'WATCH', listing_type: 'WTS', trading_floor_status: 'published_pending_verification',
    publication_lane: 'QNSA_NORMALIZED_STAGING_V1', normalization_run_complete: true,
    raw_lineage_verified: true, publication_state: 'PENDING_VERIFICATION',
  };
  assert.equal(api.isTradingFloorSourceRow({ ...pending, canonical_brand: 'Rolex' }), true);
  assert.equal(api.isTradingFloorSourceRow({ ...pending, canonical_brand: 'Patek Philippe' }), true);
  assert.equal(api.isTradingFloorSourceRow({ ...pending, canonical_brand: 'Audemars Piguet' }), true);
  assert.equal(api.isTradingFloorSourceRow({ ...pending, canonical_brand: 'Omega' }), false);
  assert.equal(api.isTradingFloorSourceRow({ ...pending, canonical_brand: 'Rolex', raw_lineage_verified: false }), false);
});

test('reviewed QNSA release rows and source-backed ratings reach the card contract', () => {
  assert.match(source, /'QNSA_ROLEX_PATEK_REVIEWED_V1', 'QNSA_GENERAL_MARKET_FEED_V1'/);
  assert.match(source, /\['APPROVED', 'PENDING_VERIFICATION'\]\.includes\(row\?\.publication_state\)/);
  assert.match(source, /reviewedQnsaRelease \|\|/);
  assert.match(source, /seller_rating: ratingEvidenceStatus === 'SOURCE_SUPPLIED' \? directRating : null/);
  assert.match(source, /ratedDealerEvidence/);
  assert.match(source, /raw_lineage_verified,dealer_rating,review_count/);
});

test('pending publication keeps customer copy neutral without loosening price eligibility', () => {
  const mapped = api.mapReviewedRecord(record({
    verdict: 'HUMAN_REVIEW', verification_status: 'HUMAN_REVIEW',
    trading_floor_status: 'published_pending_verification', publication_state: 'PENDING_VERIFICATION',
    has_verified_usd_price: false, verified_price_usd: null,
  }));
  assert.equal(mapped.data_quality_review_required, true);
  assert.equal(mapped.verification_label, 'Listing');
  assert.equal(mapped.price_research_eligible, false);
});
const source = fs.readFileSync(
  path.join(__dirname, '../api/reviewed-market-inventory.js'),
  'utf8',
);
const migration = fs.readFileSync(
  path.join(__dirname, '../supabase/migrations/20260731180000_reviewed_workbook_evidence_order.sql'),
  'utf8',
);
const priceOrderMigration = fs.readFileSync(
  path.join(__dirname, '../supabase/migrations/20260802170000_reviewed_workbook_price_first_indexes.sql'),
  'utf8',
);
const priceEvidenceOrderMigration = fs.readFileSync(
  path.join(__dirname, '../supabase/migrations/20260802173000_reviewed_workbook_price_evidence_order.sql'),
  'utf8',
);
const priceEvidenceIndexMatchMigration = fs.readFileSync(
  path.join(__dirname, '../supabase/migrations/20260802180000_reviewed_workbook_price_evidence_index_match.sql'),
  'utf8',
);
const workflow = fs.readFileSync(
  path.join(__dirname, '../.github/workflows/reviewed-workbook-inventory-release.yml'),
  'utf8',
);

test('parses a combined exact-reference and dial search into indexed filters', () => {
  assert.match(source, /parseTradingSearch\(search\)/);
  assert.match(source, /req\.query\?\.reference \|\| parsedSearch\.reference/);
  assert.match(source, /const requestedBrand = cleanExactText\(req\.query\?\.brand, 80\)/);
  assert.match(source, /genericSearch && !genericSearch\.includes\(' '\) && !requestedReference && !requestedDial/);
  assert.match(source, /filter\(record => !search \|\| searchTermsMatch\(record, search\)\)/);
  assert.match(source, /queryParams\.set\('dial_color'/);
});

function record(overrides = {}) {
  return {
    id: 'workbook_1',
    source_file: 'Rolex all 1.xlsx',
    source_row_number: 2,
    source_record_id: 'auction_1',
    posting_date: '2026-07-01T00:00:00.000Z',
    posted_by: 'Dealer One',
    phone_number: '+15550100',
    contact_publication_approved: true,
    raw_message: 'Rolex 126500LN white USD 30,000',
    listing_type: 'WTS',
    item_category: 'WATCH',
    brand_scope: 'Rolex',
    supplied_brand: 'Rolex',
    canonical_brand: 'Rolex',
    model: 'Daytona',
    catalog_model: null,
    raw_reference: '126500LN',
    normalized_reference: '126500LN',
    catalog_reference: null,
    dial_color: 'White',
    catalog_dial: null,
    condition: 'Used',
    workbook_price_usd: '30000',
    source_price_amount: '30000',
    source_price_text: 'USD 30,000',
    source_currency: 'USD',
    price_evidence_status: 'SOURCE_EXPLICIT_USD_MATCH',
    confidence: 100,
    verification_status: 'Reviewed',
    user_image_url: 'https://images.example.test/original.jpg',
    has_exact_source_image: true,
    has_verified_usd_price: true,
    verified_price_usd: '30000',
    reference_search_key: '126500LN',
    public_reference: '126500LN',
    reference_is_price_token: false,
    has_complete_identity: true,
    imported_at: '2026-07-31T00:00:00.000Z',
    ...overrides,
  };
}

test('maps exact reviewed evidence to the Trading Floor-compatible contract', () => {
  const mapped = api.mapReviewedRecord(record({
    model: 'Owner-reviewed Daytona',
    catalog_model: 'Catalog Daytona',
    normalized_reference: '126500LN',
    catalog_reference: '126500LN-CATALOG',
    dial_color: 'Owner-reviewed White',
    catalog_dial: 'Catalog White',
  }));
  assert.equal(mapped.brand, 'Rolex');
  assert.equal(mapped.model, 'Owner-reviewed Daytona');
  assert.equal(mapped.reference, '126500LN');
  assert.equal(mapped.reference_search_key, '126500LN');
  assert.equal(mapped.dial_color, 'Owner-reviewed White');
  assert.equal(mapped.price_usd, 30000);
  assert.equal(mapped.price_raw, 30000);
  assert.equal(mapped.currency, 'USD');
  assert.equal(mapped.seller_name, 'Dealer One');
  assert.equal(mapped.seller_phone, '+15550100');
  assert.equal(mapped.has_images, true);
  assert.equal(mapped.thumbnail_url, 'https://images.example.test/original.jpg');
  assert.deepEqual(mapped.image_urls, ['https://images.example.test/original.jpg']);
  assert.equal(mapped.evidence_coverage.identity.complete, true);
  assert.equal(mapped.evidence_coverage.contact.available, true);
  assert.equal(mapped.evidence_coverage.image.provenance, 'EXACT_SOURCE_URL');
  assert.equal(mapped.evidence_coverage.price.analytics_eligible, true);
});

test('labels generated workbook text as a summary rather than an original post', () => {
  const generated = api.mapReviewedRecord(record({ raw_message: 'WTS Rolex 126500LN White 30000.00' }));
  assert.equal(generated.raw_message_scope, 'normalized_summary');
  assert.equal(generated.raw_message_evidence_type, 'WORKBOOK_NORMALIZED_SUMMARY');
  const generatedWithoutSourcePrice = api.mapReviewedRecord(record({
    raw_message: 'WTS Rolex 126500LN White 30000.00',
    source_price_amount: null,
  }));
  assert.equal(generatedWithoutSourcePrice.raw_message_scope, 'normalized_summary');
  assert.equal(generatedWithoutSourcePrice.raw_message_evidence_type, 'WORKBOOK_NORMALIZED_SUMMARY');
  const recovered = api.mapReviewedRecord(record({
    raw_message: 'NTQ - 5821/1a green',
    listing_type: 'WTB',
    model: 'Cubitus',
    raw_reference: '5821/1a',
    normalized_reference: '5821/1A',
    source_price_amount: null,
  }));
  assert.equal(recovered.raw_message_scope, 'stored_source_message');
  assert.equal(recovered.raw_message_evidence_type, 'SOURCE_RAW_MESSAGE');
});

test('removes the entire image contract when no exact supplied image exists', () => {
  const mapped = api.mapReviewedRecord(record({
    user_image_url: null,
    has_exact_source_image: false,
    catalog_image_url: 'https://catalog.example.test/reference.jpg',
    display_image_url: 'https://catalog.example.test/reference.jpg',
  }));
  assert.equal(mapped.has_images, false);
  assert.equal(mapped.thumbnail_url, null);
  assert.deepEqual(mapped.image_urls, []);
  assert.equal(mapped.image_evidence_type, 'NO_IMAGE');
  assert.doesNotMatch(JSON.stringify(mapped), /catalog\.example\.test/);
});

test('preserves a database-qualified legacy HTTP image token in the image lane', () => {
  const mapped = api.mapReviewedRecord(record({
    has_exact_source_image: true,
    user_image_url: 'https://example.com/listings/legacy%object.jpg',
  }));
  assert.equal(mapped.has_images, true);
  assert.equal(mapped.thumbnail_url, 'https://example.com/listings/legacy%object.jpg');
});

test('customer image copy contains no internal review-process labels', () => {
  const mapped = api.mapReviewedRecord(record());
  assert.equal(mapped.image_evidence_label, 'Source-supplied listing image');
  assert.equal(mapped.image_evidence_notice, 'Exact image URL supplied with this source listing.');
  assert.doesNotMatch(mapped.image_evidence_notice, /review/i);
});

test('never promotes unresolved workbook USD values into verified USD price', () => {
  const mapped = api.mapReviewedRecord(record({
    workbook_price_usd: '38461',
    source_price_amount: '300000',
    source_price_text: 'HKD 300,000',
    source_currency: 'HKD',
    price_evidence_status: 'DATED_FX_PROVENANCE_REQUIRED',
    has_verified_usd_price: false,
    verified_price_usd: null,
  }));
  assert.equal(mapped.price_usd, null);
  assert.equal(mapped.price_raw, 300000);
  assert.equal(mapped.currency, 'HKD');
  assert.equal(mapped.workbook_price_usd, 38461);
  assert.equal(mapped.price_research_eligible, false);
});

test('Trading Floor prefers a qualified corrected USD price and retains original source evidence', () => {
  const mapped = api.mapReviewedRecord({
    id: 'corrected-1', supplied_brand: 'Patek Philippe', model: 'Nautilus',
    normalized_reference: '5712/1A', dial_color: 'Blue', listing_type: 'WTS',
    source_price_amount: 305000, source_currency: 'HKD',
    verified_price_usd: null, has_verified_usd_price: false,
    corrected_price_usd: 39102, corrected_source_amount: 305000,
    corrected_source_currency: 'HKD', corrected_fx_rate: 0.128203,
    corrected_fx_source: 'ECB_REFERENCE_RATES', corrected_fx_date: '2026-08-11',
    price_correction_status: 'QUALIFIED', price_correction_id: 'sidecar-row-2',
    price_correction_key: 'three-brand-v1', confidence: 100, verdict: 'APPROVED',
  });
  assert.equal(mapped.price_usd, 39102);
  assert.equal(mapped.price_raw, 305000);
  assert.equal(mapped.currency, 'HKD');
  assert.equal(mapped.price_correction_applied, true);
  assert.equal(mapped.price_research_eligible, true);
});

test('holds implausible workbook-only amounts for review instead of displaying them as USD', () => {
  const mapped = api.mapReviewedRecord(record({
    workbook_price_usd: '25000000000',
    source_price_amount: null,
    source_price_text: null,
    source_currency: null,
    price_evidence_status: 'CURRENCY_AMBIGUOUS_OR_MISSING',
    has_verified_usd_price: false,
    verified_price_usd: null,
  }));
  assert.equal(mapped.workbook_price_usd, 25000000000);
  assert.equal(mapped.workbook_price_review_reason, 'WORKBOOK_PRICE_ABOVE_PUBLIC_PLAUSIBILITY');
  assert.equal(mapped.price_usd, null);
  assert.equal(mapped.price_research_eligible, false);
});

test('reference punctuation variants share one exact key without changing display reference', () => {
  assert.equal(api.referenceComparisonKey('5712/1A'), '57121A');
  assert.equal(api.referenceComparisonKey('5712-1A'), '57121A');
  assert.equal(api.referenceComparisonKey('57121A'), '57121A');
  assert.equal(api.referenceComparisonKey('5712'), '5712');
  const mapped = api.mapReviewedRecord(record({
    raw_reference: '5712/1A',
    normalized_reference: '57121A',
    public_reference: '57121A',
    reference_search_key: '57121A',
  }));
  assert.equal(mapped.reference, '5712/1A');
  assert.equal(mapped.reference_search_key, '57121A');
  assert.match(source, /queryParams\.set\('reference_search_key', `eq\.\$\{reference\}`\)/);
});

test('fails closed when a price and currency token contaminates the reference', () => {
  assert.equal(api.referenceIsPriceToken('470000USDT', 470000, 'USDT'), true);
  assert.equal(api.referenceIsPriceToken('USDT470000', 470000, 'USDT'), true);
  assert.equal(api.referenceIsPriceToken('000USD', null, null), true);
  assert.equal(api.referenceIsPriceToken('5712/1A', 470000, 'USDT'), false);
  assert.equal(api.referenceIsPriceToken('116500LN', 30000, 'USD'), false);

  const mapped = api.mapReviewedRecord(record({
    raw_message: 'Patek Philippe watch 470000 USDT',
    normalized_reference: '470000USDT',
    raw_reference: '470000USDT',
    public_reference: null,
    reference_search_key: null,
    reference_is_price_token: true,
    has_complete_identity: false,
    source_price_amount: '470000',
    source_price_text: '470000 USDT',
    source_currency: 'USDT',
    workbook_price_usd: '470000',
    verified_price_usd: '470000',
  }));

  assert.equal(mapped.reference, null);
  assert.equal(mapped.reference_search_key, null);
  assert.equal(mapped.raw_reference, '470000USDT');
  assert.equal(mapped.normalized_reference, '470000USDT');
  assert.equal(mapped.reference_invalid_reason, 'PRICE_CURRENCY_TOKEN');
  assert.equal(mapped.has_complete_identity, false);
  assert.equal(mapped.price_usd, 470000);
  assert.equal(mapped.price_research_eligible, false);
  assert.equal(mapped.evidence_coverage.identity.complete, false);
  assert.equal(mapped.evidence_coverage.identity.invalid_reference_reason, 'PRICE_CURRENCY_TOKEN');
  assert.equal(mapped.evidence_coverage.price.analytics_eligible, false);
});

test('verified USD remains ineligible until every identity field is present', () => {
  for (const overrides of [
    { model: null, catalog_model: null },
    { dial_color: null, catalog_dial: null },
  ]) {
    const mapped = api.mapReviewedRecord(record({
      ...overrides,
      has_complete_identity: false,
    }));
    assert.equal(mapped.price_usd, 30000);
    assert.equal(mapped.has_complete_identity, false);
    assert.equal(mapped.price_research_eligible, false);
    assert.equal(mapped.evidence_coverage.price.analytics_eligible, false);
  }
});

test('coverage summary is page-bounded and reconciles evidence flags', () => {
  const complete = api.mapReviewedRecord(record());
  const incomplete = api.mapReviewedRecord(record({
    id: 'workbook_2',
    model: null,
    catalog_model: null,
    phone_number: null,
    contact_publication_approved: false,
    user_image_url: null,
    has_exact_source_image: false,
    price_evidence_status: 'CURRENCY_AMBIGUOUS_OR_MISSING',
    has_verified_usd_price: false,
    verified_price_usd: null,
  }));
  assert.deepEqual(api.summarizeCoverage([complete, incomplete]), {
    scope: 'returned_page',
    record_count: 2,
    identity_complete: 1,
    contact_available: 1,
    exact_source_image: 1,
    supplied_price: 2,
    price_not_supplied: 0,
    price_analytics_eligible: 1,
  });
});

test('publishes seller identity but keeps contact consent-gated', () => {
  const mapped = api.mapReviewedRecord(record({ contact_publication_approved: false }));
  assert.equal(mapped.seller_name, 'Dealer One');
  assert.equal(mapped.seller_phone, null);
  assert.equal(mapped.contact_publication_approved, false);
});

test('supports numeric and base64url page cursors', () => {
  assert.equal(api.parseCursorPage('2'), 2);
  assert.equal(api.parseCursorPage(Buffer.from('177755').toString('base64url')), 177755);
  assert.equal(api.parseCursorPage('0'), null);
  assert.equal(api.parseCursorPage('bad-token'), null);
});

test('inventory cursors preserve the global image boundary without a full-view sort', () => {
  assert.deepEqual(api.parseInventoryCursor('', 24), { lane: 'images', offset: 0, page: 1 });
  const token = api.encodeInventoryCursor({ lane: 'no-images', offset: 17, page: 8 });
  assert.deepEqual(api.parseInventoryCursor(token, 24), {
    lane: 'no-images', offset: 17, page: 8,
  });
  assert.equal(api.parseInventoryCursor('not-a-cursor', 24), null);
});

test('scoped pages use one lookahead row instead of trusting estimated totals', () => {
  const rows = Array.from({ length: 25 }, (_, index) => ({ id: `workbook_${index}` }));
  const page = api.boundedPage(rows, 24, true);
  assert.equal(page.records.length, 24);
  assert.equal(page.hasLookahead, true);
  assert.deepEqual(api.boundedPage(rows.slice(0, 8), 24, true), {
    records: rows.slice(0, 8),
    hasLookahead: false,
  });
  assert.match(source, /const qnsaBrandScanLimit = pageSize \+ 1/);
  assert.match(source, /queryParams\.set\('limit', String\(qnsaBrandScanLimit\)\)/);
  assert.match(source, /lastReturnedSourceIndex/);
  assert.match(source, /const nextCursor = hasMore[\s\S]*encodeInventoryCursor/);
});

test('cursor inventory honors the 50-card marketplace page and overlaps independent database reads', () => {
  assert.match(source, /const pageSizeLimit = pagination === 'cursor' \? 50 : MAX_PAGE_SIZE/);
  assert.match(source, /const summaryPromise = MARKET_SOURCE_VIEW === 'qnsa_rolex_patek_trading_floor_source'/);
  assert.match(source, /\? Promise\.resolve\(unavailableQnsaReleaseSummary\(\)\)/);
  assert.match(source, /: loadSummary\(client\)/);
  assert.match(source, /directRowsPromise = Promise\.resolve\(directQuery\)/);
  assert.match(source, /await directRowsPromise/);
  assert.match(source, /const summary = await summaryPromise/);
});

test('publication brands are derived from populated reviewed checkpoints', () => {
  assert.deepEqual(api.publicationBrandsFromSummary({ brands: [
    { brand: 'Rolex', canonical_listings: 10 },
    { brand: 'Patek Philippe', canonical_listings: 4 },
    { brand: 'Empty', canonical_listings: 0 },
  ] }), ['Rolex', 'Patek Philippe']);
});

test('public brand filters preserve punctuation and use only supported exact snapshot totals', () => {
  assert.match(source, /const requestedBrand = cleanExactText\(req\.query\?\.brand, 80\)/);
  assert.match(source, /const brand = requestedBrand/);
  assert.match(source, /snapshotInventoryTotal\(summary/);
  assert.match(source, /'withheld_for_unsupported_filter'/);
  assert.match(source, /'available_from_market_feed_counts'/);
  assert.doesNotMatch(source, /const preciseCount = Boolean\(reference\)/);
  assert.doesNotMatch(source, /const total = summaryTotal/);
});

test('endpoint is read-only and globally ranks verified source images before pagination', () => {
  assert.match(source, /rest\/v1\/\$\{MARKET_SOURCE_VIEW\}/);
  assert.match(source, /: 'reviewed_workbook_market_source_v2'/);
  assert.doesNotMatch(source, /\.from\(['"]watch_records['"]\)/);
  assert.doesNotMatch(source, /\.(?:insert|upsert|update|delete)\s*\(/);
  assert.match(source, /has_complete_identity/);
  assert.match(source, /MULTIPLE_LISTING_IDENTITY_VALUES/);
  assert.match(source, /MARKET_SOURCE_VIEW !== 'qnsa_rolex_patek_trading_floor_source'[\s\S]*trading_floor_status', 'not\.in\.\(bundle_child_pending_review,bundle_pending_separation,suppressed_exact_duplicate\)'/);
  // ponytail: images-first ORDER BY was reverted — it causes a Postgres
  // statement timeout on the unindexed view. Assert the proven indexed order:
  // price evidence primary, images as tiebreaker, newest last.
  assert.match(source, /queryParams\.set\('has_exact_source_image', requestedLane === 'images' \? 'eq\.true' : 'eq\.false'\)/);
  assert.match(source, /queryParams\.set\('order', MARKET_SOURCE_VIEW === 'qnsa_rolex_patek_trading_floor_source'/);
  assert.match(source, /\? 'created_at\.desc,id\.desc'[\s\S]*: 'id\.desc'/);
  assert.match(source, /Fill the final image page from the no-image lane/);
  assert.match(source, /pageResult\.records\.filter\(isTradingFloorSourceRow\)/);
  assert.match(source, /usedLegacyViewContract \? isLegacyReviewedInventoryRecord\(record\) : true/);
  assert.doesNotMatch(source, /order\('workbook_price_usd'/);
  assert.doesNotMatch(source, /order\('source_price_amount'/);
  assert.doesNotMatch(source, /order\('has_complete_identity'/);
  assert.doesNotMatch(source, /catalog_image_url|final_image_url|display_image_url/);
  assert.match(source, /buildLegacyMarketQueryParams/);
  assert.match(source, /legacyMarketViewContractDetected/);
  assert.match(source, /42703\|does not exist/);
});

test('legacy production view fallback preserves exact reference families and bounded indexed reads', () => {
  const params = api.buildLegacyMarketQueryParams({
    pageSize: 24,
    offset: 0,
    imageLane: 'images',
    brand: 'Patek Philippe',
    requestedReference: '5712/1A-001',
    exactDialVariants: [],
    listingType: 'WTS',
    imagesOnly: true,
    pricedOnly: false,
    search: 'Patek Philippe 5712/1A-001',
  });
  assert.equal(params.get('brand_scope'), 'eq.Patek Philippe');
  assert.match(params.get('normalized_reference'), /5712\/1A-001/);
  assert.match(params.get('normalized_reference'), /5712\/1A/);
  assert.equal(params.get('has_exact_source_image'), 'eq.true');
  assert.equal(params.get('order'), 'id.desc');
  assert.equal(params.get('limit'), '25');
});

test('legacy reviewed evidence accepts explicit confirmed review labels but rejects quarantine states', () => {
  assert.equal(api.isLegacyReviewedInventoryRecord({ confidence: 0.95, listing_status: 'CATALOG_AND_RAW_REFERENCE_CONFIRMED' }), true);
  assert.equal(api.isLegacyReviewedInventoryRecord({ confidence: 95, listing_status: 'IMAGE_CONFIRMED_MODEL' }), true);
  assert.equal(api.isLegacyReviewedInventoryRecord({ confidence: 89, listing_status: 'IMAGE_CONFIRMED_MODEL' }), false);
  assert.equal(api.isLegacyReviewedInventoryRecord({ brand: 'Rolex', reference: '116500LN', confidence: 72, listing_status: 'HUMAN_REVIEW' }), true);
  assert.equal(api.isLegacyReviewedInventoryRecord({ brand: 'Patek Philippe', reference: '5712/1A-001', confidence: null, listing_status: 'NEEDS_REVIEW' }), true);
  assert.equal(api.isLegacyReviewedInventoryRecord({ brand: 'Patek Philippe', reference: '5712/1A-001', confidence: 72, listing_status: 'BUNDLE_PENDING_SEPARATION' }), false);
  assert.equal(api.isLegacyReviewedInventoryRecord({ confidence: 100, listing_status: 'bundle_child_pending_review' }), false);
  assert.equal(api.isLegacyReviewedInventoryRecord({ confidence: 100, listing_status: 'REJECTED' }), false);
});

test('price-first indexes cover global, intent, brand, and brand-intent floor orders', () => {
  assert.doesNotMatch(priceOrderMigration, /\bBEGIN\b|\bCOMMIT\b/i);
  assert.match(priceOrderMigration, /CREATE INDEX CONCURRENTLY IF NOT EXISTS[\s\S]*idx_reviewed_workbook_inventory_price_first/);
  assert.match(priceOrderMigration, /idx_reviewed_workbook_inventory_type_price_first[\s\S]*listing_type,[\s\S]*workbook_price_usd DESC NULLS LAST/);
  assert.match(priceOrderMigration, /idx_reviewed_workbook_inventory_brand_price_first[\s\S]*brand_scope,[\s\S]*workbook_price_usd DESC NULLS LAST/);
  assert.match(priceOrderMigration, /idx_reviewed_workbook_inventory_brand_type_price_first[\s\S]*brand_scope,[\s\S]*listing_type,[\s\S]*workbook_price_usd DESC NULLS LAST/);
  assert.match(workflow, /20260802170000_reviewed_workbook_price_first_indexes\.sql/);
});

test('evidence-aware indexes never rank ambiguous workbook amounts as verified USD', () => {
  assert.doesNotMatch(priceEvidenceOrderMigration, /\bBEGIN\b|\bCOMMIT\b/i);
  assert.match(priceEvidenceOrderMigration, /reviewed_workbook_market_source_v2[\s\S]*has_supplied_price/);
  assert.match(priceEvidenceOrderMigration, /idx_reviewed_workbook_market_price_evidence_order/);
  assert.match(priceEvidenceOrderMigration, /idx_reviewed_workbook_market_type_price_evidence_order[\s\S]*listing_type/);
  assert.match(priceEvidenceOrderMigration, /SOURCE_EXPLICIT_USD_MATCH[\s\S]*workbook_price_usd/);
  assert.match(priceEvidenceOrderMigration, /DROP INDEX CONCURRENTLY IF EXISTS[\s\S]*idx_reviewed_workbook_inventory_price_first/);
  assert.match(workflow, /20260802173000_reviewed_workbook_price_evidence_order\.sql/);
  assert.match(workflow, /to_regclass\('public\.reviewed_workbook_market_source_v2'\)/);
});

test('production order indexes exactly match the inlined supplied-price view expression', () => {
  assert.doesNotMatch(priceEvidenceIndexMatchMigration, /\bBEGIN\b|\bCOMMIT\b/i);
  assert.match(priceEvidenceIndexMatchMigration, /idx_reviewed_workbook_market_price_evidence_order_v2/);
  assert.match(priceEvidenceIndexMatchMigration, /idx_reviewed_workbook_market_type_price_evidence_order_v2[\s\S]*listing_type/);
  assert.match(priceEvidenceIndexMatchMigration, /COALESCE\([\s\S]*workbook_price_usd > 0 OR source_price_amount > 0,[\s\S]*false[\s\S]*\)\s*\) DESC/);
  assert.doesNotMatch(priceEvidenceIndexMatchMigration, /COALESCE\(workbook_price_usd > 0, false\)[\s\S]*OR COALESCE\(source_price_amount > 0, false\)/);
  assert.match(priceEvidenceIndexMatchMigration, /ANALYZE public\.reviewed_workbook_inventory/);
  assert.match(workflow, /20260802180000_reviewed_workbook_price_evidence_index_match\.sql/);
  assert.match(workflow, /idx_reviewed_workbook_market_price_evidence_order_v2/);
});

test('service-only evidence view keeps strict identity while reusing v1 indexes', () => {
  assert.match(migration, /CREATE OR REPLACE VIEW public\.reviewed_workbook_market_source[\s\S]*security_invoker = true/);
  assert.match(migration, /REVOKE ALL ON public\.reviewed_workbook_market_source[\s\S]*PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT SELECT ON public\.reviewed_workbook_market_source TO service_role/);
  assert.match(migration, /reviewed_workbook_reference_is_price_token_v2[\s\S]*USD\|USDT\|HKD/);
  assert.match(migration, /reviewed_workbook_identity_complete_v2[\s\S]*p_brand[\s\S]*p_model[\s\S]*p_reference[\s\S]*p_dial/);
  assert.match(migration, /reference_search_key[\s\S]*public_reference[\s\S]*reference_is_price_token[\s\S]*has_complete_identity/);
  assert.match(migration, /regexp_replace\([\s\S]*upper\(COALESCE\(inventory\.normalized_reference, ''\)\)[\s\S]*AS reference_search_key/);
  assert.doesNotMatch(migration, /CREATE INDEX CONCURRENTLY/);
  assert.match(migration, /DROP INDEX CONCURRENTLY IF EXISTS public\.idx_reviewed_workbook_market_evidence_order_v2;/);
  assert.match(migration, /DROP INDEX CONCURRENTLY IF EXISTS public\.idx_reviewed_workbook_market_reference_evidence_order_v2;/);
  assert.doesNotMatch(migration, /DROP INDEX CONCURRENTLY IF EXISTS public\.idx_reviewed_workbook_market_evidence_order;/);
  assert.match(migration, /price_evidence_status = 'SOURCE_EXPLICIT_USD_MATCH'[\s\S]*workbook_price_usd > 0/);
  assert.doesNotMatch(migration, /\bBEGIN\b|\bCOMMIT\b/i);
  assert.match(workflow, /20260731180000_reviewed_workbook_evidence_order\.sql/);
  assert.match(workflow, /idx_reviewed_workbook_market_reference_evidence_order'/);
  assert.doesNotMatch(workflow, /idx_reviewed_workbook_market_reference_evidence_order_v2/);
  assert.match(workflow, /timeout-minutes: 30/);
  assert.match(workflow, /to_regprocedure\('public\.reviewed_workbook_identity_complete_v2\(text,text,text,text,numeric,text\)'\)/);
  assert.match(workflow, /to_regclass\('public\.reviewed_workbook_market_source'\)/);
});

test('standalone listing type is indexed while condition remains narrowly guarded', () => {
  assert.match(source, /if \(listingType && !\['WTS', 'WTB', 'OTHER'\]\.includes\(listingType\)\)/);
  assert.match(source, /if \(condition && !\(requestedBrand && reference\)\)/);
  assert.doesNotMatch(source, /if \(\(listingType \|\| condition\)/);
});

test('QNSA broad intent lanes have an expression-matched cold-read index', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '../supabase/migrations/20260812041000_qnsa_intent_feed_index.sql'),
    'utf8',
  );
  assert.match(migration, /brand_normalized/);
  assert.match(migration, /upper\(COALESCE\(listing_type, intent, ''\)\)/);
  assert.match(migration, /created_at DESC/);
  assert.match(migration, /parent_id IS NULL/);
});

test('QNSA exact reference RPC preserves Patek catalog punctuation', () => {
  assert.match(source, /const patekBaseEquivalent[\s\S]*replace\(\/-001\$\/i, ''\)/);
  assert.match(source, /const rpcReference = familyReference[\s\S]*patekBaseEquivalent/);
  assert.match(source, /reference: rpcReference, family: Boolean\(familyReference \|\| patekBaseEquivalent\)/);
  assert.match(source, /p_reference: request\.reference/);
  assert.doesNotMatch(source, /p_reference: reference, p_family/);
});

test('QNSA exact reference RPC uses indexed family lookup for AP base references', () => {
  assert.match(source, /const audemarsBaseFamily = normalizedBrand === 'audemars piguet'/);
  assert.match(source, /\^\\d\{5\}\[A-Z\]\{2,4\}\$/);
  assert.match(source, /listCatalogReferences\('Audemars Piguet'\)/);
  assert.match(source, /candidate\.startsWith\(`\$\{audemarsBaseFamily\}\.``?\)/);
  assert.doesNotMatch(source, /candidate === audemarsBaseFamily/);
  assert.match(source, /qnsa_bounded_price_research_rows/);
  assert.match(source, /const apEvidenceReferences = \[audemarsBaseFamily, \.\.\.apExactReferences\]/);
  assert.match(source, /p_references: apEvidenceReferences/);
  assert.match(source, /Promise\.all\(\['WTS', 'WTB'\]\.map/);
  assert.match(source, /publication_lane: 'QNSA_ROLEX_PATEK_REVIEWED_V1'/);
});

test('obvious immutable-raw cross-brand conflicts never reach customer cards', () => {
  assert.equal(api.hasObviousCrossBrandConflict(record({
    canonical_brand: 'Patek Philippe',
    supplied_brand: null,
    brand_scope: null,
    raw_message: 'Vacheron Constantin 3110V full set 16700usd',
  })), true);
  assert.equal(api.hasObviousCrossBrandConflict(record({
    canonical_brand: 'Patek Philippe',
    supplied_brand: null,
    brand_scope: null,
    raw_message: 'Patek Philippe 5712 plus Vacheron trade considered',
  })), false);
});

test('bounded QNSA RPC rows reapply every customer filter before publication', () => {
  assert.match(source, /p_listing_type: listingType \|\| null/);
  assert.match(source, /!listingType \|\| String\(record\.listing_type/);
  assert.match(source, /!imagesOnly \|\| record\.has_images === true/);
  assert.match(source, /!pricedOnly \|\| hasUsableSourcePrice\(record\)/);
  assert.match(source, /!postedAfter \|\| new Date\(record\.listing_date/);
  assert.match(source, /!requestedDial \|\| cleanExactText\(record\.dial_color/);
  assert.match(source, /!condition \|\| cleanExactText\(record\.condition/);
});

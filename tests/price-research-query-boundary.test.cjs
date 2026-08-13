'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'api', 'price-research.js'),
  'utf8',
);

test('high-volume Price Research uses one bounded strict-source query', () => {
  assert.match(source, /let sourceTable = configuredSourceTable \|\| \(!exactReviewedWorkbookRelease/);
  assert.match(source, /\? 'watch_records'\s*: 'price_research_verified_source'/);
  assert.match(source, /const buildRowsQuery = table => \{/);
  assert.match(source, /let query = client\s*\.from\(table\)/);
  assert.match(source, /\.limit\(pageSize\)/);
  assert.match(source, /const sourceSampleCapped = usingReviewedWorkbook/);
  assert.match(source, /sampleCapped: sourceSampleCapped/);
  assert.doesNotMatch(source, /Array\.from\(\{ length: sampleLimit \/ pageSize \}/);
  assert.doesNotMatch(source, /buildRowsQuery\(from, from \+ pageSize - 1\)/);
  assert.match(source, /\.in\('verdict', \['APPROVED', 'approved', \.\.\.HUMAN_REVIEW_VERDICTS\]\)/);
  assert.match(source, /isPriceResearchAdmissionCandidate\(row\)/);
  assert.match(source, /formula: 'Q1 - 3\.0 \* IQR <= price <= Q3 \+ 3\.0 \* IQR'/);
  assert.match(source, /priced_wts_before_plausibility_count: validPriceRows\.length/);
  assert.match(source, /seller_name,seller_phone/);
});

test('QNSA three-brand release sources are explicit and fail closed', () => {
  assert.match(source, /const QNSA_PRICE_RESEARCH_SOURCE = 'qnsa_rolex_patek_price_research_source'/);
  assert.match(source, /const QNSA_WTB_DEMAND_SOURCE = 'qnsa_rolex_patek_wtb_demand_source'/);
  assert.match(source, /process\.env\.PRICE_RESEARCH_SOURCE_VIEW/);
  assert.match(source, /\['rolex', 'patek philippe', 'audemars piguet'\]\.includes\(normalizedBrand\)/);
  assert.match(source, /table !== QNSA_PRICE_RESEARCH_SOURCE/);
  assert.match(source, /sourceTable === QNSA_PRICE_RESEARCH_SOURCE/);
  assert.match(source, /!configuredSourceTable && !exactReviewedWorkbookRelease && !isPublicationBrandAllowed/);
  assert.match(source, /!configuredSourceTable && !exactReviewedWorkbookRelease && !isPublicationReferenceAllowed/);
  assert.match(source, /if \(!configuredSourceTable && \(result\.error/);
  assert.match(source, /QNSA_WTB_DEMAND_SOURCE/);
});

test('QNSA analytics uses the indexed Trading release and skips supplemental dial scans', () => {
  assert.match(source, /sourceTable === QNSA_PRICE_RESEARCH_SOURCE[\s\S]*loadQnsaVerifiedTradingPrices/);
  assert.match(source, /\.eq\('has_verified_usd_price', true\)/);
  assert.match(source, /!usingQnsaReviewedSource[\s\S]*supplementalCatalogDials\.length/);
  assert.match(source, /loadQnsaTradingDemand[\s\S]*\.from\(QNSA_TRADING_SOURCE\)/);
  assert.match(source, /client\.rpc\('qnsa_three_brand_fx_price_research_rows'/);
  assert.match(source, /isMissingRpcError[\s\S]*client\.rpc\('qnsa_bounded_price_research_rows'/);
  assert.match(source, /if \(!familyPrefix\)[\s\S]*loadQnsaPriceRpcRows/);
  const qnsaLoader = source.slice(
    source.indexOf('async function loadQnsaVerifiedTradingPrices'),
    source.indexOf('// Look up a human model name'),
  );
  assert.doesNotMatch(qnsaLoader, /\.order\('posting_date'/);
});

test('verified workbook preload short-circuits redundant legacy lookups', () => {
  assert.match(source, /if \(exactReviewedWorkbookRelease\) \{/);
  assert.match(source, /preloadedReviewedWorkbookRows[\s\S]*\.map\(row => row\.reference\)/);
  assert.match(source, /else if \(preloadedReviewedWorkbookRows\.length\) \{[\s\S]*rows = preloadedReviewedWorkbookRows;/);
});

test('exact catalog references bypass legacy discovery without admitting prefixes', () => {
  assert.match(source, /requestedCatalogHit\.matchType !== 'partial'/);
  assert.match(source, /exactReviewedReleaseReference = isReviewedReleaseReference\(brand, rawRef\)/);
  assert.match(source, /!exactReviewedWorkbookRelease[\s\S]*exactKnownReference[\s\S]*directWatchRecordBrand[\s\S]*\? 'watch_records'/);
  assert.match(source, /else if \(exactKnownReference\) \{[\s\S]*targetRef = exactCatalogReference \? requestedCatalogHit\.reference : rawRef/);
});

test('legacy fallback remains bounded and WTB demand avoids the unindexed workbook lane', () => {
  assert.match(source, /sourceTable = 'watch_records';\s*result = await buildRowsQuery\(sourceTable\)/);
  assert.match(source, /lookupDemand\(\s*client,\s*sourceTable/);
  assert.match(source, /selection,\s*null,\s*familyPrefix/);
  assert.match(source, /usingQnsaReviewedSource && familyPrefix[\s\S]*startsWith\(normRef\(familyPrefix\)\)/);
  assert.match(source, /loadQnsaVerifiedTradingPrices/);
  assert.match(source, /row\.has_verified_usd_price === true && Number\(row\.verified_price_usd\) > 0/);
  assert.match(source, /sourceTable === QNSA_PRICE_RESEARCH_SOURCE && rows\.length === 0[\s\S]*loadQnsaVerifiedTradingPrices/);
  assert.match(source, /usingQnsaReviewedSource && rows\.length === 0[\s\S]*loadQnsaVerifiedTradingPrices/);
  assert.match(source, /if \(Array\.isArray\(preloadedRows\)\)/);
  assert.doesNotMatch(source, /loadReviewedWorkbookDemandRows/);
  assert.doesNotMatch(source, /executeDemandLaneQuery/);
  assert.match(source, /const DEMAND_SAMPLE_LIMIT = 2500/);
  assert.match(source, /loadVerifiedDemandIdentityRows\(client/);
  assert.match(source, /limit: DEMAND_SAMPLE_LIMIT/);
  assert.match(source, /const columns = 'id,brand,model,reference,[^']*listing_status'/);
  assert.doesNotMatch(source, /const columns = '[^']*(?:,phone_number,|,posted_by,|,display_image_url,|,image_url,)[^']*'/);
  assert.doesNotMatch(source, /retainVerifiedIdentityRows/);
  assert.doesNotMatch(source, /\.limit\(5000\)/);
  assert.doesNotMatch(source, /maxWtbCapacity/);
  assert.match(source, /const totalTrackedListings = wtsAccounting\.loaded \+ wtbDemandCount/);
  assert.match(source, /demand_non_watch_excluded_count/);
});

test('WTB demand has an exact-reference partial production index', () => {
  const migration = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20260810054000_watch_records_wtb_reference_lookup.sql',
    ),
    'utf8',
  );
  assert.match(migration, /CREATE INDEX CONCURRENTLY IF NOT EXISTS/);
  assert.match(migration, /idx_watch_records_wtb_reference_lookup/);
  assert.match(migration, /ON public\.watch_records[\s\S]*brand,[\s\S]*reference,[\s\S]*id DESC/);
  assert.match(migration, /WHERE listing_type IN \('WTB', 'NTQ'\)/);
  assert.doesNotMatch(migration, /UPDATE|DELETE|TRUNCATE|DROP TABLE/i);
});

test('review-first WTB demand has an exact canonical-reference index', () => {
  const migration = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20260810060000_listing_identity_wtb_reference_lookup.sql',
    ),
    'utf8',
  );
  assert.match(migration, /CREATE INDEX CONCURRENTLY IF NOT EXISTS/);
  assert.match(migration, /idx_listing_identity_wtb_reference_lookup/);
  assert.match(migration, /ON public\.listing_identity_reviews[\s\S]*canonical_brand,[\s\S]*canonical_reference,[\s\S]*record_id DESC/);
  assert.match(migration, /WHERE status IN \('CATALOG_CONFIRMED', 'HUMAN_APPROVED'\)/);
  assert.doesNotMatch(migration, /UPDATE|DELETE|TRUNCATE|DROP TABLE/i);
});

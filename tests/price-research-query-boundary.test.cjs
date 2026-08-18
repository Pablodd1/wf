'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  loadQnsaExactReleasedEvidence,
  loadZenithReviewedTradingRows,
} = require('../api/price-research.js');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'api', 'price-research.js'),
  'utf8',
);

test('released exact-reference evidence is reconciled without promoting no-price rows into averages', () => {
  assert.match(source, /normalizedBrand === 'zenith'/);
  assert.match(source, /qnsa_zenith_reference_rows/);
  assert.match(source, /qnsa_trading_floor_reference_rows/);
  assert.match(source, /filter\(row => String\(row\.listing_type \|\| ''\)\.toUpperCase\(\) === 'WTS'\)/);
  assert.match(source, /retained[\s\S]*no-price or incomplete evidence remains visible/);
  assert.match(source, /filter\(row => String\(row\.listing_type \|\| ''\)\.toUpperCase\(\) === 'WTB'\)/);
  assert.match(source, /source\.has_verified_usd_price === true[\s\S]*source\.verified_price_usd/);
  assert.match(source, /qnsa_later_brand_candidate_stride_page/);
  assert.match(source, /maximumPages = 10/);
  assert.match(source, /referenceKeys\.has\(normRef\(row\.reference\)\)/);
  assert.match(source, /p_listing_type: 'WTS'/);
});

test('Zenith bounded release scan finds an exact dotted reference across pages', async () => {
  const calls = [];
  const pages = [
    {
      rows: [
        { id: 'z1', normalized_reference: '03.2522.400', listing_type: 'WTS' },
        { id: 'z-demand', normalized_reference: '03.2522.400', listing_type: 'WTB' },
        { id: 'other', normalized_reference: '03.2085.4021', listing_type: 'WTS' },
      ],
      next_offset: 50,
      has_more: true,
    },
    {
      rows: [{ id: 'z2', normalized_reference: '03.2522.400', listing_type: 'WTS' }],
      next_offset: 51,
      has_more: false,
    },
  ];
  const client = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: pages[calls.length - 1], error: null };
    },
  };
  const rows = await loadZenithReviewedTradingRows(client, {
    referenceVariants: ['03.2522.400'],
    limit: 100,
  });
  assert.deepEqual(rows.map(row => row.id), ['z1', 'z2']);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, 'qnsa_later_brand_candidate_stride_page');
  assert.equal(calls[0].args.p_listing_type, 'WTS');
  assert.equal(calls[1].args.p_offset, 50);
});

test('exact released evidence follows the 101-row RPC boundary and caches WTS/WTB partition input', async () => {
  const rows = Array.from({ length: 150 }, (_, index) => ({
    id: `cartier-${index}`,
    canonical_brand: 'Cartier',
    normalized_reference: 'TEST-150',
    listing_type: index < 120 ? 'WTS' : 'WTB',
    has_verified_usd_price: index % 3 !== 0,
    verified_price_usd: 5000 + index,
  }));
  const calls = [];
  const client = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: rows.slice(args.p_offset, args.p_offset + args.p_limit), error: null };
    },
  };

  const first = await loadQnsaExactReleasedEvidence(client, {
    brand: 'Cartier', referenceVariants: ['TEST-150'], limit: 1000,
  });
  const second = await loadQnsaExactReleasedEvidence(client, {
    brand: 'Cartier', referenceVariants: ['TEST-150'], limit: 1000,
  });

  assert.equal(first.rows.length, 150);
  assert.equal(first.capped, false);
  assert.equal(first.rows.filter(row => row.listing_type === 'WTS').length, 120);
  assert.equal(first.rows.filter(row => row.listing_type === 'WTB').length, 30);
  assert.equal(first.rows[0].price_usd, null);
  assert.equal(first.rows[1].price_usd, 5001);
  assert.deepEqual(calls.map(call => call.args.p_offset), [0, 101]);
  assert.ok(calls.every(call => call.args.p_limit === 101));
  assert.equal(second.rows.length, 150);
  assert.equal(calls.length, 2);
});

test('exact released evidence discloses its hard 1000-row bound', async () => {
  let calls = 0;
  const client = {
    rpc: async (_name, args) => {
      calls += 1;
      return {
        data: Array.from({ length: args.p_limit }, (_, index) => ({
          id: `cap-${args.p_offset + index}`,
          canonical_brand: 'Cartier',
          normalized_reference: 'TEST-CAP',
          listing_type: 'WTS',
          has_verified_usd_price: false,
        })),
        error: null,
      };
    },
  };
  const result = await loadQnsaExactReleasedEvidence(client, {
    brand: 'Cartier', referenceVariants: ['TEST-CAP'], limit: 1000,
  });
  assert.equal(result.rows.length, 1000);
  assert.equal(result.capped, true);
  assert.equal(calls, 10);
});

test('high-volume Price Research uses one bounded strict-source query', () => {
  assert.match(source, /let sourceTable = configuredSourceTable \|\| \(!exactReviewedWorkbookRelease/);
  assert.match(source, /\? 'watch_records'\s*: 'price_research_verified_source'/);
  assert.match(source, /const buildRowsQuery = table => \{/);
  assert.match(source, /let query = client\s*\.from\(table\)/);
  assert.match(source, /\.limit\(pageSize\)/);
  assert.match(source, /const sourceSampleCapped = exactEvidenceRecoveryCapped \|\| \(usingReviewedWorkbook/);
  assert.match(source, /sampleCapped: sourceSampleCapped/);
  assert.doesNotMatch(source, /Array\.from\(\{ length: sampleLimit \/ pageSize \}/);
  assert.doesNotMatch(source, /buildRowsQuery\(from, from \+ pageSize - 1\)/);
  assert.match(source, /\.in\('verdict', \['APPROVED', 'approved', \.\.\.HUMAN_REVIEW_VERDICTS\]\)/);
  assert.match(source, /isPriceResearchAdmissionCandidate\(row\)/);
  assert.match(source, /formula: 'Q1 - 3\.0 \* IQR <= price <= Q3 \+ 3\.0 \* IQR'/);
  assert.match(source, /priced_wts_before_plausibility_count: validPriceRows\.length/);
  assert.match(source, /seller_name,seller_phone/);
});

test('QNSA reviewed release sources are explicit and fail closed', () => {
  assert.match(source, /const QNSA_PRICE_RESEARCH_SOURCE = 'qnsa_rolex_patek_price_research_source'/);
  assert.match(source, /const QNSA_WTB_DEMAND_SOURCE = 'qnsa_rolex_patek_wtb_demand_source'/);
  assert.match(source, /process\.env\.PRICE_RESEARCH_SOURCE_VIEW/);
  assert.match(source, /\['rolex', 'patek philippe', 'audemars piguet', 'richard mille', 'cartier', 'zenith'\]\.includes\(normalizedBrand\)/);
  assert.match(source, /table !== QNSA_PRICE_RESEARCH_SOURCE/);
  assert.match(source, /sourceTable === QNSA_PRICE_RESEARCH_SOURCE/);
  assert.match(source, /!configuredSourceTable && !exactReviewedWorkbookRelease && !isPublicationBrandAllowed/);
  assert.match(source, /!configuredSourceTable && !exactReviewedWorkbookRelease && !isPublicationReferenceAllowed/);
  assert.match(source, /if \(!configuredSourceTable && \(result\.error/);
  assert.match(source, /QNSA_WTB_DEMAND_SOURCE/);
});

test('QNSA analytics uses the indexed Trading release and skips supplemental dial scans', () => {
  assert.match(source, /sourceTable === QNSA_PRICE_RESEARCH_SOURCE[\s\S]*loadQnsaVerifiedTradingPrices/);
  const qnsaLoader = source.slice(
    source.indexOf('async function loadQnsaVerifiedTradingPrices'),
    source.indexOf('// Look up a human model name'),
  );
  assert.doesNotMatch(qnsaLoader, /\.eq\('has_verified_usd_price', true\)/);
  assert.match(qnsaLoader, /genuine no-price and incomplete rows remain[\s\S]*visible as excluded evidence/);
  assert.match(qnsaLoader, /price_usd: row\.has_verified_usd_price === true/);
  assert.match(qnsaLoader, /const mergedRows = new Map/);
  assert.match(source, /!usingQnsaReviewedSource[\s\S]*supplementalCatalogDials\.length/);
  assert.match(source, /loadQnsaTradingDemand[\s\S]*\.from\(QNSA_TRADING_SOURCE\)/);
  assert.match(source, /client\.rpc\('qnsa_three_brand_fx_price_research_rows'/);
  assert.match(source, /isMissingRpcError[\s\S]*client\.rpc\('qnsa_bounded_price_research_rows'/);
  assert.match(source, /if \(!familyPrefix\)[\s\S]*loadQnsaPriceRpcRows/);
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
  assert.match(source, /selection,\s*preloadedReviewedWorkbookEvidenceRows,\s*familyPrefix/);
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

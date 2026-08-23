'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  isReviewedWorkbookBrowseBrand,
  summarizeReviewedWorkbookModels,
  summarizeReviewedWorkbookReferences,
} = require('../api/_lib/reviewed-workbook-browse.cjs');

const rows = [
  { id: '1', brand_scope: 'Glashütte Original', model: 'PanoMaticInverse', public_reference: '90-03-64-64-04', dial_color: 'Skeleton', listing_type: 'WTS' },
  { id: '2', brand_scope: 'Glashütte Original', model: 'PanoMaticInverse', public_reference: '90-03-64-64-04', dial_color: 'Black', listing_type: 'WTS' },
  { id: '3', brand_scope: 'Glashütte Original', model: 'Senator', public_reference: '1-49-13-15-15-04', dial_color: 'Skeleton', listing_type: 'WTS' },
];

test('reviewed workbook brands without a local catalog still expose their real models', () => {
  assert.deepEqual(summarizeReviewedWorkbookModels(rows), [
    { model: 'PanoMaticInverse', reference_count: 1, listing_count: 2 },
    { model: 'Senator', reference_count: 1, listing_count: 1 },
  ]);
});

test('foreign brands, dates, and numeric tokens never become customer model names', () => {
  const contaminated = [
    { brand_scope: 'Glashütte Original', model: 'A. Lange & Söhne Classic / Vintage', public_reference: 'A1' },
    { brand_scope: 'Glashütte Original', model: '2026/1', public_reference: 'A2' },
    { brand_scope: 'Glashütte Original', model: '91560', public_reference: 'A3' },
  ];
  assert.deepEqual(summarizeReviewedWorkbookModels(contaminated), [
    { model: 'Reference-only listings', reference_count: 3, listing_count: 3 },
  ]);
});

test('reviewed workbook references keep unverified prices out of analytics', () => {
  const references = summarizeReviewedWorkbookReferences(rows, 'PanoMaticInverse');
  assert.equal(references.length, 1);
  assert.equal(references[0].listing_count, 2);
  assert.equal(references[0].eligible_observation_count, 0);
  assert.equal(references[0].avg_price, null);
  assert.deepEqual(references[0].dial_colors, [
    { dial_color: 'Black', count: 1 },
    { dial_color: 'Skeleton', count: 1 },
  ]);
});

test('Price Research opens a supplied brand and Trading Floor hides internal evidence badges', () => {
  const research = fs.readFileSync(path.join(__dirname, '..', 'src/pages/PriceResearch.tsx'), 'utf8');
  const floor = fs.readFileSync(path.join(__dirname, '..', 'src/pages/TradingFloor.tsx'), 'utf8');
  assert.match(research, /const \[pBrand, setPBrand\] = useState\(initialBrand\)/);
  assert.match(research, /if \(initialBrand && !initialReference\) void loadModels\(initialBrand\)/);
  assert.match(research, /onChange=\{event => void loadModels\(event\.target\.value\)\}/);
  assert.doesNotMatch(floor, /aria-label="Listing evidence"|EvidenceIndicators|Source contact supplied|Source-supplied listing image/);
  assert.match(floor, /cardHasImage \? 'min-h-\[620px\]' : 'min-h-\[320px\]'/);
  assert.match(floor, /\{cardHasImage && \(/);
});

test('new admission brands use observed workbook evidence for browse counts', () => {
  for (const brand of [
    'A. Lange & Söhne', 'Bell & Ross', 'Blancpain', 'Breguet', 'Breitling',
    'Bulgari', 'Chopard', 'F.P. Journe', 'Franck Muller',
    'Girard-Perregaux', 'Glashütte Original', 'Grand Seiko', 'H. Moser & Cie',
    'Hublot', 'IWC', 'Jacob & Co', 'Jaeger-LeCoultre', 'Longines',
    'TAG Heuer', 'Ulysse Nardin',
  ]) {
    assert.equal(isReviewedWorkbookBrowseBrand(brand), true);
  }
  assert.equal(isReviewedWorkbookBrowseBrand('Rolex'), false);
  assert.equal(isReviewedWorkbookBrowseBrand('Omega'), false);

  const modelsApi = fs.readFileSync(path.join(__dirname, '..', 'api', 'catalog-models.js'), 'utf8');
  const referencesApi = fs.readFileSync(path.join(__dirname, '..', 'api', 'catalog-references.js'), 'utf8');
  for (const source of [modelsApi, referencesApi]) {
    assert.match(source, /if \(isReviewedWorkbookBrowseBrand\(brand\)\)/);
    assert.match(source, /observed_listing_count/);
    assert.match(source, /OWNER_REVIEWED_WORKBOOK/);
  }
  assert.match(referencesApi, /eligible_observation_count/);
  assert.match(referencesApi, /EXACT_REFERENCE_ON_SELECTION/);
});

test('Trading Floor reads admitted brands from approved inventory instead of the overwritten market view', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'reviewed-market-inventory.js'), 'utf8');
  assert.match(source, /REVIEWED_WORKBOOK_ADMISSION_BRANDS = new Set/);
  assert.match(source, /'Glashütte Original'/);
  assert.match(source, /'Ulysse Nardin'/);
  assert.match(source, /if \(brand && REVIEWED_WORKBOOK_ADMISSION_BRANDS\.has\(brand\)[\s\S]*qnsa_rolex_patek_trading_floor_source[\s\S]*isRolexPatekOverlayBrand\(brand\)/);
  assert.match(source, /\.from\('reviewed_workbook_inventory'\)/);
  assert.match(source, /\.in\('verification_status', \[[\s\S]*'APPROVED_SINGLE_CANDIDATE',[\s\S]*MULTI_PARENT_VERIFICATION_STATUS/);
  assert.match(source, /available_from_approved_admission_inventory/);
});

test('reviewed model calculations keep WTB separate and use only verified WTS prices', () => {
  const { workbookModelStats } = require('../api/model-stats.js');
  const summary = workbookModelStats([
    { brand_scope: 'TAG Heuer', model: 'Carrera', public_reference: 'A', listing_type: 'WTS', has_verified_usd_price: true, verified_price_usd: 5000, posting_date: '2026-01-01' },
    { brand_scope: 'TAG Heuer', model: 'Carrera', public_reference: 'B', listing_type: 'WTS', price_evidence_status: 'EXPLICIT_SOURCE_FX_CONVERTED', verified_price_usd: 7000, posting_date: '2026-02-01' },
    { brand_scope: 'TAG Heuer', model: 'Carrera', public_reference: 'C', listing_type: 'WTB', has_verified_usd_price: true, verified_price_usd: 9000, posting_date: '2026-03-01' },
    { brand_scope: 'TAG Heuer', model: 'Carrera', public_reference: 'D', listing_type: 'WTS', verified_price_usd: 11000, posting_date: '2026-04-01' },
  ], 'Carrera');
  assert.equal(summary.total, 4);
  assert.equal(summary.wts, 3);
  assert.equal(summary.wtb, 1);
  assert.equal(summary.priced_count, 2);
  assert.deepEqual(summary.stats, { avg: 6000, median: 6000, min: 5000, max: 7000 });
  assert.equal(summary.meta.iqr_multiplier, 3);
});

test('Price Research discovery merges released admission-brand counts', () => {
  const releaseSummary = fs.readFileSync(path.join(__dirname, '..', 'api', 'live-release-summary.js'), 'utf8');
  const research = fs.readFileSync(path.join(__dirname, '..', 'src/pages/PriceResearch.tsx'), 'utf8');
  assert.match(releaseSummary, /'A\. Lange & Söhne', 'Bell & Ross', 'Blancpain', 'Breguet', 'Breitling'/);
  assert.match(releaseSummary, /'Hublot', 'IWC', 'Jacob & Co', 'Jaeger-LeCoultre', 'Longines'/);
  assert.match(releaseSummary, /qnsa_omega_release_count/);
  assert.match(releaseSummary, /loadReviewedWorkbookBrandCount\(client, brand\)/);
  assert.match(releaseSummary, /mapWithConcurrency\([\s\S]*admittedWorkbookBrandNames,[\s\S]*3,/);
  assert.doesNotMatch(releaseSummary, /loadReviewedWorkbookBrandRows\(client, brand\)/);
  assert.match(releaseSummary, /filter\(item => item\.listing_count > 0\)/);
  assert.match(research, /fetch\('\/api\/live-release-summary'/);
  assert.match(research, /const brandsByName = new Map<string, unknown>\(\)/);
});

test('admission Price Research reads only explicit-USD rows from approved inventory', () => {
  const analytics = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'reviewed-workbook-analytics.cjs'), 'utf8');
  assert.match(analytics, /\.from\('reviewed_workbook_inventory'\)/);
  assert.match(analytics, /\.eq\('verification_status', 'APPROVED_SINGLE_CANDIDATE'\)/);
  assert.match(analytics, /\.eq\('price_evidence_status', 'SOURCE_EXPLICIT_USD_MATCH'\)/);
  assert.match(analytics, /seller_phone: contactApproved \?/);
  assert.doesNotMatch(analytics, /DATED_FX_PROVENANCE_REQUIRES_EXISTING_SIDECAR'[\s\S]*price_usd:/);
});

test('Price Research presents uncategorized catalog identities as individually browsable exact references', () => {
  const research = fs.readFileSync(path.join(__dirname, '..', 'src/pages/PriceResearch.tsx'), 'utf8');
  assert.match(research, /REFERENCE_ONLY_MODEL = 'Reference-only listings'/);
  assert.match(research, /Other exact references/);
  assert.match(research, /'exact references'/);
  assert.match(research, /' · click to browse individually'/);
  assert.match(research, /observed listings/);
  assert.match(research, /loadRefs\(pBrand, m\.model\)/);
  assert.match(research, /Search references for \{pBrand\} \{displayCatalogModel\(pModel\)\}/);
  assert.match(research, /Search all \$\{pRefs\.length\} exact references/);
  assert.match(research, /select one to load full WTS, WTB, no-price, and outlier accounting/);
  assert.match(research, /visibleRefs\.map\(r =>/);
  assert.match(research, /REFERENCE_PICKER_PAGE_SIZE = 6/);
  assert.match(research, /aria-label="Reference pages"/);
  assert.match(research, /bounded source observations|observed/);
  assert.match(research, /qualified WTS/);
  assert.match(research, /source_observation_count/);
  assert.match(research, /reference_qualified_wts_count/);
  assert.match(research, /representative_image_url/);
  assert.match(research, /loadPriceResearchBatchSummaries/);
  assert.match(research, /source listing/);
  assert.match(research, /EXACT_REFERENCE_ON_SELECTION/);
  assert.match(research, /Open to load exact market data/);
  assert.match(research, /setSelectedCatalogReference\(\{/);
  assert.match(research, /match_type: 'exact_reference'/);
  assert.match(research, /setReferenceSuggestionsOpen\(false\)/);
});

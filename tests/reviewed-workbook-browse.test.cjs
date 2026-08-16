'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
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
});

test('Price Research presents uncategorized catalog identities as individually browsable exact references', () => {
  const research = fs.readFileSync(path.join(__dirname, '..', 'src/pages/PriceResearch.tsx'), 'utf8');
  assert.match(research, /REFERENCE_ONLY_MODEL = 'Reference-only listings'/);
  assert.match(research, /Other exact references/);
  assert.match(research, /exact references · click to browse individually/);
  assert.match(research, /loadRefs\(pBrand, m\.model\)/);
  assert.match(research, /Search references for \{pBrand\} \{displayCatalogModel\(pModel\)\}/);
  assert.match(research, /Search all \$\{pRefs\.length\} exact references/);
  assert.match(research, /select one to load full WTS, WTB, no-price, and outlier accounting/);
  assert.match(research, /visibleRefs\.map\(r =>/);
  assert.match(research, /REFERENCE_PICKER_PAGE_SIZE = 6/);
  assert.match(research, /aria-label="Reference pages"/);
  assert.match(research, /released \{referenceEvidence\[r\.reference\.toUpperCase\(\)\]\.count === 1 \? 'observation' : 'observations'\}/);
  assert.match(research, /source listing/);
  assert.match(research, /EXACT_REFERENCE_ON_SELECTION/);
  assert.match(research, /Open to load exact market data/);
  assert.match(research, /setSelectedCatalogReference\(\{/);
  assert.match(research, /match_type: 'exact_reference'/);
  assert.match(research, /setReferenceSuggestionsOpen\(false\)/);
});

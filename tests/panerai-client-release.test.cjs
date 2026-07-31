'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Panerai model and reference browse use one bounded reviewed-file read', () => {
  const models = read('api/catalog-models.js');
  const references = read('api/catalog-references.js');

  assert.match(models, /loadReviewedPaneraiModels[\s\S]*\.in\('id', REVIEWED_PANERAI_RECORD_IDS\)/);
  assert.match(models, /\.eq\('source', REVIEWED_PANERAI_SOURCE\)[\s\S]*\.eq\('listing_type', 'WTS'\)/);
  assert.match(references, /loadReviewedPaneraiReferences[\s\S]*\.in\('id', REVIEWED_PANERAI_RECORD_IDS\)/);
  assert.match(references, /\.eq\('source', REVIEWED_PANERAI_SOURCE\)[\s\S]*\.eq\('listing_type', 'WTS'\)/);
  assert.match(references, /brand\.toLowerCase\(\) === 'panerai'[\s\S]*loadReviewedPaneraiReferences/);
});

test('Panerai Price Research reads only exact reviewed IDs and retains workbook evidence', () => {
  const research = read('api/price-research.js');
  const detail = read('api/price-research-listing.js');

  assert.match(research, /controlledPaneraiRelease[\s\S]*price_research_verified_source/);
  assert.match(research, /\.in\('id', REVIEWED_PANERAI_RECORD_IDS\)/);
  assert.match(research, /rows\.filter\(isOwnerReviewedWorkbookRow\)/);
  assert.match(research, /owner_reviewed_identity: isOwnerReviewedWorkbookRow/);
  assert.match(detail, /isReviewedPaneraiReleaseRecord\(resolvedData\)/);
});

test('Panerai public floor deduplicates reposts without changing raw records', () => {
  const ingest = read('api/ingest.js');
  const floor = read('src/pages/TradingFloor.tsx');
  const reviewedMarket = read('api/reviewed-market-inventory.js');

  assert.match(ingest, /const controlledItems = sortTradingItems[\s\S]*const matched = deduplicateTradingItems\(controlledItems\)/);
  assert.match(floor, /fetch\(`\/api\/reviewed-market-inventory\?/);
  assert.match(floor, /releaseBrands\.map/);
  assert.match(reviewedMarket, /summary\.canonical_listings/);
  assert.doesNotMatch(reviewedMarket, /\.(?:insert|upsert|update|delete)\s*\(/);
  assert.doesNotMatch(ingest, /\.from\('watch_records'\)\.(?:update|upsert|insert|delete)/);
});

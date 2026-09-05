'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const priceResearch = require('../api/price-research.js');
const apiSource = fs.readFileSync(path.join(root, 'api', 'price-research.js'), 'utf8');
const uiSource = fs.readFileSync(path.join(root, 'src', 'pages', 'PriceResearch.tsx'), 'utf8');

test('evidence pagination exposes every row exactly once across bounded pages', () => {
  const rows = Array.from({ length: 253 }, (_, index) => ({ id: `listing-${index + 1}` }));
  const pages = [1, 2, 3].map(page => priceResearch.paginateEvidenceRows(rows, page, 100));
  assert.deepEqual(pages.map(result => result.rows.length), [100, 100, 53]);
  assert.deepEqual(pages.map(result => result.pages), [3, 3, 3]);
  assert.equal(new Set(pages.flatMap(result => result.rows.map(row => row.id))).size, 253);
  assert.deepEqual(pages.flatMap(result => result.rows.map(row => row.id)), rows.map(row => row.id));
});

test('pagination clamps unsafe values and never loads more than 100 rows per evidence category', () => {
  const rows = Array.from({ length: 150 }, (_, index) => ({ id: index }));
  assert.equal(priceResearch.paginateEvidenceRows(rows, -4, 1000).rows.length, 100);
  assert.equal(priceResearch.paginateEvidenceRows(rows, 2, 1000).rows.length, 50);
  assert.equal(priceResearch.paginateEvidenceRows(rows, 999, 24).rows.length, 0);
});

test('API independently paginates WTS evidence categories and WTB demand', () => {
  assert.match(apiSource, /demandPageSize/);
  assert.match(apiSource, /demand_evidence/);
  assert.match(apiSource, /retained_pages/);
  assert.match(apiSource, /outlier_pages/);
  assert.match(apiSource, /sale_pages/);
  assert.match(apiSource, /serializedOutliers = outlierEvidencePage\.rows/);
  assert.match(apiSource, /enrichRowsWithExactDealerEvidence\(client, demandEvidencePage\.rows\)/);
  assert.match(apiSource, /seller_rating_evidence_status: row\.seller_rating_evidence_status \|\| null/);
});

test('Price Research renders WTS first, then separate pageable WTB cards, without compact-sample copy', () => {
  const wtsPosition = uiSource.indexOf('WTS listings for sale · page');
  const wtbPosition = uiSource.indexOf('<DemandSignalsSection');
  assert.ok(wtsPosition >= 0);
  assert.ok(wtbPosition > wtsPosition);
  assert.match(uiSource, /Previous WTS/);
  assert.match(uiSource, /Next WTS/);
  assert.match(uiSource, /Previous WTB/);
  assert.match(uiSource, /Next WTB/);
  assert.match(uiSource, /exact source images when present/);
  assert.match(uiSource, /<ListingDealerEvidence[\s\S]*?profilePath=\{row\.dealer_profile_path\}/);
  assert.doesNotMatch(uiSource, /Showing a compact source-evidence sample for speed/);
});

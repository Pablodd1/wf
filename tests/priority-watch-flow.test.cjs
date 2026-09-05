'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  isPublicationReferenceAllowed,
  isReleaseListingEligible,
} = require('../api/_lib/publication-references.cjs');

const priorityReferences = [
  ['Patek Philippe', '5712'],
  ['Patek Philippe', '5712/1A'],
  ['Patek Philippe', '5712/1A-001'],
  ['Patek Philippe', '5712G'],
  ['Patek Philippe', '5712R'],
  ['Patek Philippe', '5712R-001'],
  ['Patek Philippe', '5712/1R'],
  ['Patek Philippe', '5712/1R-001'],
  ['Rolex', '116500LN'],
  ['Rolex', '126500LN'],
];

test('priority client references are available to the public Price Research flow', () => {
  for (const [brand, reference] of priorityReferences) {
    assert.equal(isPublicationReferenceAllowed(brand, reference), true, `${brand} ${reference}`);
  }
});

test('priority references still require approved high-confidence evidence for calculations', () => {
  for (const [brand, reference] of priorityReferences) {
    assert.equal(isReleaseListingEligible({ brand, reference, verdict: 'APPROVED', confidence: 90, listing_status: 'ACTIVE' }), true);
    assert.equal(isReleaseListingEligible({ brand, reference, verdict: 'Human Review', confidence: 30, listing_status: 'ACTIVE' }), false);
  }
});

test('Trading Floor and Price Research preserve the complete priority-watch drill-down', () => {
  const root = path.resolve(__dirname, '..');
  const floor = fs.readFileSync(path.join(root, 'src/pages/TradingFloor.tsx'), 'utf8');
  const research = fs.readFileSync(path.join(root, 'src/pages/PriceResearch.tsx'), 'utf8');
  const api = fs.readFileSync(path.join(root, 'api/price-research.js'), 'utf8');

  assert.match(floor, /Open full price research/);
  assert.match(floor, /brand=\$\{encodeURIComponent\(listing\.brand\)\}&reference=\$\{encodeURIComponent\(listing\.reference\)\}/);
  assert.match(research, /Featured listings for sale/);
  assert.match(research, /Priced WTS evidence is accessible page by page/);
  assert.doesNotMatch(research, /\.\.\.\(data\.retained_rows \|\| \[\]\)/);
  assert.match(research, /data\.outlier_rows/);
  assert.match(api, /\.eq\('listing_type', 'WTS'\)/);
  assert.match(api, /lookupDemand/);
  assert.match(api, /retained_evidence_count: retainedEvidenceRows\.length/);
  assert.match(api, /retained_rows: \[\]/);
  assert.match(api, /outlierDealerEvidenceRows[\s\S]*raw_message:[\s\S]*thumbnail_url:[\s\S]*seller_name:/);
});

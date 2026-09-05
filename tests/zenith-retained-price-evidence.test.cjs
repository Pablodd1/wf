'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const api = fs.readFileSync(path.join(root, 'api', 'price-research.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src', 'pages', 'PriceResearch.tsx'), 'utf8');

test('reviewed Zenith exclusions remain counted for audit but unpriced rows are Trading-Floor-only', () => {
  assert.match(api, /retainedEvidenceRows = requiredFieldExclusions\.filter/);
  assert.match(api, /isOwnerReviewedWorkbookRow\(row\)/);
  assert.match(api, /isReviewedPaneraiReleaseRecord\(row\)/);
  assert.match(api, /isReviewedZenithIdentityCorrectionRecord\(row\)/);
  assert.match(api, /retained_evidence_count: retainedEvidenceRows\.length/);
  assert.match(api, /retained_total: retainedEvidenceRows\.length/);
  assert.match(api, /retained_rows: \[\]/);
  assert.match(api, /customerPricedOutlierRows/);
  assert.doesNotMatch(page, /retainedListings\.map/);
  assert.doesNotMatch(page, /\.\.\.\(data\.retained_rows \|\| \[\]\)/);
  assert.match(page, /Unpriced WTS stays on the Trading Floor/);
  assert.match(page, /data\.retained_evidence_count \?\? data\.excludedEvidenceCount/);
});

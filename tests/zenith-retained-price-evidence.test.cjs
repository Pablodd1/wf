'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const api = fs.readFileSync(path.join(root, 'api', 'price-research.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src', 'pages', 'PriceResearch.tsx'), 'utf8');

test('reviewed Zenith listings remain inspectable without entering price analytics', () => {
  assert.match(api, /retainedEvidenceRows = requiredFieldExclusions\.filter/);
  assert.match(api, /isOwnerReviewedZenithRow\(row\)/);
  assert.match(api, /isReviewedZenithIdentityCorrectionRecord\(row\)/);
  assert.match(api, /retained_rows: serializedRetainedEvidence\.map/);
  assert.match(api, /price_usd: null/);
  assert.match(api, /source_price_amount: r\.source_price_amount \|\| null/);
  const retainedBlock = api.split('retained_rows:')[1].split('rows: serializedComparables')[0];
  assert.doesNotMatch(retainedBlock, /stored_price_usd/);
  assert.match(page, /Reviewed listing evidence/);
  assert.match(page, /excluded from averages until the raw message provides explicit currency evidence/);
  assert.match(page, /Price under review/);
  assert.match(page, /This reviewed listing is displayed for its source post, image, seller, and watch identity/);
});

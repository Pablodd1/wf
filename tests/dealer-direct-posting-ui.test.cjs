'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'src/pages/DealerSubmitListing.tsx'), 'utf8');

test('authenticated form supports item photos, a posting-user photo, and three clear posting paths', () => {
  assert.match(source, /Take or choose item photos/);
  assert.match(source, /Credentialed posting user/);
  assert.match(source, /identity fields cannot be edited here/);
  assert.match(source, /capture="environment"/);
  assert.match(source, /capture="user"/);
  assert.match(source, /Several separate items/);
  assert.match(source, /One bundle or dealer list/);
  assert.match(source, /Add similar/);
  assert.match(source, /deferred bundle lane/);
  assert.match(source, /MAX_ITEMS = 20/);
  assert.match(source, /Submit \$\{items\.length === 1 \? 'item'/);
  assert.match(source, /for review/);
  assert.match(source, /Complete dealer onboarding/);
  assert.match(source, /Batch \{item\.bulk_submission_id/);
  assert.match(source, /Submission preview/);
  assert.match(source, /Review before sending/);
  assert.match(source, /Confirm source evidence/);
  assert.match(source, /Make cover/);
  assert.match(source, /source_evidence_confirmed: sourceEvidenceConfirmed/);
});

test('direct form keeps price optional and sends normalized items to the publication API', () => {
  assert.match(source, /Asking price \(optional\)/);
  assert.match(source, /Price not supplied/);
  assert.match(source, /items: normalizedItems/);
  assert.match(source, /\/api\/dealer-media/);
  assert.match(source, /\/api\/dealer-submissions/);
  assert.match(source, /Brand or maker/);
  assert.match(source, /Item name or style/);
  assert.match(source, /Material or color/);
  assert.match(source, /Included accessories/);
});

test('guest users can prepare and preview but registration is required to save', () => {
  assert.match(source, /The editor and preview remain open/);
  assert.match(source, /Registration is required only when you save and submit/);
  assert.match(source, /Register or sign in to save/);
  assert.match(source, /Submission preview/);
  assert.doesNotMatch(source, /LUXURY_APP_URL|Luxury App|<iframe/);
});

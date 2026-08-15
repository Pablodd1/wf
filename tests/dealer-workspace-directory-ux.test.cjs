'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

test('soft credentialing offers a restricted guest workspace session', () => {
  const login = read('src/pages/DealerLogin.tsx');
  assert.match(login, /Skip for Now/);
  assert.match(login, /isCredentialed: false/);
  assert.match(login, /isGuestDealer: true/);
  assert.match(login, /sessionStorage\.setItem\('cl_dealer_session'/);
  assert.match(login, /navigate\('\/dealer\/workspace'/);
  assert.match(login, /Posting, profile editing, saved activity, and transaction history remain unavailable/);
});

test('Trading Floor filter rail stays visible and rating badges match the filter contract', () => {
  const floor = read('src/pages/TradingFloor.tsx');
  const dealerEvidence = read('src/components/ListingDealerEvidence.tsx');
  assert.match(floor, /filters-sidebar/);
  assert.match(floor, /md:sticky md:top-5/);
  assert.match(floor, /md:max-h-\[calc\(100vh-40px\)\]/);
  assert.match(floor, /overflow-y-auto/);
  assert.match(floor, /<DealerRatingBadge/);
  assert.match(floor, /<ListingDealerEvidence/);
  assert.match(dealerEvidence, /ratingEvidenceStatus === 'SOURCE_SUPPLIED'/);
  assert.match(dealerEvidence, /ratingEvidenceStatus === 'SOURCE_FEEDBACK_COUNT'/);
  assert.match(dealerEvidence, />Not rated<\/span>/);
  assert.match(dealerEvidence, /contactPublicationApproved \?/);
});

test('Reference Check searches by name or consented phone and uses the canonical profile route', () => {
  const directory = read('src/pages/DealerDirectory.tsx');
  const app = read('src/App.tsx');
  const api = read('api/dealers.js');
  assert.match(directory, /Search by dealer name or phone number/);
  assert.match(directory, /setSearch\(searchInput\.trim\(\)\)/);
  assert.doesNotMatch(directory, /setTimeout\(\(\) => \{ setLoading\(true\)/);
  assert.match(directory, /const controller = new AbortController\(\);\s*setLoading\(true\);/);
  assert.match(directory, /`\/reference-check\/\$\{dealer\.slug \|\| dealer\.id\}`/);
  assert.match(app, /path="\/reference-check\/:dealerId"/);
  assert.match(app, /path="\/dealer\/profile\/:dealerId" element=\{<LegacyDealerProfileRedirect \/>\}/);
  assert.match(api, /phoneMatchedDealerIds/);
  assert.match(api, /display_name\.ilike/);
});

test('dealer writes remain owner-scoped and POST IT binds authenticated identity', () => {
  const workspace = read('api/dealer-workspace.js');
  const submissions = read('api/dealer-submissions.js');
  assert.match(workspace, /\.eq\('id', dealer\.id\)\.eq\('auth_user_id', authorization\.user\.id\)/);
  assert.match(submissions, /auth_user_id: authorization\.user\.id, dealer_id: poster\.dealer_id/);
  assert.match(submissions, /\.eq\('auth_user_id', authorization\.user\.id\)/);
  assert.match(submissions, /bulk_submission_id: bulkSubmissionId/);
});

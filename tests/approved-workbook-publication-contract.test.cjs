'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('owner-approved workbook contacts are public only through the explicit record flag', () => {
  const route = read('api/listing-contact.js');
  assert.match(route, /OWNER_APPROVED_CONTACT_PUBLIC/);
  assert.match(route, /hasOwnerApprovedPublicContact\(listing\.flags\)/);
  assert.match(route, /phone_display: listing\.seller_phone/);
  assert.match(route, /contact_source: 'OWNER_APPROVED_WORKBOOK'/);
  assert.match(route, /ownerApprovedContactStats/);
  assert.match(route, /wts_posts/);
  assert.match(route, /wtb_posts/);
  assert.match(route, /whatsappUrl\(phone, resolvedListing\)/);
});

test('Trading Floor keeps USD primary when a reviewed USD value exists', () => {
  const page = read('src/pages/TradingFloor.tsx');
  assert.match(page, /const hasUsdPrice = Number\.isFinite\(Number\(listing\.price_usd\)\)/);
  assert.match(page, /const usdPriceLabel = hasUsdPrice[\s\S]*formatUsdPrice/);
  assert.match(page, /meta\.usdPriceLabel[\s\S]*meta\.rawPriceLabel/);
  assert.match(page, /contact\.phone_display/);
  assert.match(page, /contact\.dealer_stats\.wts_posts/);
  assert.match(page, /contact\.dealer_stats\.wtb_posts/);
});

test('reviewed workbook importer retains original currency beside approved USD', () => {
  const importer = read('tools/intake/publish-reviewed-panerai-workbook.cjs');
  assert.match(importer, /extractPriceObservations\(row\.raw_message/);
  assert.match(importer, /price_raw: sourcePrice\?\.amount_original/);
  assert.match(importer, /price_usd: row\.price_usd/);
  assert.match(importer, /currency: sourcePrice\?\.currency_original/);
  assert.match(importer, /OWNER_APPROVED_CONTACT_PUBLIC/);
});

test('Zenith workbook importer is hash locked and separates visual conflicts', () => {
  const importer = read('tools/intake/publish-reviewed-zenith-workbook.cjs');
  const decisions = JSON.parse(read('tools/intake/fixtures/zenith-visual-decisions-20260730.json'));
  assert.match(importer, /EXPECTED_ROWS = 1403/);
  assert.match(importer, /EXPECTED_SHA256 = '108f1383/);
  assert.match(importer, /DIAL_VISUALLY_CONFIRMED_20260730/);
  assert.match(importer, /OWNER_APPROVED_CONTACT_PUBLIC/);
  assert.match(importer, /identityDecisionRows = rows\.filter\(row => !row\.publishable \|\| hasCompleteIdentity\(row\)\)/);
  assert.match(importer, /status: 'UNVERIFIED'/);
  assert.match(importer, /CONTROLLED_FLOOR_IDENTITY_INCOMPLETE/);
  assert.match(importer, /visual_match: imagePublishable \? 'MATCH' : 'NO_MATCH'/);
  assert.match(importer, /p_decision: decision/);
  assert.equal(decisions.reviewed_image_count, 176);
  assert.equal(Object.keys(decisions.blocked_by_worksheet_row).length, 16);
  assert.equal(Object.keys(decisions.image_withheld_by_worksheet_row).length, 1);
});

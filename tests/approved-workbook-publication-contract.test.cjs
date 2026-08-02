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

test('Trading Floor shows USD only for source-confirmed eligible evidence', () => {
  const page = read('src/pages/TradingFloor.tsx');
  assert.match(page, /listing\.price_evidence_status !== 'SOURCE_EXPLICIT_USD_MATCH'/);
  assert.match(page, /listing\.price_research_eligible !== true/);
  assert.match(page, /verifiedUsd !== null[\s\S]*formatUsdPrice\(verifiedUsd\)/);
  assert.match(page, /sourcePrice \|\| 'Price on request'/);
  assert.match(page, /Original source price · no USD conversion/);
  assert.match(page, /contact\.phone_display/);
  assert.match(page, /sellerAnalytics\.wts_posts/);
  assert.match(page, /sellerAnalytics\.wtb_posts/);
  assert.match(page, /raw_message_scope === 'normalized_summary'[\s\S]*Unverified workbook summary text is withheld from the customer view/);
});

test('reviewed workbook importer retains original currency beside approved USD', () => {
  const importer = read('tools/intake/publish-reviewed-panerai-workbook.cjs');
  assert.match(importer, /extractPriceObservations\(row\.raw_message/);
  assert.match(importer, /price_raw: sourcePrice\?\.amount_original/);
  assert.match(importer, /price_usd: row\.price_usd/);
  assert.match(importer, /currency: sourcePrice\?\.currency_original/);
  assert.match(importer, /OWNER_APPROVED_CONTACT_PUBLIC/);
  assert.match(importer, /REFERENCE_IMAGE_ONLY/);
  assert.match(importer, /REFERENCE_ONLY_NOT_SELLER_PHOTO/);
  assert.match(importer, /p_decision: 'VISUALLY_VERIFIED'[\s\S]*public_image_evidence_type: 'REFERENCE_IMAGE'/);
});

test('Trading Floor withholds reference-only images while preserving provenance elsewhere', () => {
  const provenance = read('api/_lib/public-image-provenance.cjs');
  const ingest = read('api/ingest.js');
  const detail = read('api/price-research-listing.js');
  const floor = read('src/pages/TradingFloor.tsx');
  const research = read('src/pages/PriceResearch.tsx');

  assert.match(provenance, /REVIEWED_PANERAI_SOURCE[\s\S]*REFERENCE_IMAGE/);
  assert.match(provenance, /not the seller’s original listing photo/);
  assert.match(ingest, /publicImageProvenance\(resolved\)/);
  assert.match(detail, /publicImageProvenance\(customerListing\)/);
  assert.match(floor, /'SOURCE_LISTING_IMAGE', 'SOURCE_LINKED_IMAGE'/);
  assert.doesNotMatch(floor, /Reference image · not seller photo/);
  assert.match(floor, /onError=\{onUnavailable\}/);
  assert.doesNotMatch(floor, /publicListing\.image_urls|tradingListing\.image_urls/);
  assert.match(floor, /listing\.image_evidence_notice/);
  assert.match(research, /detail\.image_evidence_notice/);
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
  assert.match(importer, /identity_overrides_by_worksheet_row/);
  assert.match(importer, /IDENTITY_CORRECTED_FROM_SOURCE_EVIDENCE_20260730/);
  assert.equal(decisions.reviewed_image_count, 176);
  assert.equal(Object.keys(decisions.identity_overrides_by_worksheet_row).length, 24);
  assert.equal(decisions.identity_overrides_by_worksheet_row['1020'].brand, 'Rolex');
  assert.equal(decisions.identity_overrides_by_worksheet_row['1020'].model, 'Daytona');
  assert.equal(decisions.identity_overrides_by_worksheet_row['1159'].dial_color, 'White');
  assert.equal(decisions.identity_overrides_by_worksheet_row['587'].model, 'Defy Classic');
  assert.equal(Object.keys(decisions.blocked_by_worksheet_row).length, 23);
  assert.equal(Object.keys(decisions.image_withheld_by_worksheet_row).length, 2);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isPrivateAddress } = require('../api/_lib/safe-image-fetch.cjs');
const { redactPublicSource } = require('../api/_lib/source-redaction.cjs');
const { csvCell } = require('../api/_lib/csv-cell.cjs');
const { clientHash } = require('../api/_lib/ai-quota.cjs');

test('blocks private and reserved image destinations', () => {
  for (const address of ['127.0.0.1', '10.0.0.8', '172.16.0.2', '192.168.1.5', '169.254.169.254', '::1', 'fd00::1']) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  assert.equal(isPrivateAddress('8.8.8.8'), false);
});

test('redacts dealer contact paths while preserving watch references and prices', () => {
  const raw = '[7/12, 7:19 AM] +852 6236 1307: Rolex 116500LN USD 30,000\nWhatsApp: +1 (305) 555-1212';
  const redacted = redactPublicSource(raw);
  assert.match(redacted, /Rolex 116500LN USD 30,000/);
  assert.doesNotMatch(redacted, /6236|305|555|1212/);
});

test('redacts WhatsApp links while preserving raw watch evidence', () => {
  const raw = 'Rolex 52506 HKD 380K contact https://wa.me/85262361307';
  const redacted = redactPublicSource(raw);
  assert.match(redacted, /Rolex 52506 HKD 380K contact/);
  assert.doesNotMatch(redacted, /wa\.me|62361307/);
});

test('redacts standalone international phone and email without corrupting watch evidence', () => {
  const raw = 'Dealer +852 6236 1307 john@example.com Rolex 116500LN USD 30,000';
  const redacted = redactPublicSource(raw);
  assert.match(redacted, /Rolex 116500LN USD 30,000/);
  assert.doesNotMatch(redacted, /6236|john@example/);
});

test('redacts contact-labeled messaging handles and links but preserves poster headings', () => {
  const raw = '[7/12/2026, 7:19 AM] Jane Dealer: Rolex 116500LN USD 30,000\nTelegram: @jane_watches\nhttps://t.me/jane_watches';
  const redacted = redactPublicSource(raw);
  assert.match(redacted, /Jane Dealer: Rolex 116500LN USD 30,000/);
  assert.doesNotMatch(redacted, /@jane_watches|t\.me/);
  assert.match(redacted, /Telegram \[handle redacted\]/);
});

test('neutralizes spreadsheet formulas and quotes CSV values', () => {
  assert.equal(csvCell('=HYPERLINK("https://bad.example")'), '"\'=HYPERLINK(""https://bad.example"")"');
  assert.equal(csvCell('Rolex, 116500LN'), '"Rolex, 116500LN"');
});

test('hashes AI quota client addresses without retaining the address', () => {
  const prior = process.env.AI_RATE_LIMIT_SECRET;
  process.env.AI_RATE_LIMIT_SECRET = 'test-only-secret';
  try {
    const req = { headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.1' }, socket: {} };
    const value = clientHash(req);
    assert.match(value, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(value, /203\.0\.113\.10/);
  } finally {
    if (prior === undefined) delete process.env.AI_RATE_LIMIT_SECRET;
    else process.env.AI_RATE_LIMIT_SECRET = prior;
  }
});

test('AI quota migration is service-role only and security-definer scoped', () => {
  const sql = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'supabase', 'migrations', '20260720090000_ai_api_quota.sql'),
    'utf8',
  );
  assert.match(sql, /SECURITY DEFINER/i);
  assert.match(sql, /SET search_path = public/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role/i);
});

test('human review evidence and AI assistance require reviewer or admin authorization', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  for (const route of ['shadow-review-queue.js', 'co-pilot.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'api', route), 'utf8');
    assert.match(source, /authorizeDealer/);
    assert.match(source, /new Set\(\['reviewer', 'admin'\]\)/);
  }
});

test('seller contact is masked by default and reveal access is audited', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const queue = fs.readFileSync(path.join(__dirname, '..', 'api', 'unbundled-review-queue.js'), 'utf8');
  const reveal = fs.readFileSync(path.join(__dirname, '..', 'api', 'reviewer-contact-reveal.js'), 'utf8');
  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '20260724223000_reviewer_contact_access_audit.sql'),
    'utf8',
  );
  assert.match(queue, /Cache-Control', 'private, no-store/);
  assert.match(queue, /maskPhone\(seller\?\.source_identity\)/);
  assert.match(reveal, /new Set\(\['reviewer', 'admin'\]\)/);
  assert.match(reveal, /reviewer_contact_access_audit/);
  assert.match(migration, /REVOKE ALL[\s\S]*FROM PUBLIC, anon, authenticated/i);
});

test('AI co-pilot redacts source contact before building the Gemini prompt', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'co-pilot.js'), 'utf8');
  assert.match(source, /redactPublicSource\(String\(rawMessage/);
});

test('dealer login does not redirect unauthorized roles into protected review routes', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const page = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'DealerLogin.tsx'), 'utf8');
  assert.match(page, /requiredRolesFor/);
  assert.match(page, /route === '\/review' \|\| route === '\/review-queue'/);
  assert.match(page, /requires \$\{requiredRolesFor\(requestedDestination\)\?\.join\(' or '\)\} access/);
  assert.match(page, /Review Queue accepts reviewer or admin/);
});

test('listing detail stays release-gated while approved dealer profiles expose source evidence', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const listingRoute = fs.readFileSync(path.join(__dirname, '..', 'api', 'trading-listing.js'), 'utf8');
  const profileRoute = fs.readFileSync(path.join(__dirname, '..', 'api', 'dealer-profile.js'), 'utf8');
  assert.match(listingRoute, /raw_message: null/);
  assert.doesNotMatch(listingRoute, /redactPublicSource/);
  assert.doesNotMatch(listingRoute, /authorizeDealer/);
  assert.match(listingRoute, /trading_floor_verified_listings/);
  assert.doesNotMatch(listingRoute, /const publicTable[\s\S]*trading_floor_listings/);
  assert.match(listingRoute, /isReleaseListingEligible/);
  assert.match(listingRoute, /\.from\(publicTable\)/);
  assert.match(profileRoute, /raw_message/);
  assert.match(profileRoute, /raw_message_access: true/);
});

test('Price Research shows unredacted raw source evidence and verified seller activity on click', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const page = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'PriceResearch.tsx'), 'utf8');
  assert.match(page, /Original listing/);
  assert.match(page, /RAW SOURCE MESSAGE/);
  assert.match(page, /Posted by/);
  assert.match(page, /api\/listing-contact/);
  assert.match(page, /api\/reviewed-seller-summary/);
  assert.match(page, /Source poster activity/);
  assert.match(page, /For sale/);
  assert.match(page, /Looking for/);
  assert.doesNotMatch(page, /Total posts/);
  assert.match(page, /Groups/);
  assert.doesNotMatch(page, /title\.startsWith\('Raw source'\)/);
  assert.match(page, /seller\?\.dealer_stats \?/);
  assert.doesNotMatch(page, /seller\.dealer_stats\?\.wts_posts \|\| 0/);
});

test('Price Research returns outlier analytics publicly (no auth gate)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const route = fs.readFileSync(path.join(__dirname, '..', 'api', 'price-research.js'), 'utf8');
  // 2026-08-01 product decision (adaa4e9, 0b92aa3, 0e51450): Price Research
  // is public — outliers/liquidity/graphics are customer-facing analytics.
  // Guard against the auth gate regression recurring (it did once, in c1f6490).
  assert.doesNotMatch(route, /authorizeDealer\(req, res\)/);
  assert.match(route, /const canReviewExcludedEvidence = true/);
  assert.match(route, /outlier_rows: canReviewExcludedEvidence \?/);
  assert.match(route, /Cache-Control', 'no-store/);
});

test('Trading Floor click-through shows source evidence and consent-gated dealer analytics', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const page = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'TradingFloor.tsx'), 'utf8');
  assert.match(page, /api\/reviewed-market-inventory/);
  assert.match(page, /api\/reviewed-seller-summary/);
  assert.match(page, /api\/listing-contact\?/);
  assert.match(page, /if \(payload\.contact_available\)/);
  assert.doesNotMatch(page, /https:\/\/wa\.me\/\$\{listing\./);
  assert.match(page, /Original raw message/);
  assert.match(page, /sellerAnalytics/);
  assert.match(page, /For sale/);
  assert.match(page, /Want to buy/);
  assert.match(page, /Source-supplied contact/);
  assert.match(page, /ListingDealerEvidence/);
  assert.match(page, /contactPublicationApproved=\{listing\.contact_publication_approved === true\}/);
  assert.match(page, /ratingEvidenceStatus=\{listing\.seller_rating_evidence_status\}/);
});

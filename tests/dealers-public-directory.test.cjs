'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { publicDealer } = require('../api/dealers.js');
const { parsedSourceDate, ratedDealerEvidence, ratedProfilePayload, ratedProfiles, sourcePhone, topRatedProfiles, sourceProfilePayload } = require('../api/_lib/dealer-directory-source.cjs');
const dealersHandler = require('../api/dealers.js');
const dealerProfileHandler = require('../api/dealer-profile.js');

async function invoke(handler, query) {
  let statusCode = 200;
  let payload;
  const res = {
    setHeader() {},
    status(value) { statusCode = value; return this; },
    json(value) { payload = value; return value; },
  };
  await handler({ method: 'GET', query }, res);
  return { statusCode, payload };
}

test('public directory keeps Reference Check database-backed and does not require a dealer session', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'dealers.js'), 'utf8');
  assert.doesNotMatch(source, /authorizeDealer/);
  assert.match(source, /getClient/);
  assert.match(source, /\.eq\('status', 'VERIFIED'\)/);
});

test('Top Rated preserves source rank and feedback without inventing a numeric rating', () => {
  const profiles = topRatedProfiles();
  assert.equal(profiles.length, 25);
  assert.deepEqual(profiles.map(profile => profile.source_rank), Array.from({ length: 25 }, (_, index) => index + 1));
  assert.ok(profiles.every(profile => profile.rating === null));
  assert.ok(profiles.every(profile => profile.review_count >= 0));
  assert.ok(profiles.every(profile => /^\+\d{7,15}$/.test(profile.verified_phone)));
  assert.ok(profiles.every(profile => profile.source_url?.startsWith('https://watchfacts.com/user/')));
});

test('Rated Dealers preserves feedback counts without inventing a five-point score', () => {
  const profiles = ratedProfiles();
  assert.equal(profiles.length, 53);
  assert.equal(profiles[0].display_name, 'Federico Maman');
  assert.equal(profiles[0].rating, null);
  assert.equal(profiles[0].review_count, 22);
  assert.equal(profiles[0].rating_evidence_status, 'SOURCE_FEEDBACK_COUNT');
  assert.equal(ratedDealerEvidence({ phone: '+1 (305) 988-8263' }).source_profile_id, '916');
  assert.equal(ratedDealerEvidence({ dealerId: '916' }).trust_status, 'Trusted User');
});

test('every rated dealer card resolves to an internal profile payload', () => {
  for (const dealer of ratedProfiles()) {
    const payload = ratedProfilePayload(dealer.id);
    assert.equal(payload?.success, true, dealer.id);
    assert.equal(payload?.dealer?.id, dealer.id);
    assert.equal(payload?.dealer?.rating, null);
    assert.equal(payload?.dealer?.review_count, dealer.review_count);
    assert.equal(payload?.source_links, undefined);
    assert.equal(payload?.dealer?.source_url, undefined);
    assert.equal(payload?.source_provenance?.source_url, undefined);
  }
});

test('public WhatsApp links provide searchable source phone numbers', async () => {
  assert.equal(sourcePhone({ whatsapp_url: 'https://wa.me/17147340511' }), '+17147340511');
  const directory = await invoke(dealersHandler, { mode: 'top-rated', pageSize: '25', q: '7147340511' });
  assert.equal(directory.statusCode, 200);
  assert.equal(directory.payload.total, 1);
  assert.equal(directory.payload.dealers[0].display_name, 'Jaztime Watches');
});

test('Top Rated and source profile API handlers return the complete source-backed workflow', async () => {
  const directory = await invoke(dealersHandler, { mode: 'top-rated', pageSize: '25' });
  assert.equal(directory.statusCode, 200);
  assert.equal(directory.payload.total, 25);
  assert.equal(directory.payload.source, 'public-source-snapshot');

  const profile = await invoke(dealerProfileHandler, { id: 'watchfacts-source-3435' });
  assert.equal(profile.statusCode, 200);
  assert.equal(profile.payload.dealer.display_name, 'Jaztime Watches');
  assert.ok(profile.payload.listings.length > 0);
  assert.ok(profile.payload.reviews.length > 0);
  assert.ok(profile.payload.listings.every(row => row.price_usd === null));
  assert.ok(profile.payload.listings.every(row => row.raw_message === null || typeof row.raw_message === 'string'));
});

test('source snapshot accounts for every crawled listing and review once', () => {
  const profiles = topRatedProfiles();
  const payloads = profiles.map(profile => sourceProfilePayload(profile.slug));
  assert.equal(payloads.reduce((sum, payload) => sum + payload.listings.length, 0), 376);
  assert.equal(payloads.reduce((sum, payload) => sum + payload.reviews.length, 0), 268);
});

test('source dates remove repost annotations and remain sortable', () => {
  assert.equal(parsedSourceDate('Aug 7, 2026· Reposted 26x').toISOString(), '2026-08-07T00:00:00.000Z');
  const payload = sourceProfilePayload('watchfacts-source-3435');
  assert.equal(payload.stats.first_post, '2026-08-04T00:00:00.000Z');
  assert.equal(payload.stats.latest_post, '2026-08-09T00:00:00.000Z');
});

test('verified phone is published only when the dealer consent flag is true', () => {
  const base = {
    id: 'dealer-1', display_name: 'Verified Dealer', contact_consent: false,
  };
  const privateResult = publicDealer(base, { wts_posts: 2 }, '+1 305 555 0101', 1);
  assert.equal(privateResult.verified_phone, null);
  assert.equal('contact_consent' in privateResult, false);

  const publicResult = publicDealer({ ...base, contact_consent: true }, null, '+1 305 555 0101', 1);
  assert.equal(publicResult.verified_phone, '+1 305 555 0101');
});

test('source profile workflow is provenance-labeled and remains distinct from verified identity', () => {
  const payload = sourceProfilePayload('watchfacts-source-3435');
  assert.ok(payload);
  assert.equal(payload.dealer.rating, null);
  assert.equal(payload.stats.verified_contact_info, null);
  assert.equal(payload.source_provenance.source_system, 'WATCHFACTS_PUBLIC_TOP_RATED_SNAPSHOT');
  assert.equal(payload.source_links, undefined);
  assert.equal(payload.dealer.source_url, undefined);
  assert.ok(payload.source_provenance.captured_listing_count > 0);

  const directory = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'DealerDirectory.tsx'), 'utf8');
  const profile = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'DealerProfile.tsx'), 'utf8');
  assert.match(directory, /public-source leaderboard/);
  assert.match(profile, /Top Rated dealer evidence/);
  assert.match(profile, /Captured facts remain distinct from internally verified seller lineage/);
  assert.match(directory, /Full profile/);
  assert.match(profile, /Verified dealer/);
  assert.doesNotMatch(directory, /Source profile/);
  assert.doesNotMatch(profile, /Open source listing|All source listings|Source WTS|Source WTB|Contact through public source/);
  assert.doesNotMatch(profile, /No source image/);
});

test('public dealer API payloads never expose private provenance URLs', async () => {
  for (const query of [
    { mode: 'top-rated', pageSize: '25' },
    { mode: 'rated', pageSize: '100' },
    { mode: 'legacy', pageSize: '100' },
  ]) {
    const response = await invoke(dealersHandler, query);
    assert.equal(response.statusCode, 200);
    assert.doesNotMatch(JSON.stringify(response.payload), /https:\/\/watchfacts\.com\//i);
  }
  for (const id of ['watchfacts-source-3435', 'watchfacts-legacy-9641']) {
    const response = await invoke(dealerProfileHandler, { id });
    assert.equal(response.statusCode, 200);
    assert.doesNotMatch(JSON.stringify(response.payload), /https:\/\/watchfacts\.com\//i);
  }
});

test('Dealer Directory opens on the live canonical directory while evidence views remain available', () => {
  const directory = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'DealerDirectory.tsx'), 'utf8');
  assert.match(directory, /useState<DirectoryView>\('reference'\)/);
  assert.match(directory, /Live Directory/);
  assert.match(directory, /> Rated Dealers</);
  assert.match(directory, /Top Rated Dealers/);
});

test('Workspace removes the redundant public market-access block and preserves the remaining tools', () => {
  const workspace = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'DealerPortal.tsx'), 'utf8');
  assert.doesNotMatch(workspace, /Market access, with the evidence attached/);
  assert.doesNotMatch(workspace, /Public workspace/);
  assert.doesNotMatch(workspace, /title: 'Trading Floor'/);
  assert.doesNotMatch(workspace, /title: 'Price Research'/);
  assert.match(workspace, /title: 'POST IT'/);
  assert.match(workspace, /title: 'Dealer Directory'/);
  assert.match(workspace, /title: 'Dealer Account'/);
});

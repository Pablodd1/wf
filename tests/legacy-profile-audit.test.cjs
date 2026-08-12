'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  legacyProfilePayload,
  legacyProfiles,
} = require('../api/_lib/dealer-directory-source.cjs');
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

test('legacy audit publishes stable profile IDs without merging name-only identities', () => {
  const profiles = legacyProfiles();
  assert.equal(profiles.length, 21);
  assert.equal(new Set(profiles.map(profile => profile.legacy_profile_id)).size, 21);
  assert.ok(profiles.every(profile => profile.id === `watchfacts-legacy-${profile.legacy_profile_id}`));
  assert.ok(profiles.every(profile => profile.rating === null));
  assert.ok(profiles.every(profile => profile.review_count === null));
  assert.ok(profiles.every(profile => profile.whatsapp_group_count === null));
});

test('legacy counts remain explicit historical snapshots', () => {
  const payload = legacyProfilePayload('watchfacts-legacy-9641');
  assert.ok(payload);
  assert.equal(payload.dealer.display_name, 'Forest');
  assert.equal(payload.stats.wts_count, 3640);
  assert.equal(payload.stats.wtb_count, 14);
  assert.equal(payload.stats.snapshot_range.snapshot_count, 2);
  assert.equal(payload.stats.snapshot_range.wts_min, 56);
  assert.equal(payload.stats.snapshot_range.wts_max, 3640);
  assert.equal(payload.stats.snapshot_range.current_counts_are_dynamic, false);
  assert.equal(payload.stats.group_count, null);
});

test('workbook inventory evidence is not duplicated into normalized market listings', () => {
  const data = require('../data/dealer-directory/legacy-profile-audit-2026-08-11.json');
  assert.equal(data.scope.rows, 705);
  assert.equal(data.scope.source_posts, 38);
  assert.equal(data.scope.inventory_source_posts, 28);
  assert.equal(data.publication_policy.inventory_rows_publishable_without_lineage_review, false);
  assert.equal(data.publication_policy.groups_captured, false);
  assert.equal(data.publication_policy.ratings_captured, false);
});

test('directory UI labels legacy evidence and unknown fields honestly', () => {
  const directory = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'DealerDirectory.tsx'), 'utf8');
  const profile = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'DealerProfile.tsx'), 'utf8');
  assert.match(directory, /Legacy Profiles/);
  assert.match(directory, /Rating not captured/);
  assert.match(directory, /Groups not captured/);
  assert.match(directory, /Historical snapshot/);
  assert.match(profile, /Legacy profile evidence/);
  assert.match(profile, /do not replace live totals/);
});

test('legacy directory and profile endpoints are public, searchable, and paginated', async () => {
  const directory = await invoke(dealersHandler, { mode: 'legacy', page: '1', pageSize: '10', q: 'Forest' });
  assert.equal(directory.statusCode, 200);
  assert.equal(directory.payload.total, 1);
  assert.equal(directory.payload.dealers[0].legacy_profile_id, '9641');

  const profile = await invoke(dealerProfileHandler, { id: 'watchfacts-legacy-9641' });
  assert.equal(profile.statusCode, 200);
  assert.equal(profile.payload.dealer.display_name, 'Forest');
  assert.ok(profile.payload.listings.every(row => row.evidence_only === true));
  assert.equal(profile.payload.source_provenance.counts_are_historical_snapshots, true);
});

test('live legacy listing mapper preserves listing and poster evidence', () => {
  const mapped = dealerProfileHandler.mapLegacyLiveListing({
    id: 'listing-1', canonical_brand: 'Patek Philippe', normalized_reference: '5712/1A',
    verified_price_usd: 110000, source_price_amount: 850000, source_currency: 'HKD',
    source_price_text: '850000 HKD', listing_type: 'WTS', posting_date: '2026-08-11T00:00:00Z',
    raw_message: 'WTS Patek 5712/1A 850k HKD', user_image_url: 'https://images.example/item.jpg',
    seller_name: 'Forest', seller_phone: '15551234567', location: 'Hong Kong',
  });
  assert.equal(mapped.reference, '5712/1A');
  assert.equal(mapped.price_usd, 110000);
  assert.equal(mapped.currency, 'HKD');
  assert.equal(mapped.raw_message, 'WTS Patek 5712/1A 850k HKD');
  assert.equal(mapped.seller_name, 'Forest');
  assert.equal(mapped.evidence_only, false);
});

test('production lineage audit is read-only and exact-ID only', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'qnsa-legacy-profile-lineage-audit.yml'), 'utf8');
  assert.match(workflow, /qnsafosakvonzgfcsphh/);
  assert.match(workflow, /qnsa_rolex_patek_trading_floor_source/);
  assert.match(workflow, /dealer_id=\$encoded/);
  assert.match(workflow, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(workflow, /SUPABASE_ACCESS_TOKEN/);
  assert.doesNotMatch(workflow, /UPDATE |INSERT INTO|DELETE FROM/i);
});

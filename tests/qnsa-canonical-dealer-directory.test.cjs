'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260814203000_qnsa_canonical_dealer_directory.sql'), 'utf8');
const dealersApi = fs.readFileSync(path.join(root, 'api', 'dealers.js'), 'utf8');
const profileApi = fs.readFileSync(path.join(root, 'api', 'dealer-profile.js'), 'utf8');

test('canonical directory is private-by-default and exact-phone keyed', () => {
  for (const table of ['dealers', 'dealer_source_identities', 'dealer_directory_snapshots', 'dealer_reviews', 'dealer_group_memberships', 'dealer_listing_links']) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
  }
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_qnsa_dealer_verified_phone/);
  assert.match(migration, /normalize_seller_phone_identity\(source_identity\)/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/g);
  assert.match(migration, /REVOKE ALL ON public\.dealers/);
  assert.match(migration, /extensions\.digest/);
  assert.doesNotMatch(migration, /UPDATE\s+(?:raw|staging)\.|DELETE\s+FROM\s+(?:raw|staging)\.|INSERT\s+INTO\s+(?:raw|staging)\./i);
});

test('directory and profile APIs prefer the canonical QNSA contracts', () => {
  assert.match(dealersApi, /qnsa_dealer_directory_page/);
  assert.match(profileApi, /qnsa_dealer_profile/);
  assert.match(profileApi, /raw_message_access:\s*true/);
});

test('directory aggregation remains listing-linked and consent gates contact data', () => {
  assert.match(migration, /dealer_listing_links/);
  assert.match(migration, /count\(\*\) FILTER \(WHERE upper\(COALESCE\(l\.listing_type, l\.intent, ''\)\) = 'WTS'\)/);
  assert.match(migration, /'verified_phone', CASE WHEN d\.contact_consent THEN/);
  assert.match(migration, /raw_message/);
  assert.match(migration, /dealer_reviews/);
  assert.match(migration, /dealer_group_memberships/);
});

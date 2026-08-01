'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const api = require('../api/reviewed-seller-summary.js');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'api/reviewed-seller-summary.js'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260731160000_reviewed_workbook_market_indexes.sql'),
  'utf8',
);
const sellerMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260731170000_reviewed_workbook_seller_activity.sql'),
  'utf8',
);
const workflow = fs.readFileSync(
  path.join(root, '.github/workflows/reviewed-workbook-inventory-release.yml'),
  'utf8',
);

test('requires exact reviewed IDs and explicit approved phone evidence', () => {
  assert.equal(api.REVIEWED_ID.test(`workbook_${'a'.repeat(64)}`), true);
  assert.equal(api.REVIEWED_ID.test('wa_123'), false);
  assert.equal(api.approvedPhone({
    contact_publication_approved: true,
    phone_number: '+1 555 0100',
  }), '+1 555 0100');
  assert.equal(api.approvedPhone({
    contact_publication_approved: false,
    phone_number: '+1 555 0100',
  }), null);
  assert.equal(api.approvedPhone({
    contact_publication_approved: true,
    phone_number: '   ',
  }), null);
});

test('seller analytics query is exact, approved, read-only, and workbook-only', () => {
  assert.match(source, /\.from\('reviewed_workbook_inventory'\)/);
  assert.match(source, /\.rpc\('reviewed_workbook_seller_activity'/);
  assert.doesNotMatch(source, /watch_records/);
  assert.doesNotMatch(source, /\.(?:insert|upsert|update|delete)\s*\(/);
});

test('seller analytics reconcile WTS, WTB, and the exact remaining activity', async () => {
  const client = {
    rpc(name, params) {
      assert.equal(name, 'reviewed_workbook_seller_activity');
      assert.deepEqual(params, { p_phone: '+1 555 0100' });
      return Promise.resolve({
        data: [{
          total_posts: 8,
          wts_posts: 5,
          wtb_posts: 2,
          other_posts: 1,
          first_post_at: '2020-01-01T00:00:00Z',
          last_post_at: '2026-07-31T00:00:00Z',
        }],
        error: null,
      });
    },
  };

  assert.deepEqual(await api.loadSellerAnalytics(client, '+1 555 0100'), {
    total_posts: 8,
    wts_posts: 5,
    wtb_posts: 2,
    other_posts: 1,
    first_post_at: '2020-01-01T00:00:00Z',
    last_post_at: '2026-07-31T00:00:00Z',
  });
});

test('seller activity aggregate is exact, approved-contact only, and service-only', () => {
  assert.match(sellerMigration, /count\(\*\)::bigint AS total_posts/);
  assert.match(sellerMigration, /count\(\*\) FILTER \(WHERE listing_type = 'WTS'\)/);
  assert.match(sellerMigration, /contact_publication_approved IS TRUE/);
  assert.match(sellerMigration, /phone_number = p_phone/);
  assert.match(sellerMigration, /REVOKE ALL[\s\S]*FROM anon/);
  assert.match(sellerMigration, /REVOKE ALL[\s\S]*FROM authenticated/);
  assert.match(sellerMigration, /GRANT EXECUTE[\s\S]*TO service_role/);
  assert.doesNotMatch(sellerMigration, /watch_records/);
  assert.doesNotMatch(sellerMigration, /\b(?:INSERT|UPDATE|DELETE)\b/i);
});

test('market indexes are concurrent, partial, and transaction-free', () => {
  assert.doesNotMatch(migration, /\bBEGIN\b|\bCOMMIT\b/i);
  assert.match(migration, /SET lock_timeout = '2min'/);
  assert.match(migration, /CREATE INDEX CONCURRENTLY IF NOT EXISTS[\s\S]*idx_reviewed_workbook_inventory_approved_phone_activity[\s\S]*phone_number,[\s\S]*posting_date,[\s\S]*listing_type,[\s\S]*WHERE contact_publication_approved IS TRUE[\s\S]*phone_number IS NOT NULL/);
  assert.match(migration, /idx_reviewed_workbook_inventory_type_order[\s\S]*listing_type,[\s\S]*has_image DESC,[\s\S]*workbook_price_usd DESC NULLS LAST/);
  assert.match(migration, /idx_reviewed_workbook_inventory_brand_type_order[\s\S]*brand_scope,[\s\S]*listing_type,[\s\S]*has_image DESC/);
  assert.match(migration, /idx_reviewed_workbook_inventory_reference_order[\s\S]*normalized_reference,[\s\S]*has_image DESC/);
});

test('dedicated release workflow explicitly applies and verifies every new index', () => {
  assert.match(workflow, /allowlisted_migrations[\s\S]*20260731160000_reviewed_workbook_market_indexes\.sql/);
  assert.match(workflow, /allowlisted_migrations[\s\S]*20260731170000_reviewed_workbook_seller_activity\.sql/);
  assert.match(workflow, /timeout-minutes: 30/);
  assert.match(workflow, /SET lock_timeout = '30s'/);
  assert.match(workflow, /DROP INDEX IF EXISTS[\s\S]*indisvalid[\s\S]*indisready/);
  assert.doesNotMatch(workflow, /DROP INDEX CONCURRENTLY IF EXISTS/);
  for (const name of [
    'idx_reviewed_workbook_inventory_approved_phone_activity',
    'idx_reviewed_workbook_inventory_type_order',
    'idx_reviewed_workbook_inventory_brand_type_order',
    'idx_reviewed_workbook_inventory_reference_order',
  ]) {
    assert.match(workflow, new RegExp(name));
  }
  assert.match(workflow, /to_regprocedure\('public\.reviewed_workbook_seller_activity\(text\)'\)/);
  assert.match(workflow, /has_function_privilege\('service_role'[\s\S]*reviewed_workbook_seller_activity/);
});

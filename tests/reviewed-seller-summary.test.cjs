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
  assert.match(source, /count: 'exact', head: true/);
  assert.match(source, /\.eq\('contact_publication_approved', true\)/);
  assert.match(source, /\.eq\('phone_number', phone\)/);
  assert.match(source, /other_posts: Math\.max\(0, totalPosts - wtsPosts - wtbPosts\)/);
  assert.doesNotMatch(source, /watch_records/);
  assert.doesNotMatch(source, /\.(?:insert|upsert|update|delete)\s*\(/);
});

test('seller analytics reconcile WTS, WTB, and the exact remaining activity', async () => {
  const seen = [];
  const client = {
    from(table) {
      assert.equal(table, 'reviewed_workbook_inventory');
      const state = { type: null, dated: false, ascending: true, phone: null, approved: false };
      const builder = {
        select(columns, options) {
          state.dated = columns === 'posting_date,id';
          if (!state.dated) assert.deepEqual(options, { count: 'exact', head: true });
          return builder;
        },
        eq(field, value) {
          if (field === 'listing_type') state.type = value;
          if (field === 'phone_number') state.phone = value;
          if (field === 'contact_publication_approved') state.approved = value;
          return builder;
        },
        not() { return builder; },
        order(field, options) {
          if (field === 'posting_date') state.ascending = options.ascending;
          return builder;
        },
        limit() { return builder; },
        maybeSingle() {
          seen.push({ ...state });
          return Promise.resolve({
            data: { posting_date: state.ascending ? '2020-01-01T00:00:00Z' : '2026-07-31T00:00:00Z' },
            error: null,
          });
        },
        then(resolve, reject) {
          seen.push({ ...state });
          const counts = { WTS: 5, WTB: 2 };
          return Promise.resolve({ count: state.type ? counts[state.type] : 8, error: null })
            .then(resolve, reject);
        },
      };
      return builder;
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
  assert.equal(seen.length, 5);
  assert.ok(seen.every(query => query.phone === '+1 555 0100' && query.approved === true));
});

test('market indexes are concurrent, partial, and transaction-free', () => {
  assert.doesNotMatch(migration, /\bBEGIN\b|\bCOMMIT\b/i);
  assert.match(migration, /CREATE INDEX CONCURRENTLY IF NOT EXISTS[\s\S]*idx_reviewed_workbook_inventory_approved_phone_activity[\s\S]*phone_number,[\s\S]*posting_date,[\s\S]*listing_type,[\s\S]*WHERE contact_publication_approved IS TRUE[\s\S]*phone_number IS NOT NULL/);
  assert.match(migration, /idx_reviewed_workbook_inventory_type_order[\s\S]*listing_type,[\s\S]*has_image DESC,[\s\S]*workbook_price_usd DESC NULLS LAST/);
  assert.match(migration, /idx_reviewed_workbook_inventory_brand_type_order[\s\S]*brand_scope,[\s\S]*listing_type,[\s\S]*has_image DESC/);
  assert.match(migration, /idx_reviewed_workbook_inventory_reference_order[\s\S]*normalized_reference,[\s\S]*has_image DESC/);
});

test('dedicated release workflow explicitly applies and verifies every new index', () => {
  assert.match(workflow, /allowlisted_migrations[\s\S]*20260731160000_reviewed_workbook_market_indexes\.sql/);
  assert.match(workflow, /timeout-minutes: 120/);
  assert.match(workflow, /DROP INDEX CONCURRENTLY IF EXISTS[\s\S]*indisvalid[\s\S]*indisready/);
  for (const name of [
    'idx_reviewed_workbook_inventory_approved_phone_activity',
    'idx_reviewed_workbook_inventory_type_order',
    'idx_reviewed_workbook_inventory_brand_type_order',
    'idx_reviewed_workbook_inventory_reference_order',
  ]) {
    assert.match(workflow, new RegExp(name));
  }
});

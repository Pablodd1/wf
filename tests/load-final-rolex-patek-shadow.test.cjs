'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  API_ROOT,
  PROJECT_REF,
  TABLES,
  insertRows,
  parseCsvLine,
  reconciliationSql,
  restUrl,
  typedValue,
} = require('../tools/audit/load-final-rolex-patek-shadow.cjs');

test('CSV decoding preserves quoted source values and typed shadow fields', () => {
  assert.deepEqual(parseCsvLine('"Rolex","126334, blue","a""b",'),
    ['Rolex', '126334, blue', 'a"b', '']);
  assert.equal(typedValue('price_verified', 'true'), true);
  assert.equal(typedValue('normalized_usd_amount', '13500.25'), 13500.25);
  assert.equal(typedValue('source_currency', ''), null);
});

test('REST loader is pinned to canonical QNSA and shadow mutation allowlist', async () => {
  assert.equal(PROJECT_REF, 'qnsafosakvonzgfcsphh');
  assert.match(API_ROOT, /^https:\/\/qnsafosakvonzgfcsphh\.supabase\.co\/rest\/v1$/);
  assert.throws(() => restUrl('watch_records', 'id'), /not mutation-allowlisted/);
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 201, text: async () => '', headers: { get: () => null } };
  };
  await insertRows(TABLES.current.name, TABLES.current.conflict,
    [{ run_id: 'run', current_listing_key: 'listing' }], 'service-key', fetchImpl);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /curated_luxury_current_listings_shadow/);
  assert.equal(calls[0].options.headers.prefer, 'resolution=ignore-duplicates,return=minimal');
});

test('reconciliation requires exact frozen counts, both availability states, lineage and no duplicates', () => {
  const sql = reconciliationSql('17d6d831-86cd-5758-a830-c881bcf16e0d');
  assert.match(sql, /1535763,1386508,149255,38521/);
  assert.match(sql, /937001,884326,52675,45638/);
  assert.match(sql, /CURRENT_ACTIVE/);
  assert.match(sql, /CURRENT_LATEST_STATE/);
  assert.match(sql, /missing_lineage<>0/);
  assert.match(sql, /duplicate_rows<>0/);
  assert.doesNotMatch(sql, /watch_records|staging\.listings|raw_messages/);
});

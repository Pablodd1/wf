'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('three-brand customer cache adds Audemars without changing source rows', () => {
  const migration = read(
    'supabase/migrations/20260731010000_three_brand_reviewed_release_cache.sql',
  );
  assert.match(
    migration,
    /CREATE OR REPLACE VIEW public\.three_brand_verified_trading_release/,
  );
  assert.match(
    migration,
    /'rolex',[\s\S]*'patek philippe',[\s\S]*'audemars piguet'/,
  );
  assert.match(migration, /PARTITION BY repost_signature/);
  assert.match(migration, /ORDER BY has_images DESC, created_at DESC NULLS LAST, id DESC/);
  assert.match(migration, /shadow\.candidate_count > 1/);
  assert.match(migration, /duplicate\.status = 'SUPPRESSED'/);
  assert.match(migration, /CREATE MATERIALIZED VIEW IF NOT EXISTS[\s\S]*three_brand_verified_trading_release_cache/);
  assert.match(migration, /WITH NO DATA/);
  assert.match(
    migration,
    /GRANT SELECT ON public\.three_brand_verified_trading_release_cache[\s\S]*TO service_role/,
  );
  assert.doesNotMatch(
    migration,
    /(?:UPDATE|INSERT INTO|DELETE FROM)\s+(?:public\.)?watch_records/i,
  );
  assert.doesNotMatch(migration, /REFRESH MATERIALIZED VIEW/);
});

test('Trading Floor and live release counts use the same three-brand cache', () => {
  const ingest = read('api/ingest.js');
  const summary = read('api/live-release-summary.js');
  assert.match(ingest, /THREE_BRAND_RELEASE_CACHE === 'true'/);
  assert.match(ingest, /three_brand_verified_trading_release_cache/);
  assert.match(summary, /THREE_BRAND_RELEASE_CACHE === 'true'/);
  assert.match(summary, /three_brand_verified_trading_release_cache/);
  assert.match(summary, /\.from\(reviewedReleaseCache\)/);
});

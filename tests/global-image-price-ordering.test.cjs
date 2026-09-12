'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const api = require('../api/reviewed-market-inventory.js');
const migration = fs.readFileSync(path.join(
  root,
  'supabase',
  'migrations',
  '20260813090000_qnsa_global_image_price_ordering.sql',
), 'utf8');
const research = fs.readFileSync(path.join(root, 'src', 'pages', 'PriceResearch.tsx'), 'utf8');

test('bounded-page comparator ranks exact image then verified explicit price then date', () => {
  const records = [
    { id: '4', has_images: false, price_usd: null, created_at: '2026-08-13T04:00:00Z' },
    { id: '3', has_images: false, price_usd: 10_000, source_price_amount: 10_000,
      price_research_eligible: true, price_evidence_status: 'SOURCE_EXPLICIT_USD_MATCH', created_at: '2026-08-13T03:00:00Z' },
    { id: '2', has_images: true, price_usd: null, thumbnail_url: 'https://example.com/2.jpg',
      image_urls: ['https://example.com/2.jpg'], image_evidence_type: 'SOURCE_LISTING_IMAGE', created_at: '2026-08-13T02:00:00Z' },
    { id: '1', has_images: true, price_usd: 10_000, source_price_amount: 10_000,
      price_research_eligible: true, price_evidence_status: 'SOURCE_EXPLICIT_USD_MATCH',
      thumbnail_url: 'https://example.com/1.jpg', image_urls: ['https://example.com/1.jpg'],
      image_evidence_type: 'SOURCE_LISTING_IMAGE', created_at: '2026-08-13T01:00:00Z' },
    { id: '5', has_images: true, price_usd: 20_000, source_price_amount: 20_000,
      price_research_eligible: true, price_evidence_status: 'SOURCE_EXPLICIT_USD_MATCH',
      thumbnail_url: 'https://example.com/5.jpg', image_urls: ['https://example.com/5.jpg'],
      image_evidence_type: 'SOURCE_LISTING_IMAGE', created_at: '2026-08-12T01:00:00Z' },
  ];
  assert.deepEqual(records.sort(api.compareInventoryForDisplay).map(row => row.id), ['5', '1', '2', '3', '4']);
});

test('forward migration aligns every active QNSA Trading Floor RPC', () => {
  for (const functionName of [
    'qnsa_trading_floor_reference_rows',
    'qnsa_market_feed_page_rows',
  ]) {
    assert.match(migration, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${functionName}\\(`));
  }
  assert.doesNotMatch(migration, /qnsa_three_brand_trading_floor_fx_contract/,
    'the optional, undeployed FX sidecar must not be a migration dependency');
  const imageOrder = /btrim\(COALESCE\([^)]*image_url[^)]*source_media_url_candidate[^)]*\)\)[\s\S]{0,100}DESC/gi;
  assert.ok([...migration.matchAll(imageOrder)].length >= 5, 'all source scans must lead with exact source-image order');
  assert.match(migration, /created_at DESC,[\s\S]{0,30}(?:l\.|t\.)?id DESC/);
  assert.match(migration, /parent_id IS NULL/);
  assert.match(migration, /COALESCE\([^)]*is_bundle[^)]*false\) = false|NOT COALESCE\([^)]*is_bundle[^)]*false\)/);
  assert.match(migration, /bundle_child_pending_review/);
});

test('Price Research omits missing and failed image frames', () => {
  assert.doesNotMatch(research, /No image|Source listing image unavailable/);
  assert.match(research, /const showImage = Boolean\(imageUrl\) && !imageFailed/);
  assert.match(research, /onError=\{\(\) => setImageFailed\(true\)\}/);
  assert.match(research, /images\.length > 0 && \(/);
});

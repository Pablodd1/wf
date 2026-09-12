'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260828200000_unbundled_child_lineage_and_floor_order.sql'), 'utf8');
const ingest = fs.readFileSync(path.join(root, 'api', 'ingest.js'), 'utf8');
const trading = fs.readFileSync(path.join(root, 'src', 'pages', 'TradingFloor.tsx'), 'utf8');

test('stores explicit parent-child and exact-line evidence in staging and canonical rows', () => {
  for (const column of [
    'parent_source_id', 'source_child_id', 'source_child_index', 'raw_child_line',
    'price_evidence_scope', 'source_currency_evidence',
  ]) assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
  assert.match(migration, /FOREIGN KEY \(parent_source_id\) REFERENCES public\.watch_records\(id\)/);
  assert.match(migration, /UNIQUE INDEX[\s\S]*source_child_id/);
});

test('never assigns a parent price and keeps unpriced children off Price Research only', () => {
  assert.doesNotMatch(migration, /parent[^\n]*price_(?:raw|usd)/i);
  assert.match(migration, /NO_PRICE_EVIDENCE'[\s\S]*price_raw IS NOT NULL[\s\S]*price_usd IS NOT NULL[\s\S]*currency IS NOT NULL/);
  assert.match(migration, /true AS trading_floor_ready/);
  assert.match(migration, /price_usd IS NOT NULL[\s\S]*price_usd > 0[\s\S]*AS price_research_ready/);
});

test('Trading Floor uses the stable four-group display order', () => {
  assert.match(ingest, /has_display_price\.desc,has_source_image\.desc,price_usd\.desc\.nullslast,created_at\.desc\.nullslast,id\.desc/);
  assert.match(ingest, /if \(leftHasPrice !== rightHasPrice\)[\s\S]*if \(leftHasImage !== rightHasImage\)[\s\S]*if \(leftPrice !== rightPrice\)/);
  assert.match(trading, /Priced listings first; source images next; highest verified USD price within each group\./);
});

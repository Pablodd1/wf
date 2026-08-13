'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260813120000_qnsa_market_feed_count_snapshot.sql'), 'utf8');
const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/qnsa-market-feed-count-snapshot.yml'), 'utf8');
const inventory = fs.readFileSync(path.join(__dirname, '../api/reviewed-market-inventory.js'), 'utf8');
const bounded = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260813123000_qnsa_market_feed_count_bounded_refresh.sql'), 'utf8');

test('market counts are served from a small snapshot instead of a customer-time full scan', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.qnsa_market_feed_count_snapshot/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.refresh_qnsa_market_feed_counts/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.qnsa_market_feed_counts\(\)[\s\S]*FROM public\.qnsa_market_feed_count_snapshot/);
  assert.doesNotMatch(migration.match(/CREATE OR REPLACE FUNCTION public\.qnsa_market_feed_counts\(\)[\s\S]*?\$\$;/)?.[0] || '', /staging\.listings/);
});

test('snapshot refresh preserves the same customer publication exclusions', () => {
  assert.match(migration, /parent_id IS NULL/);
  assert.match(migration, /COALESCE\(l\.is_bundle, false\) = false/);
  assert.match(migration, /suppressed_exact_duplicate/);
  assert.match(migration, /upper\(COALESCE\(l\.listing_type, l\.intent, ''\)\) IN \('WTS', 'WTB'\)/);
  assert.match(migration, /raw_message_version_id IS NOT NULL/);
});

test('production workflow is pinned and verifies all three brands', () => {
  assert.match(workflow, /qnsafosakvonzgfcsphh/);
  assert.match(workflow, /REFRESH_QNSA_MARKET_COUNTS/);
  assert.match(workflow, /qnsa_market_feed_count_page/);
  assert.match(workflow, /'Rolex','Patek Philippe','Audemars Piguet'/);
  assert.match(workflow, /api\/live-release-summary/);
});

test('Trading Floor returns exact snapshot totals only for encoded filters', () => {
  assert.match(inventory, /client\.rpc\('qnsa_market_feed_counts'\)/);
  assert.match(inventory, /function snapshotInventoryTotal/);
  assert.match(inventory, /unsupported[\s\S]*filters\.search[\s\S]*filters\.postedAfter/);
  assert.match(inventory, /totalStatus: publicInventoryTotal === null \? 'withheld_for_unsupported_filter' : 'available_from_market_feed_counts'/);
});

test('production census is resumable and bounded below the statement timeout', () => {
  assert.match(bounded, /qnsa_market_feed_count_page/);
  assert.match(bounded, /p_limit integer DEFAULT 5000/);
  assert.match(bounded, /l\.id > p_after[\s\S]*ORDER BY l\.id ASC LIMIT p_limit/);
  assert.match(bounded, /replace_qnsa_market_feed_count_snapshot/);
  assert.match(workflow, /do \{[\s\S]*qnsa_market_feed_count_page[\s\S]*\} while \(\$pageRows -gt 0\)/);
  assert.match(workflow, /replace_qnsa_market_feed_count_snapshot/);
});

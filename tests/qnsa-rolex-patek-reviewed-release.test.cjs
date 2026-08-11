'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migration = fs.readFileSync(
  path.join(
    __dirname,
    '..',
    'supabase',
    'migrations',
    '20260811190000_qnsa_rolex_patek_reviewed_release.sql',
  ),
  'utf8',
);

test('release is fail-closed by default and records every switch change', () => {
  assert.match(migration, /trading_floor_enabled BOOLEAN NOT NULL DEFAULT false/);
  assert.match(migration, /price_research_enabled BOOLEAN NOT NULL DEFAULT false/);
  assert.match(migration, /'Rolex', false, false/);
  assert.match(migration, /'Patek Philippe', false, false/);
  assert.match(migration, /enabled_run_key IS NOT NULL/);
  assert.match(migration, /CREATE TRIGGER trg_audit_qnsa_two_brand_release_control/);
  assert.match(migration, /INSERT INTO public\.qnsa_two_brand_release_ledger/);
});

test('contract reads QNSA staging and immutable lineage, never legacy watch_records', () => {
  assert.match(migration, /FROM staging\.listings AS l/);
  assert.match(migration, /JOIN staging\.mariadb_normalization_import_checkpoints AS c/);
  assert.match(migration, /c\.status = 'NORMALIZATION_STAGED'/);
  assert.match(migration, /c\.error_rows = 0/);
  assert.match(migration, /l\.raw_message_version_id IS NOT NULL/);
  assert.match(migration, /l\.source_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(migration, /l\.source_candidate_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.doesNotMatch(migration, /(?:FROM|JOIN)\s+(?:public\.)?watch_records/i);
});

test('only canonical Rolex and Patek single watches enter the base release', () => {
  assert.match(migration, /l\.brand_normalized IN \('Rolex', 'Patek Philippe'\)/);
  assert.match(migration, /upper\(COALESCE\(l\.category, ''\)\) = 'WATCH'/);
  assert.match(migration, /l\.parent_id IS NULL/);
  assert.match(migration, /COALESCE\(l\.is_bundle, false\) = false/);
  assert.match(migration, /'SINGLE_CANDIDATE'/);
  assert.match(migration, /upper\(COALESCE\(l\.listing_type, l\.intent, ''\)\) IN \('WTS', 'WTB'\)/);
});

test('bundles, unresolved multis, duplicates and terminal states fail closed', () => {
  for (const state of [
    'bundle_child_pending_review',
    'bundle_pending_separation',
    'suppressed_exact_duplicate',
    'withdrawn',
    'rejected',
    'hidden',
    'deleted',
    'archived',
  ]) {
    assert.match(migration, new RegExp(`'${state}'`, 'i'));
  }
});

test('Trading Floor includes pending human review and no-price display', () => {
  const start = migration.indexOf('CREATE OR REPLACE VIEW public.qnsa_rolex_patek_trading_floor_source');
  const end = migration.indexOf('CREATE OR REPLACE VIEW public.qnsa_rolex_patek_price_research_source');
  const trading = migration.slice(start, end);
  assert.match(trading, /'Price not supplied'/);
  assert.match(trading, /'PENDING_REVIEW', 'APPROVED', 'READY_FOR_PUBLICATION_REVIEW'/);
  assert.match(trading, /'PENDING_VERIFICATION'/);
  const tradingWhere = trading.slice(trading.lastIndexOf('WHERE'));
  assert.doesNotMatch(tradingWhere, /price_usd\s*>\s*0/);
});

test('public contact remains consent-gated while seller analytics remain source-backed', () => {
  assert.match(migration, /CASE WHEN b\.contact_consent THEN COALESCE\(b\.contact_number, b\.from_number\) ELSE NULL END AS seller_phone/);
  assert.match(migration, /COALESCE\(b\.dealer_rating, b\.rating\) AS dealer_rating/);
  assert.match(migration, /b\.first_posted_at/);
  assert.match(migration, /b\.reposted_at AS latest_repost_at/);
  assert.match(migration, /b\.times_posted/);
  assert.doesNotMatch(migration, /COALESCE\(b\.dealer_rating, b\.rating, 5/);
});

test('Price Research admits priced WTS pending-review evidence only with explicit identity and currency', () => {
  const start = migration.indexOf('CREATE OR REPLACE VIEW public.qnsa_rolex_patek_price_research_source');
  const end = migration.indexOf('CREATE OR REPLACE VIEW public.qnsa_rolex_patek_wtb_demand_source');
  const research = migration.slice(start, end);
  assert.match(research, /b\.listing_type = 'WTS'/);
  assert.match(research, /b\.price_usd > 0/);
  assert.match(research, /b\.price_normalized > 0/);
  assert.match(research, /regexp_replace\(upper\(b\.raw_message_text\)/);
  assert.match(research, /regexp_replace\(upper\(b\.reference_normalized\)/);
  assert.match(research, /'explicit_line_currency'/);
  assert.match(research, /'section_context'/);
  assert.match(research, /'source_record_currency'/);
  assert.match(research, /'PROVISIONAL_PENDING_HUMAN_REVIEW'/);
  assert.doesNotMatch(research, /bare_dollar_unconfirmed/);
});

test('WTB demand is separate and cannot enter WTS observations', () => {
  const researchStart = migration.indexOf('CREATE OR REPLACE VIEW public.qnsa_rolex_patek_price_research_source');
  const demandStart = migration.indexOf('CREATE OR REPLACE VIEW public.qnsa_rolex_patek_wtb_demand_source');
  const analyticsStart = migration.indexOf('CREATE OR REPLACE VIEW public.qnsa_rolex_patek_price_analytics_evidence');
  const research = migration.slice(researchStart, demandStart);
  const demand = migration.slice(demandStart, analyticsStart);
  assert.match(research, /b\.listing_type = 'WTS'/);
  assert.doesNotMatch(research, /b\.listing_type = 'WTB'/);
  assert.match(demand, /b\.listing_type = 'WTB'/);
  assert.doesNotMatch(demand, /b\.price_usd > 0/);
});

test('release views retain the current API evidence and seller fields', () => {
  for (const field of [
    'source_file',
    'brand_scope',
    'catalog_reference',
    'catalog_dial',
    'reference_search_key',
    'publication_state',
    'publication_lane',
    'raw_lineage_verified',
  ]) {
    assert.match(migration, new RegExp(`AS ${field}`));
  }
  for (const field of [
    'flags',
    'seller_name',
    'seller_phone',
    'dealer_rating',
    'thumbnail_url',
    'image_urls',
    'has_images',
    'listing_status',
  ]) {
    assert.match(migration, new RegExp(`(?:AS )?${field}`));
  }
});

test('analytics uses exact dial cohorts, minimum two observations and auditable 3.0 IQR fences', () => {
  const start = migration.indexOf('CREATE OR REPLACE VIEW public.qnsa_rolex_patek_price_analytics_evidence');
  const analytics = migration.slice(start);
  assert.match(analytics, /COALESCE\(NULLIF\(btrim\(p\.dial_color\), ''\), 'Unspecified'\)/);
  assert.match(analytics, /percentile_cont\(0\.25\)/);
  assert.match(analytics, /percentile_cont\(0\.50\)/);
  assert.match(analytics, /percentile_cont\(0\.75\)/);
  assert.match(analytics, /s\.q1 - \(3\.0 \* \(s\.q3 - s\.q1\)\)/);
  assert.match(analytics, /s\.q3 \+ \(3\.0 \* \(s\.q3 - s\.q1\)\)/);
  assert.match(analytics, /greatest\(1000::numeric, round\(s\.median::numeric \* 0\.25\)\)/);
  assert.match(analytics, /f\.source_observation_count >= 2/);
  assert.match(analytics, /'INSUFFICIENT_MARKET_DATA'/);
  assert.match(analytics, /'BELOW_MARKET_PLAUSIBILITY_FLOOR'/);
  assert.match(analytics, /'BELOW_IQR_FENCE'/);
  assert.match(analytics, /'ABOVE_IQR_FENCE'/);
  assert.doesNotMatch(analytics, /DELETE FROM/i);
});

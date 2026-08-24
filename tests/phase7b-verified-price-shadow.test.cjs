'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  buildCatalog,
  catalogIndex,
  classifyObservation,
} = require('../tools/audit/phase7b-verified-price-shadow-worker.cjs');
const { build: buildReport } = require('../tools/audit/build-phase7b-verified-price-report.cjs');

const hash = char => char.repeat(64);
const catalog = catalogIndex(buildCatalog());

function row(overrides = {}) {
  return {
    listing_id: '11111111-1111-4111-8111-111111111111',
    source_record_id: 'mysql_auctions_phase7b-1',
    raw_message_version_id: '22222222-2222-4222-8222-222222222222',
    source_hash: hash('a'),
    source_candidate_hash: hash('b'),
    brand: 'Rolex',
    reference_normalized: '126334',
    intent: 'WTS',
    parent_id: null,
    is_bundle: false,
    bundle_status: 'SINGLE_CANDIDATE',
    price_original: 12500,
    currency_original: 'USD',
    price_usd: 12500,
    currency_evidence: 'explicit_line_currency',
    conversion_rate: 1,
    conversion_timestamp: null,
    conversion_source: 'SOURCE_USD_OR_USDT',
    price_research_status: 'eligible',
    raw_message: 'Rolex 126334 USD 12,500',
    ...overrides,
  };
}

test('admits only an exact immutable parser-v5 USD match', () => {
  const result = classifyObservation(row(), catalog);
  assert.equal(result.price_evidence_classification, 'VERIFIED_IN_NEW_COHORT');
  assert.equal(result.verified_usd_amount, 12500);
  assert.equal(result.source_currency, 'USD');
  assert.equal(result.source_span_text, 'USD 12,500');
  assert.match(result.source_span_sha256, /^[0-9a-f]{64}$/);
  assert.equal(result.exclusion_reason, null);
  assert.ok(!result.evidence_canonical.includes('source_span_text'));
});

test('preserves retired USD defaulting as excluded history', () => {
  const result = classifyObservation(row({
    currency_original: null,
    currency_evidence: 'usd_defaulted_by_policy',
    raw_message: 'Rolex 126334 asking 12,500',
  }), catalog);
  assert.equal(result.price_evidence_classification, 'LEGACY_USD_DEFAULTED');
  assert.equal(result.verified_usd_amount, null);
});

test('retains broken-lineage legacy observations as explicit exclusions', () => {
  const result = classifyObservation(row({ raw_message_version_id: null, raw_message: null }), catalog);
  assert.equal(result.price_evidence_classification, 'SOURCE_NOT_RECONCILABLE');
  assert.equal(result.exclusion_reason, 'INCOMPLETE_IMMUTABLE_LINEAGE');
  assert.equal(result.verified_usd_amount, null);
});

test('does not admit superseded or withdrawn legacy observations', () => {
  const result = classifyObservation(row({ price_research_status: 'superseded' }), catalog);
  assert.equal(result.price_evidence_classification, 'OTHER');
  assert.equal(result.exclusion_reason, 'NOT_CURRENT_AFTER_DEDUPLICATION_OR_PUBLICATION_CONTROLS');
});

test('does not select one amount from a multiple-price source', () => {
  const result = classifyObservation(row({
    raw_message: 'Rolex 126334 USD 12,500 or USD 12,000 wire',
  }), catalog);
  assert.equal(result.price_evidence_classification, 'MULTIPLE_PRICE_AMBIGUOUS');
});

test('requires canonical punctuation-sensitive Patek identity', () => {
  const result = classifyObservation(row({
    brand: 'Patek Philippe', reference_normalized: '5711',
    raw_message: 'Patek 5711 USD 100,000', price_original: 100000, price_usd: 100000,
  }), catalog);
  assert.ok(['REFERENCE_AMBIGUOUS', 'REFERENCE_INVALID'].includes(result.price_evidence_classification));
  assert.equal(result.canonical_reference, null);
});

test('rejects an exact source price that conflicts with normalized USD', () => {
  const result = classifyObservation(row({ price_usd: 15000 }), catalog);
  assert.equal(result.price_evidence_classification, 'SOURCE_PRICE_CONFLICT');
  assert.equal(result.verified_usd_amount, null);
});

test('rejects structured source price that conflicts with immutable evidence', () => {
  const result = classifyObservation(row({ price_original: 13000 }), catalog);
  assert.equal(result.price_evidence_classification, 'SOURCE_PRICE_CONFLICT');
  assert.equal(result.exclusion_reason, 'STRUCTURED_SOURCE_PRICE_OR_CURRENCY_CONFLICTS_WITH_IMMUTABLE_SOURCE');
});

test('foreign currency requires approved dated FX and exact arithmetic', () => {
  const verified = classifyObservation(row({
    price_original: 10000, currency_original: 'EUR', price_usd: 11664,
    conversion_rate: 1.1664, conversion_timestamp: '2026-08-24T00:00:00Z',
    conversion_source: 'European Central Bank reference rates',
    raw_message: 'Rolex 126334 EUR 10,000',
  }), catalog);
  assert.equal(verified.price_evidence_classification, 'VERIFIED_IN_NEW_COHORT');
  assert.equal(verified.fx_effective_date, '2026-08-24');

  const invalid = classifyObservation(row({
    price_original: 10000, currency_original: 'EUR', price_usd: 11664,
    conversion_rate: 1.1664, conversion_timestamp: '2026-08-24T00:00:00Z',
    conversion_source: 'UNAPPROVED_FIXED_RATE',
    raw_message: 'Rolex 126334 EUR 10,000',
  }), catalog);
  assert.equal(invalid.price_evidence_classification, 'FX_INVALID');
});

test('migration is private, parallel, bounded, and contains no source mutation', () => {
  const migration = fs.readFileSync(path.join(__dirname,
    '../supabase/migrations/20260824190000_phase7b_verified_price_research_shadow.sql'), 'utf8');
  const activeSql = migration.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(migration, /CREATE SCHEMA IF NOT EXISTS price_research_shadow/);
  assert.match(migration, /jsonb_array_length\(p_records\) NOT BETWEEN 1 AND 500/);
  assert.match(migration, /price-parser-v5-shadow/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.complete_phase7b_verified_price_shadow/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.materialize_phase7b_verified_reference/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.phase7b_verified_shadow_report/);
  assert.match(migration, /SET statement_timeout='45s'/);
  assert.match(migration, /q1-3\.0\*\(b\.q3-b\.q1\)/);
  assert.match(migration, /current_rating<>'NOT_RATED' AND verified_rating='NOT_RATED'/);
  assert.match(migration, /QNSA_GENERAL_MARKET_FEED_V1_SINGLE_WATCH_WTS_WTB/);
  assert.match(migration, /REVOKE ALL ON ALL TABLES IN SCHEMA price_research_shadow FROM PUBLIC, anon, authenticated/);
  assert.equal((activeSql.match(/CREATE OR REPLACE FUNCTION public\.complete_phase7b_verified_price_shadow/g) || []).length, 1);
  assert.doesNotMatch(migration, /UPDATE\s+staging\.listings/i);
  assert.doesNotMatch(migration, /UPDATE\s+public\.raw_message_versions/i);
  assert.doesNotMatch(migration, /CREATE OR REPLACE (VIEW|FUNCTION)\s+public\.(price_research|qnsa_market_feed_page_rows)/i);
});

test('report remains NOT_READY and UNKNOWN without a completed production run', () => {
  const built = buildReport({ catalog_sha256: hash('c'), report: {} }, '2026-08-24T00:00:00.000Z');
  assert.equal(built.decision, 'NOT_READY');
  assert.match(built.report, /Production counts remain \*\*UNKNOWN\*\*/);
  assert.equal(built.audit.production_mutations, 0);
  assert.equal(built.audit.customer_source_switches, 0);
});

test('completed report includes classification chart, census, controls, and canary decision', () => {
  const canaries = ['Rolex', 'Patek Philippe'].flatMap(brand => ['A', 'B', 'C'].map((reference, index) => ({
    brand, canonical_reference: reference, current_observation_count: 10 + index,
    verified_observation_count: 5 + index, median_delta_ratio: 0.1 + index / 100,
  })));
  const built = buildReport({
    catalog_sha256: hash('d'), completion: { status: 'COMPLETE', observations: 20, verified: 12,
      result_sha256: hash('e') }, query_benchmarks: [{ brand: 'Rolex', reference: 'A', elapsed_ms: 4.2 }],
    report: {
      run: { run_key: 'phase7b-test', status: 'COMPLETE', source_observation_count: 20,
        processed_observation_count: 20, verified_observation_count: 12, result_sha256: hash('e') },
      brand_summary: [
        { brand: 'Rolex', verified_observations: 7, total_legacy_pr_observations: 10 },
        { brand: 'Patek Philippe', verified_observations: 5, total_legacy_pr_observations: 10 },
      ],
      classification_counts: [
        { brand: 'Rolex', price_evidence_classification: 'VERIFIED_IN_NEW_COHORT', count: 7 },
        { brand: 'Patek Philippe', price_evidence_classification: 'VERIFIED_IN_NEW_COHORT', count: 5 },
      ],
      reference_census: [
        { brand: 'Rolex', canonical_reference: 'A', total_published_listings: 12, wts_listings: 8,
          wtb_listings: 4, priced_listings: 7, image_linked_listings: 10, legacy_pr_observations: 5,
          verified_pr_observations: 3, current_median: 100, verified_median: 90,
          current_analytics_ready: true, verified_analytics_ready: true },
      ], rating_impact: [{ brand: 'Rolex', impact_class: 'CHANGED', count: 2 }],
      extreme_evidence: [], proposed_canaries: canaries,
    },
  }, '2026-08-24T00:00:00.000Z');
  assert.equal(built.decision, 'CANARY_READY');
  assert.equal(built.artifact.manifest.charts[0].dataset, 'classification_mix');
  assert.match(built.report, /Total listings per reference/);
  assert.match(built.report, /NO CUSTOMER-FACING DATA SOURCE WAS SWITCHED/);
});

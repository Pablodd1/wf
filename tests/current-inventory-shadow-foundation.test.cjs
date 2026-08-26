'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  CONTRACT,
  compactObservation,
  dealerIdentitySql,
  partitionFor,
  run,
} = require('../tools/audit/current-inventory-shadow.cjs');

const root = path.resolve(__dirname, '..');

test('worker validation remains canonical, bounded, and read-only', async () => {
  const result = await run({ validateOnly: true });
  assert.equal(result.contract, CONTRACT);
  assert.equal(result.canonical_project_ref, 'qnsafosakvonzgfcsphh');
  assert.equal(result.read_only, true);
  assert.equal(result.production_writes, 0);
  assert.equal(result.database_concurrency, 1);
  assert.equal(result.validated_select_queries, 2);
  assert.match(dealerIdentitySql(), /^SELECT /);
  assert.doesNotMatch(dealerIdentitySql(), /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i);
});

test('compact observations keep lineage, verified USD, and no raw child text', () => {
  const result = compactObservation({
    occurrence: {
      classification: 'UNIQUE_MARKET_OBSERVATION',
      raw_occurrence_key: 'raw-1', unique_observation_key: 'unique-1',
      exact_child_text_sha256: 'exact-1', normalized_structural_text_sha256: 'struct-1',
      raw_child_text: 'Rolex 126334 blue dial USD 13500',
      exact_observed_reference: '126334', observed_reference_key: '126334',
      intent: 'WTS', source_price_text: 'USD 13500', source_price_amount: 13500,
      explicit_currency: 'USD', source_timestamp: '2026-08-01T00:00:00Z',
    },
    parent: { parent_key: 'parent-1', version_key: 'version-1', source_key: 'source-1' },
    artifactRecord: { brand: 'Rolex', disposition: {} },
    sourcePage: 'resume-pages/raw-00-000001.json.gz', origin: 'LIVE_SOURCE_RECHECK',
    dealer: null, sourceStatus: null, sourceImageKey: null,
    priceEvidenceClassification: 'AUTO_APPROVED', modelAsPosted: 'Datejust',
  });
  assert.equal(result.classification, 'UNIQUE_MARKET_OBSERVATION');
  assert.equal(result.row.normalized_usd_amount, 13500);
  assert.equal(result.row.usd_normalization_method, 'DIRECT_SOURCE_USD');
  assert.equal(result.row.raw_child_text, undefined);
  assert.equal(partitionFor(result.row.offer_family_key) >= 0, true);
  assert.equal(partitionFor(result.row.offer_family_key) < 256, true);
});

test('workflow has an isolated no-write shadow lane using both evidence artifacts', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/qnsa-disk-capacity-audit.yml'), 'utf8');
  assert.match(workflow, /current_inventory_v2_run_id:/);
  assert.match(workflow, /current_inventory_v3_run_id:/);
  assert.match(workflow, /RUN_QNSA_CURRENT_INVENTORY_SHADOW_V1/);
  assert.match(workflow, /PRIVATE-qnsa-raw-first-observation-v3-/);
  assert.match(workflow, /current-inventory-shadow\.cjs --validate-only/);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(workflow, /ref: codex\/rolex-patek-current-inventory-shadow/);
  assert.match(workflow, /production_source_switch/);
  assert.doesNotMatch(workflow.match(/current-inventory-shadow:[\s\S]*$/)?.[0] || '', /supabase\s+db\s+push|psql|curl[^\n]*database\/query/);
});

test('forward schema supports generic bounded server-side filtering without a source switch', () => {
  const file = path.join(root, 'supabase/migrations/20260825120000_curated_luxury_current_inventory_shadow_foundation.sql');
  const sql = fs.readFileSync(file, 'utf8');
  assert.match(sql, /curated_luxury_market_observations_shadow/);
  assert.match(sql, /curated_luxury_offer_states_shadow/);
  assert.match(sql, /curated_luxury_current_listings_shadow/);
  assert.match(sql, /curated_luxury_observed_references_shadow/);
  assert.match(sql, /cohort_status text NOT NULL CHECK \(cohort_status IN \('CONFIRMED_CURRENT', 'LATEST_OBSERVED'\)\)/);
  assert.match(sql, /current_status IN \('CURRENT_ACTIVE', 'CURRENT_LATEST_STATE'\)/);
  for (const key of ['unique_observation_key', 'parent_key', 'version_key', 'source_key',
    'exact_child_text_sha256', 'parent_raw_text_sha256', 'source_identity_key', 'source_image_key', 'dealer_key']) {
    assert.match(sql, new RegExp(`${key} text`));
  }
  assert.match(sql, /p_brands text\[\]/);
  assert.match(sql, /p_intents text\[\]/);
  assert.match(sql, /p_countries text\[\]/);
  assert.match(sql, /p_limit integer DEFAULT 50/);
  assert.match(sql, /LIMIT least\(greatest\(coalesce\(p_limit, 50\), 1\), 100\)/);
  assert.match(sql, /Does not switch the production Trading Floor source/);
});

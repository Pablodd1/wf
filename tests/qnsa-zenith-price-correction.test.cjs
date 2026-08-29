'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260814183000_qnsa_zenith_price_correction.sql'), 'utf8');
const compatibilityMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260814183500_qnsa_zenith_price_correction_schema_compatibility.sql'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/qnsa-zenith-price-correction.yml'), 'utf8');
const inventory = fs.readFileSync(path.join(root, 'api/reviewed-market-inventory.js'), 'utf8');

test('Zenith price correction updates exact existing lineage only', () => {
  assert.match(migration, /brand_normalized='Zenith'/);
  assert.match(migration, /provenance_metadata->>'bundle_status'='SINGLE_CANDIDATE'/);
  assert.match(migration, /JOIN public\.raw_message_versions rv[\s\S]*rv\.source_hash=l\.source_hash/);
  assert.doesNotMatch(migration, /(?:INSERT\s+INTO|DELETE\s+FROM)\s+staging\.listings/i);
  assert.doesNotMatch(migration, /(?:UPDATE|DELETE|INSERT\s+INTO)[\s\S]{0,60}public\.raw_message_versions/i);
});

test('Zenith correction uses dated ECB rates and the approved bare-number USD policy', () => {
  assert.match(migration, /wf-dated-fx-snapshot-v1/);
  assert.match(migration, /WHEN 'EUR' THEN v_eur_rate/);
  assert.match(migration, /WHEN 'HKD' THEN v_hkd_rate/);
  assert.match(migration, /USD_DEFAULTED_BY_POLICY/);
  assert.match(workflow, /fetch-fx-snapshot\.cjs/);
  assert.match(workflow, /npm ci --ignore-scripts[\s\S]*fetch-fx-snapshot\.cjs/);
  assert.match(workflow, /target_rows -ne 237/);
});

test('Zenith correction adds its audit timestamp without rewriting listing rows', () => {
  assert.match(compatibilityMigration, /ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ/);
  assert.doesNotMatch(compatibilityMigration, /DEFAULT\s+now\(\)/i);
  assert.doesNotMatch(compatibilityMigration, /UPDATE\s+staging\.listings/i);
  assert.match(workflow, /20260814183500_qnsa_zenith_price_correction_schema_compatibility\.sql/);
});

test('Zenith customer records derive a canonical model from the selected reference', () => {
  assert.match(inventory, /lookupCatalog\(sourceReference, brand\)/);
  assert.match(inventory, /catalogIdentity\?\.found \? catalogIdentity\.model/);
});

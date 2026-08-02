'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

test('source accountability ledger is service-only and cannot publish listings', () => {
  const migration = read('supabase/migrations/20260802160000_source_pipeline_accountability.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.source_pipeline_accountability/);
  assert.match(migration, /REVOKE ALL ON public\.source_pipeline_accountability FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE ON public\.source_pipeline_accountability TO service_role/);
  assert.match(migration, /customer_record_writes BIGINT NOT NULL DEFAULT 0/);
  assert.doesNotMatch(migration, /INSERT INTO public\.watch_records|UPDATE public\.watch_records|DELETE FROM public\.watch_records/i);
});
test('owner dashboard exposes incoming counts, errors, reconciliation and zero customer writes', () => {
  const api = read('api/admin-stats.js');
  const page = read('src/pages/AdminPage.tsx');
  assert.match(api, /telegram_ingest_shadow_events/);
  assert.match(api, /telegram_ingest_shadow_results/);
  assert.match(api, /source_pipeline_accountability/);
  assert.match(api, /processingErrors/);
  assert.match(api, /customerRecordWrites: 0/);
  assert.match(page, /Incoming source accountability/);
  assert.match(page, /Source reconciliation:/);
  assert.match(page, /normalization reconciliation:/);
  assert.match(page, /Customer writes from monitored shadow sources: 0/);
});

test('incident register defines root evidence and exact reconciliation outcomes', () => {
  const register = read('docs/DATA_QUALITY_INCIDENT_REGISTER_2026-08-02.md');
  const control = read('docs/CTO_CONTROL_CENTER.md');
  for (const id of ['DQ-001', 'DQ-002', 'DQ-003', 'DQ-004', 'DQ-005', 'DQ-006', 'DQ-007', 'DQ-008', 'DQ-009', 'DQ-010']) {
    assert.match(register, new RegExp(id));
  }
  assert.match(register, /source platform\/table \+ source ID/);
  assert.match(register, /source input must reconcile to raw plus collection errors/i);
  assert.match(control, /DATA_QUALITY_INCIDENT_REGISTER_2026-08-02\.md/);
});

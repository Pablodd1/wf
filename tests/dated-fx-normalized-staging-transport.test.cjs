'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { applyCurrencyPolicy } = require('../tools/shadow-reprocess/shadow-reprocess.cjs');
const { loadFxSnapshot } = require('../tools/mariadb-live/normalize-local.cjs');
const { fetchFxSnapshot } = require('../tools/mariadb-live/fetch-fx-snapshot.cjs');
const { extractPriceObservations } = require('../api/_lib/normalization-v4.cjs');

const migration = fs.readFileSync(path.join(
  __dirname,
  '..',
  'supabase',
  'migrations',
  '20260812010000_dated_fx_normalized_staging_transport.sql',
), 'utf8');

test('USD policy default is exact and retains explicit provenance', () => {
  const result = applyCurrencyPolicy({
    amount_original: 37000,
    currency_original: 'USD',
    amount_usd: 1,
    currency_evidence: 'usd_defaulted_by_policy',
  });
  assert.equal(result.amount_usd, 37000);
  assert.equal(result.conversion_rate, 1);
  assert.equal(result.conversion_timestamp, null);
  assert.equal(result.conversion_source, 'USD_DEFAULTED_BY_POLICY');
});

test('non-USD price fails closed without a dated named rate', () => {
  const result = applyCurrencyPolicy({
    amount_original: 298000,
    currency_original: 'HKD',
    amount_usd: 999999,
    currency_evidence: 'explicit_line_currency',
  });
  assert.equal(result.amount_usd, null);
  assert.equal(result.conversion_rate, null);
  assert.equal(result.conversion_timestamp, null);
  assert.equal(result.conversion_source, null);
});

test('dated named rate creates reproducible non-USD conversion', () => {
  const result = applyCurrencyPolicy({
    amount_original: 298000,
    currency_original: 'HKD',
    currency_evidence: 'explicit_line_currency',
  }, {
    observed_at: '2026-08-11T00:00:00Z',
    source: 'ECB_REFERENCE_RATE',
    usd_per_unit: { HKD: 0.128205 },
  });
  assert.equal(result.amount_usd, 38205);
  assert.equal(result.conversion_rate, 0.128205);
  assert.equal(result.conversion_timestamp, '2026-08-11T00:00:00Z');
  assert.equal(result.conversion_source, 'ECB_REFERENCE_RATE');
});

test('historical parser canonicalizes HKN, HNK, RMB, and JPY codes', () => {
  assert.equal(extractPriceObservations('298000 HKN')[0].currency_original, 'HKD');
  assert.equal(extractPriceObservations('305k HNK')[0].currency_original, 'HKD');
  assert.equal(extractPriceObservations('500000 RMB')[0].currency_original, 'CNY');
  assert.equal(extractPriceObservations('4200000 JPY')[0].currency_original, 'JPY');
});

test('FX snapshot loader rejects an undated or malformed snapshot', () => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'wf-fx-'));
  try {
    const file = path.join(root, 'rates.json');
    fs.writeFileSync(file, JSON.stringify({ source: 'test', usd_per_unit: { HKD: 0.12 } }));
    assert.throws(() => loadFxSnapshot(file), /observed_at/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('forward migration validates and preserves conversion provenance atomically', () => {
  assert.match(migration, /ingest_mariadb_normalization_batch_v2/);
  assert.match(migration, /conversion_source TEXT/);
  assert.match(migration, /conversion_timestamp IS NULL/);
  assert.match(migration, /abs\(amount_usd - round\(amount_original \* conversion_rate\)\)/);
  assert.match(migration, /USD_DEFAULTED_BY_POLICY/);
  assert.match(migration, /public\.ingest_mariadb_normalization_batch\(/);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+public\.watch_records/i);
});

test('two-brand correction updates exact existing lineage without duplicate staging rows', () => {
  assert.match(migration, /apply_mariadb_two_brand_price_policy_batch/);
  assert.match(migration, /brand NOT IN \('Rolex', 'Patek Philippe'\)/);
  assert.match(migration, /listing\.source_hash = input\.source_hash/);
  assert.match(migration, /listing\.reference_normalized = input\.reference/);
  assert.match(migration, /mariadb_price_policy_correction_audit/);
  assert.match(migration, /'duplicate_staging_rows_created', 0/);
  assert.doesNotMatch(migration, /INSERT INTO staging\.listings/i);
});

test('ECB snapshot is converted into USD-per-unit rates with a dated source', async () => {
  const csv = [
    'TIME_PERIOD,CURRENCY,OBS_VALUE',
    '2026-08-10,USD,1.20',
    '2026-08-10,HKD,9.36',
    '2026-08-10,CNY,8.64',
    '2026-08-10,JPY,176.40',
  ].join('\n');
  const snapshot = await fetchFxSnapshot({
    now: new Date('2026-08-11T12:00:00Z'),
    fetchImpl: async () => ({ ok: true, text: async () => csv }),
  });
  assert.equal(snapshot.observed_at, '2026-08-10T00:00:00Z');
  assert.equal(snapshot.source, 'European Central Bank reference rates');
  assert.ok(Math.abs(snapshot.usd_per_unit.HKD - (1 / 7.8)) < 1e-9);
  assert.ok(Math.abs(snapshot.usd_per_unit.CNY - (1 / 7.2)) < 1e-9);
  assert.ok(Math.abs(snapshot.usd_per_unit.JPY - (1 / 147)) < 1e-9);
});

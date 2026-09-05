'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const migration = fs.readFileSync(
  'supabase/migrations/20260725010000_harden_staging_and_market_contract.sql',
  'utf8'
);
const ledgerWorkflow = fs.readFileSync(
  '.github/workflows/supabase-migration-ledger-reconcile.yml',
  'utf8'
);

test('forward repair makes watch staging private', () => {
  assert.match(migration, /ALTER TABLE public\.watch_staging ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON public\.watch_staging FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT ALL ON public\.watch_staging TO service_role/);
});

test('market view has an explicit customer-safe column contract', () => {
  assert.doesNotMatch(migration, /SELECT \*/);
  assert.match(migration, /listing_type IN \('WTS', 'WTB', 'NTQ'\)/);
  assert.match(migration, /price_usd >= 1000/);
  assert.doesNotMatch(migration, /raw_message/);
});

test('ledger evidence matches Trading Floor and Price Research ownership', () => {
  const marketCheck = ledgerWorkflow.match(
    /\('20260722120000',[\s\S]*?'strict publication view and identity\/price\/intent gates'\)/
  )?.[0] || '';
  assert.doesNotMatch(marketCheck, /catalog_confirmed/);
  assert.match(marketCheck, /dial_color/);
});

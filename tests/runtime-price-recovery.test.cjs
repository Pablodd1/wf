'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { explicitObservation, recoverObservation, recoverRecordPrices } = require('../api/_lib/runtime-price-recovery.cjs');

test('recovers only explicit currency evidence and never promotes a bare dollar token', async () => {
  assert.equal(explicitObservation('RM11 complete set $150,000'), null);
  const rows = await recoverRecordPrices([
    { id: 'usd', raw_message: 'RM11-01 153000 USDT', price_usd: null },
    { id: 'bare', raw_message: 'RM11 complete set $150,000', price_usd: null },
  ]);
  assert.equal(rows[0].price_usd, 153000);
  assert.equal(rows[0].source_currency, 'USDT');
  assert.equal(rows[0].price_evidence_status, 'SOURCE_EXPLICIT_USD_MATCH');
  assert.equal(rows[1].price_usd, null);
});

test('converts explicit non-USD evidence only with a dated named snapshot', () => {
  const observation = explicitObservation('RM11-01 1.187M HKD');
  assert.equal(recoverObservation(observation, null), null);
  const recovered = recoverObservation(observation, {
    observed_at: '2026-08-13T00:00:00Z',
    source: 'European Central Bank reference rates',
    usd_per_unit: { HKD: 0.128 },
  });
  assert.equal(recovered.price_usd, 151936);
  assert.equal(recovered.source_currency, 'HKD');
  assert.equal(recovered.fx_date, '2026-08-13T00:00:00Z');
});

test('leaves existing verified prices unchanged', async () => {
  const [row] = await recoverRecordPrices([{ raw_message: 'RM11 200000 USDT', price_usd: 190000 }]);
  assert.equal(row.price_usd, 190000);
  assert.equal(row.runtime_price_recovery_applied, undefined);
});

test('does not reintroduce a USD amount held by workbook price review', async () => {
  const [row] = await recoverRecordPrices([{
    raw_message: '116500LN black, watch + card, $25,1 + label',
    price_usd: null,
    price_raw: 251,
    source_price_amount: 251,
    source_currency: 'USD',
    workbook_price_review_reason: 'WORKBOOK_PRICE_BELOW_PUBLIC_PLAUSIBILITY',
  }]);
  assert.equal(row.price_usd, null);
  assert.equal(row.price_raw, 251, 'raw source evidence remains available for review');
  assert.equal(row.runtime_price_recovery_applied, undefined);
});

test('never reintroduces a reference token that an earlier safety gate rejected as price', async () => {
  const [row] = await recoverRecordPrices([{
    id: 'rm-reference-token',
    reference: 'RM001',
    raw_message: 'NTQ/ RM 001',
    price_usd: 0,
    price_raw: 1,
    currency: 'MYR',
    source_price_amount: 1,
    source_price_text: 'RM 001',
    source_currency: 'MYR',
    price_evidence_status: 'PRICE_NOT_SUPPLIED',
  }], {
    snapshot: {
      observed_at: '2026-08-13T00:00:00Z',
      source: 'European Central Bank reference rates',
      usd_per_unit: { MYR: 0.24 },
    },
  });

  assert.equal(row.price_usd, null);
  assert.equal(row.price_raw, null);
  assert.equal(row.currency, null);
  assert.equal(row.source_price_amount, null);
  assert.equal(row.source_currency, null);
  assert.equal(row.price_evidence_status, 'REFERENCE_TOKEN_AS_PRICE');
  assert.equal(row.runtime_price_recovery_applied, false);
});

test('preserves a genuine MYR amount for an RM reference', async () => {
  const [row] = await recoverRecordPrices([{
    reference: 'RM001',
    raw_message: 'RM001 asking MYR 500,000',
    price_usd: null,
    price_raw: 500000,
    currency: 'MYR',
    source_price_amount: 500000,
    source_currency: 'MYR',
  }], {
    snapshot: {
      observed_at: '2026-08-13T00:00:00Z',
      source: 'European Central Bank reference rates',
      usd_per_unit: { MYR: 0.24 },
    },
  });

  assert.equal(row.price_usd, 120000);
  assert.equal(row.source_price_amount, 500000);
  assert.equal(row.source_currency, 'MYR');
  assert.equal(row.runtime_price_recovery_applied, true);
  assert.equal(row.price_evidence_status, 'EXPLICIT_SOURCE_FX_CONVERTED');
});

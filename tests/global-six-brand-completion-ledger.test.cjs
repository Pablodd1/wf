'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { build, groupTradingRows } = require('../tools/audit/build-global-six-brand-completion-ledgers.cjs');

test('global ledger keeps listing counts independent from Price Research qualification', () => {
  const groups = groupTradingRows([
    { id: 'one', brand: 'Rolex', reference: '126000', listing_type: 'WTS', seller_name: 'Dealer A', price_usd: 7000 },
    { id: 'two', brand: 'Rolex', reference: '126000', listing_type: 'WTB', posted_by: 'Buyer B' },
  ]);
  const row = groups.get('ROLEX|126000');
  assert.equal(row.trading_floor_listings, 2);
  assert.equal(row.trading_floor_wts, 1);
  assert.equal(row.trading_floor_wtb, 1);
  assert.equal(row.linked_posting_identities, 2);
});

test('generic dealer placeholders never count as resolved posting identities', () => {
  const groups = groupTradingRows([
    { brand: 'Cartier', reference: 'WSSA0018', listing_type: 'WTS', seller_name: 'Source dealer' },
    { brand: 'Cartier', reference: 'WSSA0018', listing_type: 'WTB', posted_by: 'Actual Poster' },
  ]);
  const row = groups.get('CARTIER|WSSA0018');
  assert.equal(row.linked_posting_identities, 1);
  assert.equal(row.missing_posting_identities, 1);
});

test('incomplete snapshots fail closed and preserve unknown Price Research fields', () => {
  const built = build({ priceReport: {}, tradingReport: {}, tradingCheckpoint: {} });
  assert.equal(built.summary.snapshot_complete, false);
  assert.equal(built.summary.deployment_authorized, false);
  assert.equal(built.summary.safety.raw_messages_modified, 0);
  assert.equal(built.brandLedgers.Rolex.deployment_decision, 'NOT_READY');
  assert.ok(built.brandLedgers.Rolex.references.length > 0);
  assert.equal(built.brandLedgers.Rolex.references[0].price_research_source_observations, null);
  assert.equal(JSON.stringify(built).includes('"raw_message":'), false);
});

test('missing source-backed posting identity blocks a completed brand gate', () => {
  const built = build({
    priceReport: {
      snapshot_complete: true,
      coverage_accounting_reconciles: true,
      customer_api_writes: 0,
      rows: [{ key: 'ROLEX|126000', brand: 'Rolex', model: 'Oyster Perpetual', reference: '126000' }],
      brand_summary: [{ brand: 'Rolex' }],
    },
    tradingReport: {
      snapshot_complete: true,
      customer_api_writes: 0,
      brand_summary: [{ brand: 'Rolex', duplicate_ids: 0, released_references_outside_catalog: 0, missing_dealer_or_seller: 1 }],
    },
    tradingCheckpoint: { brand_state: { Rolex: { rows: [{ brand: 'Rolex', reference: '126000', listing_type: 'WTS' }] } } },
  });
  assert.equal(built.brandLedgers.Rolex.acceptance_gates.posting_identity_resolved, false);
  assert.equal(built.brandLedgers.Rolex.deployment_decision, 'NOT_READY');
  assert.equal(built.brandLedgers.Rolex.references[0].completion_status, 'REVIEW_REQUIRED');
});

test('a partial run still freezes every discovered canonical reference in the ledgers', () => {
  const built = build({
    priceReport: {},
    priceCheckpoint: {
      catalog_references: [
        { key: 'TUDOR|A', brand: 'Tudor', model: 'Model A', reference: 'A' },
        { key: 'TUDOR|B', brand: 'Tudor', model: 'Model B', reference: 'B' },
      ],
    },
    tradingReport: {},
    tradingCheckpoint: {},
  });
  assert.equal(built.brandLedgers.Tudor.catalog_reference_count, 2);
  assert.equal(built.brandLedgers.Tudor.references[1].price_research_source_observations, null);
  assert.equal(built.brandLedgers.Tudor.references[1].completion_status, 'AUDIT_INCOMPLETE');
});

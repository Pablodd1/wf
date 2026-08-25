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
  assert.equal(row.resolved_posting_identities, 2);
});

test('generic dealer placeholders never count as resolved posting identities', () => {
  const groups = groupTradingRows([
    { brand: 'Cartier', reference: 'WSSA0018', listing_type: 'WTS', seller_name: 'Source dealer' },
    { brand: 'Cartier', reference: 'WSSA0018', listing_type: 'WTB', posted_by: 'Actual Poster' },
    { brand: 'Cartier', reference: 'WSSA0018', listing_type: 'WTS', seller_name: 'Seller' },
    { brand: 'Cartier', reference: 'WSSA0018', listing_type: 'WTS', seller_phone: '+1 212 555 0100' },
  ]);
  const row = groups.get('CARTIER|WSSA0018');
  assert.equal(row.resolved_posting_identities, 1);
  assert.equal(row.dealer_identity_review_required, 3);
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
  assert.equal(built.brandLedgers.Rolex.references[0].dealer_identity_status, 'DEALER_IDENTITY_REVIEW_REQUIRED');
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

test('every brand ledger separates canonical, production, exact, unresolved, partial and invalid references', () => {
  const built = build({
    priceReport: {
      snapshot_complete: false,
      rows: [],
    },
    priceCheckpoint: {
      catalog_references: [
        { key: 'ROLEX|126000', brand: 'Rolex', model: 'Oyster Perpetual', reference: '126000' },
        { key: 'ROLEX|126500LN', brand: 'Rolex', model: 'Cosmograph Daytona', reference: '126500LN' },
      ],
    },
    tradingReport: { snapshot_complete: false },
    tradingCheckpoint: {
      brand_state: {
        Rolex: {
          complete: true,
          rows: [
            { brand: 'Rolex', reference: '126000', seller_name: 'Dealer A' },
            { brand: 'Rolex', reference: '1265', seller_name: 'Dealer B' },
            { brand: 'Rolex', reference: 'BRACELET', reference_invalid_reason: 'COMPONENT', seller_name: 'Dealer C' },
            { brand: 'Rolex', reference: 'FREE TEXT', seller_name: 'Dealer D' },
          ],
        },
      },
    },
  });
  const ledger = built.brandLedgers.Rolex;
  assert.equal(ledger.catalog_reference_count, 2);
  assert.equal(ledger.customer_safe_canonical_reference_count, 2);
  assert.equal(ledger.production_reference_value_count, 4);
  assert.equal(ledger.exact_published_reference_count, 1);
  assert.equal(ledger.partial_reference_count, 1);
  assert.equal(ledger.invalid_reference_count, 1);
  assert.equal(ledger.unresolved_reference_count, 1);
  for (const brandLedger of Object.values(built.brandLedgers)) {
    assert.equal(brandLedger.deployment_decision, 'NOT_READY');
  }
});

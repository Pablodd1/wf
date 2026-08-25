'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  build,
  groupTradingRows,
  passesCustomerPublicationSafety,
} = require('../tools/audit/build-global-six-brand-completion-ledgers.cjs');
const { build: buildTechnicalReport } = require('../tools/audit/build-global-six-brand-technical-report.cjs');

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

test('customer publication safety excludes review, pending, multi-listing and unresolved dealer rows', () => {
  assert.equal(passesCustomerPublicationSafety({ listing_type: 'WTS', seller_name: 'Dealer A' }), true);
  assert.equal(passesCustomerPublicationSafety({ listing_type: 'WTS', seller_name: 'Dealer A', data_quality_review_required: true }), false);
  assert.equal(passesCustomerPublicationSafety({ listing_type: 'WTS', seller_name: 'Dealer A', publication_state: 'PENDING_VERIFICATION' }), false);
  assert.equal(passesCustomerPublicationSafety({ listing_type: 'WTS', seller_name: 'Dealer A', multi_listing: true }), false);
  assert.equal(passesCustomerPublicationSafety({ listing_type: 'WTS', seller_name: 'Source poster' }), false);
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
            { brand: 'Rolex', reference: '126000', listing_type: 'WTS', seller_name: 'Dealer A' },
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
  assert.equal(ledger.catalog_nonconflicting_reference_count, 2);
  assert.equal(ledger.customer_safe_canonical_reference_count, 1);
  assert.equal(ledger.observed_customer_safe_canonical_reference_count, 1);
  assert.equal(ledger.production_reference_value_count, 4);
  assert.equal(ledger.exact_published_reference_count, 1);
  assert.equal(ledger.partial_reference_count, 1);
  assert.equal(ledger.invalid_reference_count, 1);
  assert.equal(ledger.unresolved_reference_count, 1);
  for (const brandLedger of Object.values(built.brandLedgers)) {
    assert.equal(brandLedger.deployment_decision, 'NOT_READY');
  }
});

test('incomplete production snapshot keeps authoritative customer-safe count null', () => {
  const built = build({
    priceReport: {},
    priceCheckpoint: {
      catalog_references: [
        { key: 'ROLEX|126000', brand: 'Rolex', model: 'Oyster Perpetual', reference: '126000' },
      ],
    },
    tradingReport: { snapshot_complete: false },
    tradingCheckpoint: {
      brand_state: {
        Rolex: {
          complete: false,
          rows: [{ brand: 'Rolex', reference: '126000', listing_type: 'WTS', seller_name: 'Dealer A' }],
        },
      },
    },
  });
  const ledger = built.brandLedgers.Rolex;
  assert.equal(ledger.catalog_reference_count, 1);
  assert.equal(ledger.catalog_nonconflicting_reference_count, 1);
  assert.equal(ledger.customer_safe_canonical_reference_count, null);
  assert.equal(ledger.observed_customer_safe_canonical_reference_count, 1);
  assert.equal(built.summary.customer_safe_canonical_reference_counts.Rolex, null);
  assert.equal(built.summary.observed_customer_safe_canonical_reference_counts.Rolex, 1);
  assert.equal(ledger.deployment_decision, 'NOT_READY');
});

test('technical report preserves catalog, nonconflicting, authoritative and observed semantics', () => {
  const artifact = buildTechnicalReport({
    observed_at: '2026-08-25T00:00:00Z',
    contract: 'test',
    brands: [{
      brand: 'Rolex', catalog_references: 303, trading_floor_listings: null,
      price_research_qualified_wts: null, analytics_ready_references: null,
      decision: 'NOT_READY', blockers: [],
    }],
  }, {
    snapshot_complete: false,
    catalog_nonconflicting_reference_counts: { Rolex: 300 },
    customer_safe_canonical_reference_counts: { Rolex: null },
    observed_customer_safe_canonical_reference_counts: { Rolex: 12 },
  });
  const row = artifact.snapshot.datasets.brand_status[0];
  assert.equal(row.catalog_references, 303);
  assert.equal(row.catalog_nonconflicting_reference_count, 300);
  assert.equal(row.customer_safe_canonical_reference_count, null);
  assert.equal(row.observed_customer_safe_canonical_reference_count, 12);
});

test('completed Phase 7B populates Rolex and Patek without confusing Price Research representation with publication', () => {
  const phase7bAudit = {
    phase: '7B',
    complete: true,
    run_key: 'phase7b-rolex-patek-verified-20260824-v1',
    decision: 'CANARY_READY',
    generated_at: '2026-08-25T11:21:53.935Z',
    result_sha256: 'result',
    catalog_sha256: 'catalog',
    verified_observations: { Rolex: 1, 'Patek Philippe': 0 },
    customer_safe_reference_counts: { Rolex: 2, 'Patek Philippe': 0 },
    represented_customer_safe_reference_counts: { Rolex: 1, 'Patek Philippe': 0 },
    production_mutations: 0,
    customer_source_switches: 0,
    ui_changes: 0,
  };
  const phase7bArtifact = { manifest: { datasets: {
    classification_mix: [
      { brand: 'Rolex', classification: 'VERIFIED_IN_NEW_COHORT', count: 1, verified: true },
      { brand: 'Rolex', classification: 'REFERENCE_INVALID', count: 2, verified: false },
    ],
    reference_census: [
      {
        brand: 'Rolex', canonical_model: 'Oyster Perpetual', canonical_reference: '126000',
        total_published_listings: 2, wts_listings: 1, wtb_listings: 1, priced_listings: 1,
        image_linked_listings: 2, legacy_pr_observations: 1, verified_pr_observations: 1,
        current_qualified_comparable_count: 1, verified_qualified_comparable_count: 1,
        current_analytics_ready: false, verified_analytics_ready: false, census_sha256: 'one',
      },
      {
        brand: 'Rolex', canonical_model: 'Cosmograph Daytona', canonical_reference: '126500LN',
        total_published_listings: 1, wts_listings: 0, wtb_listings: 1, priced_listings: 0,
        image_linked_listings: 1, legacy_pr_observations: 0, verified_pr_observations: 0,
        current_qualified_comparable_count: 0, verified_qualified_comparable_count: 0,
        current_analytics_ready: false, verified_analytics_ready: false, census_sha256: 'two',
      },
    ],
  } } };
  const built = build({ priceReport: {}, tradingReport: {}, tradingCheckpoint: {}, phase7bAudit, phase7bArtifact });
  const ledger = built.brandLedgers.Rolex;
  assert.equal(ledger.customer_safe_canonical_reference_count, 2);
  assert.equal(ledger.exact_published_reference_count, 2);
  assert.equal(ledger.phase7b_verified_shadow.represented_customer_safe_reference_count, 1);
  assert.equal(ledger.phase7b_verified_shadow.published_customer_safe_reference_count, 2);
  assert.equal(ledger.references.find(row => row.canonical_reference === '126000').trading_floor_listings, 2);
  assert.equal(ledger.references.find(row => row.canonical_reference === '126000').resolved_posting_identities, null);
  assert.equal(ledger.references.find(row => row.canonical_reference === '126000').dealer_identity_status,
    'NOT_AUDITED_BY_PHASE7B');
  assert.equal(ledger.references.find(row => row.canonical_reference === '126500LN').price_research_source_observations, 0);
  assert.equal(ledger.deployment_decision, 'NOT_READY');
  assert.equal(built.summary.deployment_authorized, false);
  const report = buildTechnicalReport({
    observed_at: '2026-08-25T11:21:53.935Z',
    contract: 'test',
    brands: [
      { brand: 'Rolex', catalog_references: 2, trading_floor_listings: null, wts: null, wtb: null,
        price_research_qualified_wts: null, analytics_ready_references: null, decision: 'NOT_READY',
        blockers: ['Canonical QNSA management authentication most recently returned HTTP 401'] },
      { brand: 'Patek Philippe', catalog_references: 0, trading_floor_listings: null, wts: null, wtb: null,
        price_research_qualified_wts: null, analytics_ready_references: null, decision: 'NOT_READY', blockers: [] },
    ],
  }, built.summary);
  assert.equal(report.snapshot.datasets.brand_status[0].trading_floor_listings, 3);
  assert.equal(report.snapshot.accessIssues.some(issue => issue.code === 'CANONICAL_QNSA_MANAGEMENT_AUTH'), false);
  assert.match(report.manifest.sources.find(source => source.id === 'qnsa_phase7b_gate').href, /32839980179$/);
});

test('authoritative catalog census overrides incomplete local fallback counts consistently', () => {
  const catalogReconciliation = {
    catalog_reconciliation_complete: true,
    authoritative_catalog: [
      { brand: 'Tudor', model: 'Black Bay', reference: 'A' },
      { brand: 'Tudor', model: 'Pelagos', reference: 'B' },
    ],
    brand_summary: [{
      brand: 'Tudor',
      authoritative_catalog_reference_count: 2,
      approved_local_canonical_reference_count: 1,
      deployed_price_research_catalog_reference_count: 2,
      exact_local_deployed_overlap: 1,
      local_only_references: 0,
      deployed_only_references: 1,
      observed_catalog_universe_count: 3,
      exact_published_reference_count: 1,
      observed_exact_published_reference_count: 1,
      published_population_snapshot_complete: true,
      published_partial_count: 1,
      published_component_count: 0,
      published_invalid_count: 0,
      published_unresolved_count: 0,
    }],
    checksums: { authoritative_catalog_sha256: 'catalog-census' },
  };
  const built = build({ priceReport: {}, tradingReport: {}, tradingCheckpoint: {}, catalogReconciliation });
  const ledger = built.brandLedgers.Tudor;
  assert.equal(ledger.catalog_reference_count, 2);
  assert.equal(ledger.catalog_nonconflicting_reference_count, 2);
  assert.equal(ledger.references.length, 2);
  assert.equal(ledger.exact_published_reference_count, 1);
  assert.equal(ledger.reference_population.approved_local_canonical_reference_count, 1);
  assert.equal(built.summary.catalog_reference_counts.Tudor, 2);
  assert.equal(built.summary.source_checksums.catalog_census_authoritative_sha256, 'catalog-census');
  assert.equal(ledger.deployment_decision, 'NOT_READY');
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  LEGACY_WORKBOOK_COLUMNS,
  isMissingColumnError,
  loadReviewedWorkbookEvidenceRows,
  loadReviewedWorkbookAnalyticsRows,
  mapWorkbookAnalyticsRow,
} = require('../api/_lib/reviewed-workbook-analytics.cjs');

test('maps only supplied reviewed-workbook evidence into the analytics contract', () => {
  const row = mapWorkbookAnalyticsRow({
    id: 'row-1',
    source_file: 'reviewed.xlsx',
    source_row_number: 42,
    source_record_id: 'source-42',
    posting_date: '2026-07-01',
    raw_message: 'Patek 5712/1A blue USD 120000',
    listing_type: 'WTS',
    brand_scope: 'Patek Philippe',
    supplied_brand: 'Patek Philippe',
    model: 'Nautilus',
    normalized_reference: '5712/1A',
    dial_color: 'Blue',
    source_price_amount: 120000,
    source_currency: 'USD',
    verified_price_usd: 120000,
    has_verified_usd_price: true,
    has_exact_source_image: true,
    user_image_url: 'https://example.test/source.jpg',
  });

  assert.equal(row.brand, 'Patek Philippe');
  assert.equal(row.model, 'Nautilus');
  assert.equal(row.reference, '5712/1A');
  assert.equal(row.dial_color, 'Blue');
  assert.equal(row.price_usd, 120000);
  assert.equal(row.analytics_currency_status, 'VERIFIED');
  assert.equal(row.owner_reviewed_identity, true);
  assert.deepEqual(row.image_urls, ['https://example.test/source.jpg']);
});

test('never promotes an unverified workbook amount into USD analytics', () => {
  const row = mapWorkbookAnalyticsRow({
    id: 'row-unverified',
    brand_scope: 'Patek Philippe',
    model: 'Nautilus',
    normalized_reference: '5712',
    dial_color: 'Blue',
    workbook_price_usd: 100000,
    source_price_amount: 100000,
    source_currency: null,
    has_verified_usd_price: false,
    verified_price_usd: null,
    posted_by: 'Legacy Seller',
    phone_number: '+15551234567',
  });
  assert.equal(row.price_usd, null);
  assert.equal(row.analytics_currency_status, 'CURRENCY_UNVERIFIED');
  assert.equal(row.seller_name, 'Legacy Seller');
  assert.equal(row.seller_phone, null);
  assert.equal(row.contact_publication_approved, false);
});

test('requires the verified-price flag even when a USD value is populated', () => {
  const row = mapWorkbookAnalyticsRow({
    verified_price_usd: 120000,
    has_verified_usd_price: false,
  });
  assert.equal(row.price_usd, null);
  assert.equal(row.has_verified_usd_price, false);
  assert.equal(row.analytics_currency_status, 'CURRENCY_UNVERIFIED');
});

test('qualified sidecar price becomes the effective WTS analytics price with audit provenance', () => {
  const row = mapWorkbookAnalyticsRow({
    id: 'row-corrected', listing_type: 'WTS', brand_scope: 'Rolex',
    normalized_reference: '116500LN', model: 'Daytona', dial_color: 'Black',
    source_price_amount: 298000, source_currency: 'HKD',
    verified_price_usd: null, has_verified_usd_price: false,
    corrected_price_usd: 38205, corrected_source_amount: 298000,
    corrected_source_currency: 'HKD', corrected_fx_rate: 0.128205,
    corrected_fx_source: 'ECB_REFERENCE_RATES', corrected_fx_date: '2026-08-11',
    price_correction_status: 'QUALIFIED', price_correction_id: 'sidecar-row-1',
    price_correction_key: 'three-brand-v1',
  });
  assert.equal(row.price_usd, 38205);
  assert.equal(row.has_verified_usd_price, true);
  assert.equal(row.effective_price_source, 'SIDECAR_CORRECTION');
  assert.equal(row.price_correction_applied, true);
  assert.equal(row.analytics_fx_source, 'ECB_REFERENCE_RATES');
});

test('Price Research prefers verified reviewed-workbook cohorts and keeps legacy fallback', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'price-research.js'), 'utf8');
  assert.match(source, /loadReviewedWorkbookEvidenceRows/);
  assert.match(source, /const usingReviewedWorkbook = preloadedReviewedWorkbookEvidenceRows\.length > 0/);
  assert.match(source, /const exactReviewedWorkbookRelease = preloadedReviewedWorkbookEvidenceRows\.length > 0/);
  assert.match(source, /!exactReviewedWorkbookRelease && !isPublicationBrandAllowed\(brand\)/);
  assert.match(source, /!exactReviewedWorkbookRelease && !isPublicationReferenceAllowed\(brand, rawRef\)/);
  assert.match(source, /if \(usingReviewedWorkbook\) \{\s*rows = reviewedWorkbookRows/);
  assert.match(source, /reviewed workbook analytics unavailable; using legacy cohort/);
  assert.match(source, /analytics_source: usingReviewedWorkbook/);
});

test('reviewed workbook loader requires complete identity and explicit verified USD', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'api', '_lib', 'reviewed-workbook-analytics.cjs'),
    'utf8',
  );
  assert.match(source, /eq\('has_complete_identity', true\)/);
  assert.match(source, /eq\('has_verified_usd_price', true\)/);
  assert.match(source, /eq\('listing_type', 'WTS'\)/);
  const legacyColumns = source.slice(source.indexOf('const WORKBOOK_COLUMNS'), source.indexOf('const ADMISSION_WORKBOOK_COLUMNS'));
  assert.doesNotMatch(legacyColumns, /workbook_price_usd/);
  assert.match(source, /ADMISSION_WORKBOOK_COLUMNS[\s\S]*workbook_price_usd/);
  assert.match(source, /LEGACY_WORKBOOK_COLUMNS/);
  assert.match(source, /posted_by,phone_number/);
});

test('reviewed workbook analytics uses the indexed exact reference column', async () => {
  const calls = [];
  const query = {
    select(value) { calls.push(['select', value]); return this; },
    eq(column, value) { calls.push(['eq', column, value]); return this; },
    in(column, value) { calls.push(['in', column, value]); return this; },
    neq(column, value) { calls.push(['neq', column, value]); return this; },
    not(column, operator, value) { calls.push(['not', column, operator, value]); return this; },
    order(column, options) { calls.push(['order', column, options]); return this; },
    async limit(value) { calls.push(['limit', value]); return { data: [], error: null }; },
  };
  const client = {
    from(view) { calls.push(['from', view]); return query; },
  };

  const rows = await loadReviewedWorkbookAnalyticsRows(client, {
    brand: 'Patek Philippe',
    references: ['5712/1A', '5712/1A-001', '5712/1A', ''],
    limit: 250,
  });

  assert.deepEqual(rows, []);
  assert.deepEqual(
    calls.find(call => call[0] === 'in'),
    ['in', 'normalized_reference', ['5712/1A', '5712/1A-001']],
  );
  assert.equal(calls.some(call => call[1] === 'reference_search_key'), false);
  assert.deepEqual(calls.find(call => call[0] === 'eq' && call[1] === 'brand_scope'), ['eq', 'brand_scope', 'Patek Philippe']);
  assert.deepEqual(calls.find(call => call[0] === 'limit'), ['limit', 250]);
});

test('reviewed workbook evidence loads approved WTS and WTB without promoting unverified prices', async () => {
  const calls = [];
  const query = {
    select(value) { calls.push(['select', value]); return this; },
    eq(column, value) { calls.push(['eq', column, value]); return this; },
    in(column, value) { calls.push(['in', column, value]); return this; },
    order(column, options) { calls.push(['order', column, options]); return this; },
    async limit(value) {
      calls.push(['limit', value]);
      return { data: [
        { id: 'sale', brand_scope: 'Breguet', normalized_reference: '7097BB', listing_type: 'WTS', verification_status: 'APPROVED_SINGLE_CANDIDATE', confidence: 100, raw_message: 'Breguet 7097BB available', source_price_amount: 50000 },
        { id: 'demand', brand_scope: 'Breguet', normalized_reference: '7097BB', listing_type: 'WTB', verification_status: 'APPROVED_SINGLE_CANDIDATE', confidence: 100, raw_message: 'WTB Breguet 7097BB' },
      ], error: null };
    },
  };
  const rows = await loadReviewedWorkbookEvidenceRows({ from(view) { calls.push(['from', view]); return query; } }, {
    brand: 'Breguet', references: ['7097BB'], limit: 100,
  });
  assert.deepEqual(rows.map(row => row.listing_type), ['WTS', 'WTB']);
  assert.equal(rows[0].price_usd, null);
  assert.deepEqual(calls.find(call => call[0] === 'in' && call[1] === 'listing_type'), ['in', 'listing_type', ['WTS', 'WTB']]);
  assert.equal(calls.some(call => call[1] === 'price_evidence_status'), false);
});

test('Price Research passes exact catalog reference variants to the indexed workbook loader', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'price-research.js'), 'utf8');
  assert.match(source, /const preloadReferences = \[\.\.\.new Set\(\[rawRef, \.\.\.listEquivalentReferences\(rawRef, brand\)\]\)\]/);
  assert.match(source, /loadReviewedWorkbookEvidenceRows\(client, \{\s*brand,\s*references: preloadReferences/);
  assert.match(source, /loadReviewedWorkbookEvidenceRows\(client, \{\s*brand, references: referenceVariants/);
  assert.doesNotMatch(source, /referenceKeys:/);
});

test('verified exact-reference WTS lookup has a matching forward-only index', () => {
  const migration = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20260810045000_reviewed_workbook_verified_reference_analytics.sql',
    ),
    'utf8',
  );
  assert.match(migration, /CREATE INDEX CONCURRENTLY IF NOT EXISTS/);
  assert.match(migration, /brand_scope[\s\S]*regexp_replace[\s\S]*normalized_reference/);
  assert.match(migration, /posting_date DESC NULLS LAST[\s\S]*id/);
  assert.match(migration, /WHERE listing_type = 'WTS'/);
  assert.match(migration, /price_evidence_status = 'SOURCE_EXPLICIT_USD_MATCH'/);
  assert.match(migration, /workbook_price_usd > 0/);
  assert.doesNotMatch(migration, /UPDATE|DELETE|TRUNCATE|DROP TABLE/i);
});

test('legacy column fallback is narrow and recognizes Postgres missing-column errors', () => {
  assert.match(LEGACY_WORKBOOK_COLUMNS, /posted_by,phone_number/);
  assert.doesNotMatch(LEGACY_WORKBOOK_COLUMNS, /seller_name|seller_phone|,verdict|listing_status/);
  assert.equal(isMissingColumnError({ code: '42703', message: 'column unavailable' }), true);
  assert.equal(isMissingColumnError({ code: 'PGRST204', message: 'column seller_name does not exist' }), true);
  assert.equal(isMissingColumnError({ code: 'PGRST301', message: 'permission denied' }), false);
});

test('Price Research listing detail supports the same reviewed workbook evidence', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'price-research-listing.js'), 'utf8');
  assert.match(source, /loadReviewedWorkbookListing/);
  assert.match(source, /price_evidence_status: 'SOURCE_EXPLICIT_USD_MATCH'/);
  assert.match(source, /image_provenance: workbookListing\.has_images \? 'source_supplied' : 'none'/);
  const loader = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'reviewed-workbook-analytics.cjs'), 'utf8');
  const detailBranch = loader.slice(loader.indexOf("startsWith('admission_')"), loader.indexOf('const executeListingQuery'));
  assert.match(detailBranch, /in\('listing_type', \['WTS', 'WTB'\]\)/);
  assert.doesNotMatch(detailBranch, /price_evidence_status|workbook_price_usd/);
});

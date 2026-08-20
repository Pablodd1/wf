'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const inventory = require('../api/reviewed-market-inventory.js');
const inventorySource = fs.readFileSync(path.join(root, 'api/reviewed-market-inventory.js'), 'utf8');
const floorSource = fs.readFileSync(path.join(root, 'src/pages/TradingFloor.tsx'), 'utf8');
const modelsSource = fs.readFileSync(path.join(root, 'api/catalog-models.js'), 'utf8');
const controlledSql = fs.readFileSync(path.join(root,
  'supabase/migrations/20260820170000_qnsa_controlled_model_browse.sql'), 'utf8');
const zenithSql = fs.readFileSync(path.join(root,
  'supabase/migrations/20260820171000_qnsa_zenith_model_browse.sql'), 'utf8');
const workflow = fs.readFileSync(path.join(root,
  '.github/workflows/qnsa-four-brand-model-filter-schema.yml'), 'utf8');

test('Trading Floor binds brand-selected model filters to the server cursor', () => {
  assert.match(floorSource, /searchParams\.get\('model'\)/);
  assert.match(floorSource, /params\.set\('model', modelFilter\)/);
  assert.match(floorSource, /api\/catalog-models\?brand=/);
  assert.match(floorSource, /id="model-filter"/);
  assert.match(inventorySource, /req\.query\?\.model/);
  assert.match(inventorySource, /qnsa_controlled_model_page_rows/);
  assert.match(inventorySource, /qnsa_zenith_model_page_rows/);
});

test('controlled model SQL filters the indexed manifest then verifies intent and lineage before paging', () => {
  assert.match(controlledSql, /idx_qnsa_omega_manifest_run_model_order/);
  assert.match(controlledSql, /idx_qnsa_cartier_manifest_run_model_order/);
  assert.match(controlledSql, /manifest_rows AS MATERIALIZED/);
  const pageFunction = controlledSql.indexOf('CREATE OR REPLACE FUNCTION public.qnsa_controlled_model_page_rows');
  assert.ok(controlledSql.indexOf('JOIN staging.listings l', pageFunction)
    < controlledSql.indexOf('LIMIT LEAST', pageFunction));
  assert.match(controlledSql, /upper\(COALESCE\(l\.listing_type, l\.intent, ''\)\)/);
  assert.match(controlledSql, /source_hash = m\.source_hash/);
  assert.match(controlledSql, /source_candidate_hash = m\.source_candidate_hash/);
  assert.match(controlledSql, /REVOKE ALL[\s\S]*FROM PUBLIC, anon, authenticated/);
});

test('Zenith model browsing is bounded to catalog references and exact release rows', () => {
  assert.match(zenithSql, /LIMIT 50/);
  assert.match(zenithSql, /qnsa_zenith_reference_rows/);
  assert.match(zenithSql, /LIMIT LEAST\(GREATEST\(COALESCE\(p_limit, 51\), 1\), 101\)/);
  assert.match(zenithSql, /REVOKE ALL[\s\S]*FROM PUBLIC, anon, authenticated/);
});

test('model schema workflow is manual, QNSA-pinned, checksum-bound, and DML-free', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /qnsafosakvonzgfcsphh/);
  assert.match(workflow, /9ab36c398b40967bba4e8548f57383f9455534743e150bcc011cd6b5a5fbfac3/);
  assert.match(workflow, /2c58a2bbc915cf23323c31165bf21d01de2bc69c8e1cb66d84e6ba9f4a2e2f20/);
  assert.match(workflow, /inventory DML/);
  assert.match(workflow, /ROLLBACK;/);
  assert.match(workflow, /inventory_writes.*0/);
});

test('owner-assumed Cartier price displays and rates but stays outside averages', () => {
  const mapped = inventory.mapReviewedRecord({
    id: 'cartier-owner-price',
    source_record_id: 'cartier-owner-price',
    posting_date: '2026-08-20T00:00:00.000Z',
    raw_message: 'WTS Cartier WSSA0037 6500',
    listing_type: 'WTS',
    item_category: 'WATCH',
    brand_scope: 'Cartier', supplied_brand: 'Cartier', canonical_brand: 'Cartier',
    model: 'Santos de Cartier', catalog_model: 'Santos de Cartier',
    raw_reference: 'WSSA0037', normalized_reference: 'WSSA0037', public_reference: 'WSSA0037',
    dial_color: 'Blue', condition: 'New',
    workbook_price_usd: 6500, source_price_amount: 6500,
    price_evidence_status: 'OWNER_ASSUMED_USD_CANDIDATE',
    has_verified_usd_price: false, verified_price_usd: null,
    confidence: 100, verification_status: 'APPROVED_SINGLE_CANDIDATE',
    dealer_id: '11111111-1111-4111-8111-111111111111',
  });
  assert.equal(mapped.price_usd, 6500);
  assert.equal(mapped.price_evidence_status, 'OWNER_ASSUMED_USD');
  assert.equal(mapped.price_research_eligible, false);
  assert.equal(mapped.source_dealer_id, '11111111-1111-4111-8111-111111111111');
});

test('Tudor models are served from the exact controlled release manifest', () => {
  assert.match(modelsSource, /brand\.toLowerCase\(\) === 'tudor'/);
  assert.match(modelsSource, /qnsa_tudor_reference_index/);
  assert.match(modelsSource, /EXACT_RELEASE_MANIFEST/);
  assert.ok(!inventory.publicationBrandsFromSummary({ brands: [], count_snapshot_available: false })
    .includes('Tudor'));
});

test('image rendering remains exact-source only', () => {
  assert.match(floorSource, /SELLER_LISTING_IMAGE', 'SOURCE_LISTING_IMAGE', 'SOURCE_LINKED_IMAGE/);
  assert.doesNotMatch(floorSource, /REFERENCE_IMAGE', 'SELLER_LISTING_IMAGE/);
});

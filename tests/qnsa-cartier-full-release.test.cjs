'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const release = require('../tools/intake/release-qnsa-cartier.cjs');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations',
  '20260820150000_qnsa_cartier_full_release.sql'), 'utf8');
const performanceMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations',
  '20260820153000_qnsa_cartier_release_rpc_performance.sql'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows',
  'qnsa-cartier-release.yml'), 'utf8');
const inventory = fs.readFileSync(path.join(root, 'api', 'reviewed-market-inventory.js'), 'utf8');
const research = fs.readFileSync(path.join(root, 'api', 'price-research.js'), 'utf8');
const catalogReferences = require('../api/catalog-references.js');

test('release is exact, Cartier-only, private, and reversible', () => {
  assert.equal(release.PROJECT_REF, 'qnsafosakvonzgfcsphh');
  assert.equal(release.EXPECTED_COUNT, 7154);
  assert.equal(release.EXPECTED_PLAN_SHA256,
    'e9daa59f7a058d5fa503cc549cdbbf50182ef28a0009e7531ca0a4139d815369');
  assert.match(migration, /l\.brand_normalized = 'Cartier'/);
  assert.match(migration, /l\.parent_id IS NULL AND COALESCE\(l\.is_bundle, false\) = false/);
  assert.match(migration, /QNSA_CARTIER_RELEASE_V1/);
  assert.match(migration, /user_image_url', NULL/);
  assert.match(migration, /contact_publication_approved', false/);
  assert.doesNotMatch(migration, /original_timestamp/);
  assert.match(migration, /'posting_date', s\.created_at/);
  assert.match(migration, /'raw_reference', CASE WHEN s\.public_reference IS NOT NULL THEN s\.reference_original ELSE NULL END/);
  assert.match(migration, /REFERENCE_PRICE_COLLISION_WITHHELD/);
  assert.match(migration, /'catalog_reference_confirmed', s\.catalog_reference_confirmed/);
  assert.match(migration, /'verified_price_usd', CASE WHEN NOT s\.reference_price_collision/);
  assert.match(migration, /ALTER TABLE public\.qnsa_cartier_release_manifest ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(migration, /(?:INSERT|UPDATE|DELETE)[\s\S]{0,80}(?:public\.dealers|dealer_reviews|dealer_group_memberships)/i);
});
test('workflow is manual, serialized, QNSA pinned, and uses env-safe inputs', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /SUPABASE_PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.match(workflow, /APPLY_QNSA_CARTIER_CANARY/);
  assert.match(workflow, /APPLY_QNSA_CARTIER_FULL/);
  assert.match(workflow, /ROLLBACK_QNSA_CARTIER_RELEASE/);
  assert.doesNotMatch(workflow, /run: \|[\s\S]*['"]\$\{\{\s*inputs\./);
  assert.doesNotMatch(workflow, /jobs:[\s\S]{0,400}\benv:\s*\n\s+SUPABASE_ACCESS_TOKEN:/);
});

test('database diagnostics are bounded and redact bearer credentials', () => {
  const source = fs.readFileSync(path.join(root, 'tools', 'intake',
    'release-qnsa-cartier.cjs'), 'utf8');
  assert.match(source, /replace\(\/Bearer\\s\+\\S\+\/gi, 'Bearer \[REDACTED\]'\)/);
  assert.match(source, /slice\(0, 300\)/);
  assert.doesNotMatch(source, /throw new Error\(`QNSA database query failed[^`]*\$\{raw\}/);
});

test('canary selects at most ten and covers deterministic intent, price, and identity lanes', () => {
  const rows = [
    ['WTS','SOURCE_EXPLICIT_USD_USDT','CATALOG_CARTIER_REFERENCE'],
    ['WTS','OWNER_ASSUMED_USD_CANDIDATE','SOURCE_CARTIER_IDENTITY'],
    ['WTS','NAMED_FOREIGN_REQUIRES_DATED_FX','CATALOG_CARTIER_REFERENCE'],
    ['WTS','PRICE_NOT_SUPPLIED','SOURCE_CARTIER_IDENTITY'],
    ['WTB','WTB_PRICE_WITHHELD','CATALOG_CARTIER_REFERENCE'],
    ...Array.from({ length: 10 }, () => ['WTS','SOURCE_EXPLICIT_USD_USDT','CATALOG_CARTIER_REFERENCE']),
  ].map((values, index) => ({ listing_id: `id-${index}`, listing_type: values[0],
    price_lane: values[1], identity_source: values[2], catalog_reference_confirmed: values[2].startsWith('CATALOG') }));
  const selected = release.selectCanary(rows);
  assert.equal(selected.length, 10);
  assert.ok(selected.some(row => row.listing_type === 'WTB'));
  assert.ok(selected.some(row => row.price_lane === 'OWNER_ASSUMED_USD_CANDIDATE'));
  assert.ok(selected.some(row => row.price_lane === 'NAMED_FOREIGN_REQUIRES_DATED_FX'));
  assert.ok(selected.some(row => row.identity_source === 'SOURCE_CARTIER_IDENTITY'));
});

test('Trading Floor and Price Research route Cartier through exact release RPCs', () => {
  assert.match(inventory, /qnsa_cartier_page_rows/);
  assert.match(inventory, /qnsa_cartier_release_count/);
  assert.match(inventory, /brand === 'Cartier'/);
  assert.match(research, /qnsa_cartier_reference_rows/);
  assert.match(research, /'vacheron constantin'/);
  assert.match(research, /canonical_qnsa_price_evidence_checked: true/);
  assert.match(migration, /qnsa_cartier_reference_index/);
});

test('Cartier customer RPCs page the release manifest before staging and index without staging scans', () => {
  assert.match(performanceMigration, /WITH manifest_page AS MATERIALIZED/);
  assert.match(performanceMigration, /FROM manifest_page m\s+JOIN staging\.listings l/);
  assert.match(performanceMigration, /LIMIT LEAST[\s\S]*OFFSET GREATEST[\s\S]*\), selected AS MATERIALIZED/);
  assert.match(performanceMigration, /CREATE OR REPLACE FUNCTION public\.qnsa_cartier_reference_index/);
  const indexBody = performanceMigration.split('CREATE OR REPLACE FUNCTION public.qnsa_cartier_reference_index')[1];
  assert.doesNotMatch(indexBody, /JOIN staging\.listings/);
  assert.match(performanceMigration, /m\.listing_type = upper\(p_listing_type\)/);
  const releaseSource = fs.readFileSync(path.join(root, 'tools', 'intake',
    'release-qnsa-cartier.cjs'), 'utf8');
  assert.match(releaseSource, /20260820153000_qnsa_cartier_release_rpc_performance\.sql/);
  assert.match(releaseSource, /price_lane text, listing_type text/);
});

test('Cartier reference picker merges catalog and exact source-proven release references', () => {
  const merged = catalogReferences.mergeVacheronReleaseReferences(
    [{ reference: 'WSSA0018' }],
    [
      { reference: 'WSSA0018', listing_count: 8, wts_count: 6,
        wtb_count: 2, priced_wts_count: 4, catalog_reference_confirmed: true },
      { reference: 'SOURCE-123', listing_count: 3, wts_count: 2,
        wtb_count: 1, priced_wts_count: 1, catalog_reference_confirmed: false },
      { reference: 'SOURCE/123', listing_count: 2, wts_count: 1,
        wtb_count: 1, priced_wts_count: 1, catalog_reference_confirmed: false },
      { reference: null, listing_count: 2, wts_count: 2,
        wtb_count: 0, priced_wts_count: 1, catalog_reference_confirmed: false },
    ],
  );
  assert.equal(merged.references.length, 2);
  assert.deepEqual(merged.references.map(row => [row.reference, row.listing_count]), [
    ['WSSA0018', 8], ['SOURCE-123', 5],
  ]);
  assert.equal(merged.references[1].identity_source, 'SOURCE_PROVEN_RELEASE_REFERENCE');
  assert.equal(merged.unresolvedReferenceListingCount, 2);
  assert.equal(merged.unresolvedReferencePricedWtsCount, 1);
});

test('Trading Floor unwraps table-valued Cartier RPC rows before publication gates', () => {
  const inventoryModule = require('../api/reviewed-market-inventory.js');
  const listing = {
    id: 'cartier-canary',
    listing_type: 'WTS',
    canonical_brand: 'Cartier',
    model: 'Cartier',
  };
  assert.deepEqual(inventoryModule.unwrapRpcRowData([{ row_data: listing }]), [listing]);
  assert.deepEqual(inventoryModule.unwrapRpcRowData([listing]), [listing]);
  assert.deepEqual(inventoryModule.unwrapRpcRowData(null), []);
  assert.match(inventory, /const sourceRows = unwrapRpcRowData\(data\)/);
});

test('controlled Cartier pages retain their manifest offset instead of a zeroed six-brand cursor', () => {
  assert.match(inventory, /const sixBrandKeysetCursor = sixBrandBroadScope && !controlledBrandRelease/);
  assert.match(inventory, /brandKeysets: sixBrandKeysetCursor/);
  assert.match(inventory, /brandScope: sixBrandKeysetCursor \? sixBrandScope : null/);
  assert.match(inventory, /!sixBrandBroadScope \|\| controlledBrandRelease/);
});

test('candidate query preserves source lineage and does not infer parent or image evidence', () => {
  const sql = release.candidateSql(release.catalogReferenceKeys());
  assert.match(sql, /source_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(sql, /source_candidate_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(sql, /COALESCE\(btrim\(reference_normalized\)::numeric = COALESCE\(price_normalized, price_usd\), false\)/);
  assert.match(sql, /l\.parent_id IS NULL AND COALESCE\(l\.is_bundle, false\) = false/);
  assert.match(sql, /false AS exact_image/);
  assert.match(sql, /seller_candidate_rank = 1/);
  assert.match(sql, /percentile_cont\(0\.25\)/);
  assert.match(sql, /3\.0 \* \(stats\.q3 - stats\.q1\)/);
});

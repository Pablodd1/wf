'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const release = require('../tools/intake/release-qnsa-tudor.cjs');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations',
  '20260820190000_qnsa_tudor_release.sql'), 'utf8');
const modelMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations',
  '20260820191000_qnsa_controlled_model_browse_tudor.sql'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows',
  'qnsa-tudor-release.yml'), 'utf8');
const inventory = fs.readFileSync(path.join(root, 'api', 'reviewed-market-inventory.js'), 'utf8');
const research = fs.readFileSync(path.join(root, 'api', 'price-research.js'), 'utf8');
const catalogReferences = require('../api/catalog-references.js');

test('release is exact, Tudor-only, private, and reversible', () => {
  assert.equal(release.PROJECT_REF, 'qnsafosakvonzgfcsphh');
  assert.equal(release.EXPECTED_COUNT, 2555);
  assert.equal(release.EXPECTED_PLAN_SHA256,
    'e3b20565929f9f7bda5dc0f4f8ed24027753f35321b4139295748aa85434efa2');
  assert.match(migration, /l\.brand_normalized = 'Tudor'/);
  assert.match(migration, /l\.parent_id IS NULL AND COALESCE\(l\.is_bundle, false\) = false/);
  assert.match(migration, /QNSA_TUDOR_RELEASE_V1/);
  assert.match(migration, /user_image_url', NULL/);
  assert.match(migration, /contact_publication_approved', false/);
  assert.doesNotMatch(migration, /original_timestamp/);
  assert.match(migration, /'posting_date', s\.created_at/);
  assert.match(migration, /'raw_reference', CASE WHEN s\.public_reference IS NOT NULL THEN s\.reference_original ELSE NULL END/);
  assert.match(migration, /REFERENCE_PRICE_COLLISION_WITHHELD/);
  assert.match(migration, /'catalog_reference_confirmed', s\.catalog_reference_confirmed/);
  assert.match(migration, /'verified_price_usd', CASE WHEN NOT s\.reference_price_collision/);
  assert.match(migration, /ALTER TABLE public\.qnsa_tudor_release_manifest ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(migration, /(?:INSERT|UPDATE|DELETE)[\s\S]{0,80}(?:public\.dealers|dealer_reviews|dealer_group_memberships)/i);
});
test('workflow is manual, serialized, QNSA pinned, and uses env-safe inputs', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /SUPABASE_PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.match(workflow, /APPLY_QNSA_TUDOR_CANARY/);
  assert.match(workflow, /APPLY_QNSA_TUDOR_FULL/);
  assert.match(workflow, /ROLLBACK_QNSA_TUDOR_RELEASE/);
  assert.doesNotMatch(workflow, /run: \|[\s\S]*['"]\$\{\{\s*inputs\./);
  assert.doesNotMatch(workflow, /jobs:[\s\S]{0,400}\benv:\s*\n\s+SUPABASE_ACCESS_TOKEN:/);
});

test('database diagnostics are bounded and redact bearer credentials', () => {
  const source = fs.readFileSync(path.join(root, 'tools', 'intake',
    'release-qnsa-tudor.cjs'), 'utf8');
  assert.match(source, /replace\(\/Bearer\\s\+\\S\+\/gi, 'Bearer \[REDACTED\]'\)/);
  assert.match(source, /slice\(0, 300\)/);
  assert.doesNotMatch(source, /throw new Error\(`QNSA database query failed[^`]*\$\{raw\}/);
});

test('canary selects at most ten and covers deterministic intent, price, and identity lanes', () => {
  const rows = [
    ['WTS','SOURCE_EXPLICIT_USD_USDT','CATALOG_TUDOR_REFERENCE'],
    ['WTS','OWNER_ASSUMED_USD_CANDIDATE','SOURCE_TUDOR_IDENTITY'],
    ['WTS','NAMED_FOREIGN_REQUIRES_DATED_FX','CATALOG_TUDOR_REFERENCE'],
    ['WTS','PRICE_NOT_SUPPLIED','SOURCE_TUDOR_IDENTITY'],
    ['WTB','WTB_PRICE_WITHHELD','CATALOG_TUDOR_REFERENCE'],
    ...Array.from({ length: 10 }, () => ['WTS','SOURCE_EXPLICIT_USD_USDT','CATALOG_TUDOR_REFERENCE']),
  ].map((values, index) => ({ listing_id: `id-${index}`, listing_type: values[0],
    price_lane: values[1], identity_source: values[2], catalog_reference_confirmed: values[2].startsWith('CATALOG') }));
  const selected = release.selectCanary(rows);
  assert.equal(selected.length, 10);
  assert.ok(selected.some(row => row.listing_type === 'WTB'));
  assert.ok(selected.some(row => row.price_lane === 'OWNER_ASSUMED_USD_CANDIDATE'));
  assert.ok(selected.some(row => row.price_lane === 'NAMED_FOREIGN_REQUIRES_DATED_FX'));
  assert.ok(selected.some(row => row.identity_source === 'SOURCE_TUDOR_IDENTITY'));
});

test('Trading Floor and Price Research route Tudor through exact release RPCs', () => {
  assert.match(inventory, /qnsa_tudor_page_rows/);
  assert.match(inventory, /qnsa_tudor_release_count/);
  assert.match(inventory, /brand === 'Tudor'/);
  assert.match(inventory, /\['Richard Mille', 'Cartier', 'Zenith', 'Omega', 'Tudor'\]/);
  assert.match(research, /qnsa_tudor_reference_rows/);
  assert.match(research, /'vacheron constantin'/);
  assert.match(research, /canonical_qnsa_price_evidence_checked: true/);
  assert.match(migration, /qnsa_tudor_reference_index/);
  assert.match(modelMigration, /WHEN 'Tudor'/);
  assert.match(modelMigration, /idx_qnsa_tudor_manifest_run_model_order/);
});

test('Tudor reference picker merges catalog and exact source-proven release references', () => {
  const merged = catalogReferences.mergeVacheronReleaseReferences(
    [{ reference: '4500V/110A-B128' }],
    [
      { reference: '4500V/110A-B128', listing_count: 8, wts_count: 6,
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
    ['4500V/110A-B128', 8], ['SOURCE-123', 5],
  ]);
  assert.equal(merged.references[1].identity_source, 'SOURCE_PROVEN_RELEASE_REFERENCE');
  assert.equal(merged.unresolvedReferenceListingCount, 2);
  assert.equal(merged.unresolvedReferencePricedWtsCount, 1);
});

test('Trading Floor unwraps table-valued Tudor RPC rows before publication gates', () => {
  const inventoryModule = require('../api/reviewed-market-inventory.js');
  const listing = {
    id: 'vacheron-canary',
    listing_type: 'WTS',
    canonical_brand: 'Tudor',
    model: 'Tudor',
  };
  assert.deepEqual(inventoryModule.unwrapRpcRowData([{ row_data: listing }]), [listing]);
  assert.deepEqual(inventoryModule.unwrapRpcRowData([listing]), [listing]);
  assert.deepEqual(inventoryModule.unwrapRpcRowData(null), []);
  assert.match(inventory, /const sourceRows = unwrapRpcRowData\(data\)/);
});

test('candidate query preserves source lineage and does not infer parent or image evidence', () => {
  const sql = release.candidateSql(release.catalogReferenceLookups());
  assert.match(sql, /source_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(sql, /source_candidate_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(sql, /reference_key::numeric = COALESCE\(n\.price_normalized, n\.price_usd, -1\)/);
  assert.match(sql, /l\.parent_id IS NULL AND COALESCE\(l\.is_bundle, false\) = false/);
  assert.match(sql, /false AS exact_image/);
  assert.match(sql, /seller_candidate_rank = 1/);
  assert.match(sql, /percentile_cont\(0\.25\)/);
  assert.match(sql, /3\.0 \* \(stats\.q3 - stats\.q1\)/);
});


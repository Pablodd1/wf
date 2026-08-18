'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/20260814180000_qnsa_zenith_reviewed_release.sql');
const customerFeed = read('supabase/migrations/20260814184500_qnsa_zenith_customer_feed.sql');
const customerFeedGrant = read('supabase/migrations/20260814184600_qnsa_zenith_customer_feed_admin_grant.sql');
const workflow = read('.github/workflows/qnsa-zenith-reviewed-release.yml');
const research = read('api/price-research.js');
const inventory = read('api/reviewed-market-inventory.js');
const models = read('api/catalog-models.js');
const references = read('api/catalog-references.js');
const identityMigration = read('supabase/migrations/20260814190000_qnsa_zenith_identity_reconciliation.sql');
const identityWorkflow = read('.github/workflows/qnsa-zenith-identity-reconciliation.yml');
const orderedFeed = read('supabase/migrations/20260814191000_qnsa_zenith_global_price_order.sql');
const displayOrder = read('supabase/migrations/20260814192000_qnsa_zenith_source_price_display_order.sql');

test('Zenith release installs disabled and never rewrites immutable data', () => {
  assert.match(migration, /'Zenith', false, false/);
  assert.match(migration, /brand_normalized = 'Zenith'/);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+(?:staging\.listings|public\.raw_messages|public\.raw_message_versions)/i);
  assert.doesNotMatch(migration, /(?:UPDATE|DELETE|TRUNCATE)[\s\S]{0,80}(?:staging\.listings|public\.raw_message_versions)/i);
});

test('Zenith workflow is QNSA-pinned and fails closed on lineage, bundle provenance, and multi risk', () => {
  assert.match(workflow, /PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.match(workflow, /brand_normalized='Zenith'/);
  assert.match(workflow, /provenance_metadata->>'bundle_status'='SINGLE_CANDIDATE'/);
  assert.match(workflow, /Zenith immutable lineage failure/);
  assert.match(workflow, /Zenith multi-listing candidates require quarantine before release/);
  assert.match(workflow, /if\(\[long\]\$e\.high_confidence_multi_risk -ne 0\)/);
  assert.match(workflow, /'source_currency_counts'/);
  assert.match(workflow, /if \('\$\{\{ inputs\.mode \}\}' -eq 'enable' -and \[long\]\$e\.priced_wts -lt 1\)/);
});

test('Zenith uses QNSA bounded Price Research and appears in Trading discovery', () => {
  assert.match(research, /'richard mille', 'cartier', 'zenith'/);
  assert.match(research, /'Richard Mille', 'Cartier', 'Zenith'/);
  assert.match(inventory, /'Richard Mille', 'Cartier', 'Zenith'/);
});

test('Zenith has a bounded cursor feed and release verifies customer RPCs', () => {
  assert.match(customerFeed, /qnsa_zenith_candidate_page/);
  assert.match(customerFeed, /provenance_metadata->>'bundle_status' = 'SINGLE_CANDIDATE'/);
  assert.match(customerFeed, /LIMIT v_limit \+ 1 OFFSET v_offset/);
  assert.match(customerFeed, /WHEN p_brand = 'Zenith'/);
  assert.match(workflow, /20260814184500_qnsa_zenith_customer_feed\.sql/);
  assert.match(workflow, /20260814184600_qnsa_zenith_customer_feed_admin_grant\.sql/);
  assert.match(workflow, /WITH customer_rows AS MATERIALIZED/);
  assert.match(workflow, /price_usd>0 AND price_normalized>0/);
  assert.doesNotMatch(workflow, /qnsa_rolex_patek_trading_floor_source WHERE brand_scope='Zenith'/);
  assert.match(customerFeedGrant, /TO postgres, supabase_admin/);
});

test('Zenith catalog browse no longer invokes the retired text-ID workbook range', () => {
  assert.match(models, /brand: 'Zenith'[\s\S]*identity_source: 'PREAGGREGATED_CATALOG_INDEX'/);
  assert.match(references, /evidence_resolution: 'EXACT_REFERENCE_ON_SELECTION'/);
  const zenithModelBranch = models.slice(models.indexOf("if (brand.toLowerCase() === 'zenith')"));
  const zenithReferenceBranch = references.slice(references.indexOf("if (brand.toLowerCase() === 'zenith')"));
  assert.doesNotMatch(zenithModelBranch.split('const catalogReferences = listCatalogReferences(brand)')[0], /loadReviewedZenithModels\(/);
  assert.doesNotMatch(zenithReferenceBranch.split('const catalogReferences = listCatalogReferences(brand, model)')[0], /loadReviewedZenithReferences\(/);
});

test('Zenith same-line multi-watch messages are detected while a single watch remains eligible', () => {
  const { multiItemRisk } = require('../api/_lib/unsplit-bundle-filter.cjs');
  assert.equal(multiItemRisk('Zenith 03.3100.3600/69 USD 8000').is_multi, false);
  assert.equal(multiItemRisk('Zenith 03.3100.3600/69 USD 8000, Zenith 03.9300.3620/51.I001 USD 12000').is_multi, true);
  assert.equal(multiItemRisk('Zenith 03.3100.3600/69 USD 8000, Rolex 126500LN USD 30000').is_multi, true);
});

test('Zenith identity reconciliation is bounded, lineage-locked, and fail closed', () => {
  assert.match(identityMigration, /qnsa_extract_zenith_references/);
  assert.match(identityMigration, /CROSS_BRAND_OR_DAYTONA/);
  assert.match(identityMigration, /MULTIPLE_ZENITH_REFERENCES/);
  assert.match(identityMigration, /IDENTITY_CONFLICT_PENDING_REVIEW/);
  assert.match(identityMigration, /v_total<>464/);
  assert.match(identityMigration, /staging_row_delta',0,'raw_rows_mutated',0/);
  assert.doesNotMatch(identityMigration, /(?:UPDATE|DELETE|INSERT\s+INTO)\s+(?:public\.)?(?:raw_messages|raw_message_versions)/i);
  assert.doesNotMatch(identityMigration, /(?:INSERT\s+INTO|DELETE\s+FROM)\s+staging\.listings/i);
  assert.match(identityWorkflow, /PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.match(identityWorkflow, /AUDIT_QNSA_ZENITH_IDENTITY/);
  assert.match(identityWorkflow, /APPLY_QNSA_ZENITH_IDENTITY/);
  assert.match(identityWorkflow, /audit_qnsa_zenith_identity_reconciliation/);
  assert.match(identityWorkflow, /read_only=\$false/);
});

test('Zenith release verification respects the disabled control and counts null price correctly', () => {
  assert.match(workflow, /control\.trading_floor_enabled=true/);
  assert.match(workflow, /identity_reconciliation_status'='RELEASE_SAFE_EXACT_SOURCE_REFERENCE'/);
  assert.match(workflow, /COALESCE\(price_normalized,0\)<=0/);
  assert.match(workflow, /identity_audit_safe/);
  assert.match(workflow, /identity_audit_quarantine/);
  assert.match(workflow, /candidates -ne 453/);
});

test('Zenith pagination globally orders exact images and verified USD before no-price activity', () => {
  assert.match(orderedFeed, /qnsa_zenith_ordered_candidate_page/);
  assert.match(orderedFeed, /identity_reconciliation_status'='RELEASE_SAFE_EXACT_SOURCE_REFERENCE'/);
  assert.match(orderedFeed, /ORDER BY has_image DESC,has_price DESC/);
  assert.match(orderedFeed, /qnsa_zenith_identity_reconciliation_audit/);
  assert.match(orderedFeed, /WHEN p_brand='Zenith'/);
  assert.match(workflow, /20260814191000_qnsa_zenith_global_price_order\.sql/);
  assert.match(workflow, /Smoke ordered Zenith customer RPC directly/);
  assert.match(workflow, /source_price_signals/);
  assert.match(displayOrder, /qnsa_zenith_display_ordered_page/);
  assert.match(displayOrder, /has_source_price_signal DESC/);
  assert.match(displayOrder, /source_price_signal/);
  assert.doesNotMatch(displayOrder, /'has_verified_usd_price',true/);
});

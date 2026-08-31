// tools/mariadb-live/preview_migration_smoke_test.cjs
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function smokeTestMigrationFile() {
  const migrationPath = path.resolve('supabase/migrations/20260830190000_canonical_parent_child_remediation.sql');
  if (!fs.existsSync(migrationPath)) {
    throw new Error(`Migration file not found at ${migrationPath}`);
  }

  const sql = fs.readFileSync(migrationPath, 'utf-8');
  console.log(`Analyzing unapplied migration SQL (${sql.length} bytes)...`);

  const checks = [];

  // Check 1: Security Definer and search_path isolation
  const hasSecurityDefiner = sql.includes('SECURITY DEFINER');
  const hasSearchPathIsolated = sql.includes('SET search_path = wf_canonical_staging, pg_catalog');
  checks.push({
    check: 'search_path_isolation',
    passed: hasSecurityDefiner && hasSearchPathIsolated,
    detail: 'Functions must have SECURITY DEFINER and isolated search_path = wf_canonical_staging, pg_catalog'
  });

  // Check 2: No global function revocations
  const hasGlobalRevoke = sql.includes('REVOKE ALL ON ALL FUNCTIONS');
  checks.push({
    check: 'no_global_function_revocations',
    passed: !hasGlobalRevoke,
    detail: 'Must use function-specific revocations rather than global revocations'
  });

  // Check 3: Timestamps to TIMESTAMPTZ and fx_date to DATE
  const hasTimestamptzCast = sql.includes('TIMESTAMPTZ USING source_created_on::timestamptz') &&
                             sql.includes('TIMESTAMPTZ USING posted_at::timestamptz');
  const hasDateCast = sql.includes('DATE USING fx_date::date');
  checks.push({
    check: 'explicit_type_casts',
    passed: hasTimestamptzCast && hasDateCast,
    detail: 'Timestamp and date columns must use explicit USING expressions'
  });

  // Check 4: Scoped CHECK constraints
  const hasHashChecks = sql.includes('chk_mariadb_parents_hash_hex') && sql.includes('chk_mariadb_children_hash_hex');
  const hasIntentCheck = sql.includes('chk_mariadb_children_intent');
  const hasReconCheck = sql.includes('chk_mariadb_children_reconciliation_category');
  const hasCurrencyStatusCheck = sql.includes('chk_mariadb_children_currency_status');
  const hasTradingFloorStatusCheck = sql.includes('chk_mariadb_children_trading_floor_status');
  const hasPriceResearchStatusCheck = sql.includes('chk_mariadb_children_price_research_status');
  checks.push({
    check: 'scoped_check_constraints',
    passed: hasHashChecks && hasIntentCheck && hasReconCheck && hasCurrencyStatusCheck && hasTradingFloorStatusCheck && hasPriceResearchStatusCheck,
    detail: 'Scoped check constraints for hashes, prices, ordinals, intent, reconciliation category, and statuses must be present'
  });

  // Check 5: Separate active partial indexes for parent and child images
  const hasParentImageIndex = sql.includes('uq_mariadb_norm_images_parent_active') && sql.includes("scope = 'PARENT'");
  const hasChildImageIndex = sql.includes('uq_mariadb_norm_images_child_active') && sql.includes("scope = 'CHILD'");
  checks.push({
    check: 'separate_image_indexes',
    passed: hasParentImageIndex && hasChildImageIndex,
    detail: 'Separate active partial unique indexes for parent-level and child-level images'
  });

  // Check 6: Customer-safe detail RPC and internal evidence RPC
  const detailRpcBody = sql.split('FUNCTION public.get_mariadb_canonical_child_detail')[1]?.split('FUNCTION public.get_mariadb_canonical_internal_evidence')[0] || '';
  const hasCustomerSafeDetail = detailRpcBody.includes('raw_source_meta') && !detailRpcBody.includes('raw_message');
  const hasInternalEvidenceRpc = sql.includes('get_mariadb_canonical_internal_evidence');
  checks.push({
    check: 'customer_safe_rpc_separation',
    passed: hasCustomerSafeDetail && hasInternalEvidenceRpc,
    detail: 'Customer-safe detail RPC must not return unredacted raw_message; internal evidence RPC must be separate'
  });

  // Check 7: Mandatory Array checks before iteration
  const hasArrayMandatorySafeguards = sql.includes("jsonb_typeof(p_parents) <> 'array'") &&
                                      sql.includes("jsonb_typeof(v_parent->'children') <> 'array'") &&
                                      sql.includes("jsonb_typeof(v_child->'images') <> 'array'");
  checks.push({
    check: 'json_array_type_validation',
    passed: hasArrayMandatorySafeguards,
    detail: 'JSONB array type must be strictly validated; missing/non-array must throw exception'
  });

  // Check 8: Image scope check constraint
  const hasScopeConstraint = sql.includes('chk_mariadb_images_scope_child_id') &&
                             sql.includes("(scope = 'PARENT' AND child_id IS NULL)") &&
                             sql.includes("(scope = 'CHILD' AND child_id IS NOT NULL)");
  checks.push({
    check: 'image_scope_child_id_constraint',
    passed: hasScopeConstraint,
    detail: 'Check constraint chk_mariadb_images_scope_child_id enforces scope and child_id nullability'
  });

  // Check 9: Image synchronization by (image_ordinal, image_key) composite key
  const hasCompositeImageSync = sql.includes('(image_ordinal, image_key) NOT IN');
  checks.push({
    check: 'composite_image_sync_key',
    passed: hasCompositeImageSync,
    detail: 'Image synchronization must match both image_ordinal and image_key composite identity'
  });

  const allPassed = checks.every(c => c.passed);

  const report = {
    contract: 'wf-migration-smoke-test-v2',
    generated_at: new Date().toISOString(),
    migration_file: 'supabase/migrations/20260830190000_canonical_parent_child_remediation.sql',
    status: allPassed ? 'PASSED' : 'FAILED',
    execution_environment_policy: 'Production execution strictly forbidden. Run only on Supabase preview branch or ephemeral local PostgreSQL.',
    checks_summary: {
      total_checks: checks.length,
      passed_checks: checks.filter(c => c.passed).length,
      failed_checks: checks.filter(c => !c.passed).length
    },
    checks: checks
  };

  const outDir = path.resolve('audit-output/mariadb-live/canonical-canary-10k');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'preview_migration_smoke_test.json'), JSON.stringify(report, null, 2), 'utf-8');

  console.log('MIGRATION_SMOKE_TEST_RESULTS:');
  console.log(JSON.stringify(report.checks_summary, null, 2));

  return report;
}

module.exports = { smokeTestMigrationFile };

if (require.main === module) {
  try {
    const res = smokeTestMigrationFile();
    if (res.status !== 'PASSED') process.exit(1);
  } catch (err) {
    console.error('FATAL:', err);
    process.exit(1);
  }
}

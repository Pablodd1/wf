'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations',
  '20260815133000_qnsa_dealer_exact_phone_linkage.sql'), 'utf8');
const checkpointMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations',
  '20260815160000_qnsa_dealer_linkage_completion_checkpoint.sql'), 'utf8');
const rawPhoneIndexMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations',
  '20260815170000_qnsa_raw_version_phone_lookup_index.sql'), 'utf8');
const rawPhoneRepairMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations',
  '20260815171000_qnsa_dealer_raw_version_phone_linkage.sql'), 'utf8');
const globalRawScanMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations',
  '20260815173000_qnsa_dealer_global_raw_phone_scan.sql'), 'utf8');
const timeoutRepairMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations',
  '20260815174000_qnsa_dealer_global_raw_scan_timeout_repair.sql'), 'utf8');
const lateralRepairMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations',
  '20260815175000_qnsa_dealer_raw_page_lateral_lookup.sql'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows',
  'qnsa-dealer-exact-phone-linkage.yml'), 'utf8');
const runner = fs.readFileSync(path.join(root, 'tools', 'dealer-directory',
  'run-exact-phone-linkage.cjs'), 'utf8');
const importer = fs.readFileSync(path.join(root, 'tools', 'dealer-directory',
  'import-canonical-snapshots.cjs'), 'utf8');

test('linkage is bounded and keyset-driven', () => {
  assert.match(migration, /p_after_id uuid DEFAULT NULL/i);
  assert.match(migration, /p_after_id IS NULL OR l\.id > p_after_id/i);
  assert.match(migration, /ORDER BY l\.id[\s\S]*LIMIT v_limit \+ 1/i);
  assert.doesNotMatch(migration, /CREATE\s+(?:UNIQUE\s+)?INDEX|OFFSET/i);
  assert.match(runner, /EXPLAIN \(FORMAT TEXT, COSTS TRUE\)/);
});

test('historical indexed repair remains immutable while forward fallback uses existing indexes', () => {
  assert.match(rawPhoneIndexMigration,
    /CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_qnsa_raw_versions_from_phone/i);
  assert.match(rawPhoneRepairMigration, /idx_qnsa_raw_versions_from_phone/i);
  assert.match(globalRawScanMigration,
    /CREATE OR REPLACE FUNCTION public\.qnsa_dealer_global_raw_phone_link_page/i);
  assert.match(globalRawScanMigration,
    /FROM public\.raw_message_versions AS raw_version[\s\S]*raw_version\.id > p_after_raw_version_id[\s\S]*ORDER BY raw_version\.id[\s\S]*LIMIT v_limit \+ 1/i);
  assert.match(globalRawScanMigration,
    /JOIN staging\.listings AS listing[\s\S]*listing\.raw_message_version_id = raw_version\.id/i);
  assert.match(globalRawScanMigration,
    /raw_version\.raw_payload#>>'\{raw_data,from_number\}'/i);
  assert.doesNotMatch(globalRawScanMigration,
    /CREATE\s+(?:UNIQUE\s+)?INDEX|UPDATE\s+(?:public\.raw_message_versions|staging\.listings)|DELETE\s+FROM|TRUNCATE/i);
  assert.match(runner, /raw_message_versions_pkey/);
  assert.match(runner, /idx_staging_mariadb_raw_version/);
  assert.doesNotMatch(runner, /idx_qnsa_raw_versions_from_phone/);
});

test('first-page timeout repair preserves UUID keyset completeness and removes nullable OR', () => {
  const oldPredicate = 'WHERE p_after_raw_version_id IS NULL OR raw_version.id > p_after_raw_version_id';
  assert.ok(globalRawScanMigration.includes(oldPredicate));
  assert.match(timeoutRepairMigration,
    /raw_version\.id > COALESCE[\s\S]*00000000-0000-0000-0000-000000000000/);
  assert.match(timeoutRepairMigration, /pg_get_functiondef/);
  assert.match(timeoutRepairMigration, /cursor predicate does not match audited contract/);
  assert.doesNotMatch(timeoutRepairMigration,
    /CREATE\s+(?:UNIQUE\s+)?INDEX|INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|TRUNCATE/i);
  assert.match(runner, /boundedInteger\(env\.LINKAGE_PAGE_SIZE, 1000, 1, 5000/);
  assert.match(workflow, /LINKAGE_PAGE_SIZE: '1000'/);
  assert.match(workflow, /20260815174000_qnsa_dealer_global_raw_scan_timeout_repair\.sql/);
});

test('bounded raw page performs a fenced parameterized staging lineage lookup', () => {
  const extractFragment = marker => {
    const token = `$${marker}$`;
    const start = lateralRepairMigration.indexOf(token) + token.length;
    const end = lateralRepairMigration.indexOf(token, start);
    return lateralRepairMigration.slice(start, end).replaceAll('\r\n', '\n');
  };
  const original = globalRawScanMigration.replaceAll('\r\n', '\n');
  assert.ok(original.includes(extractFragment('old_page')));
  assert.ok(original.includes(extractFragment('old_identity')));
  assert.match(lateralRepairMigration, /JOIN LATERAL/);
  assert.match(lateralRepairMigration,
    /candidate_listing\.raw_message_version_id = page\.id[\s\S]*OFFSET 0/);
  assert.match(lateralRepairMigration, /idx_staging_mariadb_raw_version/);
  assert.match(lateralRepairMigration, /indisvalid[\s\S]*indisready/);
  assert.doesNotMatch(lateralRepairMigration,
    /CREATE\s+(?:UNIQUE\s+)?INDEX|INSERT\s+INTO|UPDATE\s+(?:public\.raw_message_versions|staging\.listings)|DELETE\s+FROM|TRUNCATE/i);
  assert.match(workflow, /20260815175000_qnsa_dealer_raw_page_lateral_lookup\.sql/);
  assert.match(runner, /Nested Loop/);
  assert.match(runner, /bounded raw-page-first lineage plan/);
});

test('only exact verified unique phone identities may reach the private ledger', () => {
  assert.match(globalRawScanMigration, /verification_status = 'VERIFIED'/);
  assert.match(globalRawScanMigration, /upper\(identity\.identity_type\) IN \('PHONE', 'WHATSAPP'\)/);
  assert.match(globalRawScanMigration, /HAVING count\(DISTINCT identity\.dealer_id\) > 1/);
  assert.match(globalRawScanMigration, /'EXACT_VERIFIED_PHONE', 'APPLIED'/);
  assert.match(globalRawScanMigration, /ON CONFLICT \(listing_id\) DO NOTHING/);
  assert.match(globalRawScanMigration, /p_apply_limit NOT BETWEEN 0 AND 10/);
  assert.doesNotMatch(globalRawScanMigration, /contact_consent\s*=/i);
});

test('release gates fail closed for lineage, bundles, status, and controlled brands', () => {
  assert.match(globalRawScanMigration, /JOIN public\.raw_message_versions/);
  assert.match(globalRawScanMigration, /raw_version\.source_record_id = listing\.source_record_id/);
  assert.match(globalRawScanMigration, /raw_version\.source_hash = listing\.source_hash/);
  assert.match(globalRawScanMigration, /release_control\.enabled_run_key = listing\.normalization_run_key/);
  assert.match(globalRawScanMigration, /release_control\.trading_floor_enabled = true/);
  assert.match(globalRawScanMigration, /listing\.provenance_metadata->>'bundle_status' = 'SINGLE_CANDIDATE'/);
  for (const state of ['bundle_child_pending_review', 'bundle_pending_separation', 'suppressed_exact_duplicate']) {
    assert.match(globalRawScanMigration, new RegExp(state));
  }
  assert.match(globalRawScanMigration, /zenith_audit\.decision = 'RELEASE_SAFE'/);
  assert.match(globalRawScanMigration, /Richard Mille[\s\S]*Cartier[\s\S]*Zenith/);
});

test('global linkage mirrors first-three singleton compatibility without loosening later brands', () => {
  assert.match(globalRawScanMigration,
    /brand_normalized IN \('Rolex', 'Patek Philippe', 'Audemars Piguet'\)[\s\S]*COALESCE\(listing\.provenance_metadata->>'bundle_status', 'SINGLE_CANDIDATE'\)/);
  assert.match(globalRawScanMigration,
    /brand_normalized IN \('Richard Mille', 'Cartier', 'Zenith'\)[\s\S]*provenance_metadata->>'bundle_status' = 'SINGLE_CANDIDATE'/);
});

test('RPC is service-only and returns no contact value', () => {
  assert.match(globalRawScanMigration, /REVOKE ALL ON FUNCTION public\.qnsa_dealer_global_raw_phone_link_page[\s\S]*FROM PUBLIC, anon, authenticated/i);
  assert.doesNotMatch(globalRawScanMigration, /GRANT EXECUTE[\s\S]{0,180}TO anon|GRANT EXECUTE[\s\S]{0,180}TO authenticated/i);
  const returnStart = globalRawScanMigration.indexOf('RETURN jsonb_build_object(');
  const returnBlock = globalRawScanMigration.slice(returnStart,
    globalRawScanMigration.indexOf('END;\n$$;', returnStart));
  assert.doesNotMatch(returnBlock, /'phone'|'source_identity'|'seller_phone'/i);
});

test('workflow pins QNSA and separates audit, ten-row canary, and full modes', () => {
  assert.match(workflow, /SUPABASE_PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.match(workflow, /options: \[audit, canary, full\]/);
  assert.match(workflow, /AUDIT_QNSA_DEALER_LINKAGE/);
  assert.match(workflow, /CANARY_QNSA_DEALER_LINKAGE/);
  assert.match(workflow, /FULL_QNSA_DEALER_LINKAGE/);
  assert.match(workflow, /LINKAGE_CANARY_LIMIT: '10'/);
  assert.match(workflow, /20260815173000_qnsa_dealer_global_raw_phone_scan\.sql/);
  assert.doesNotMatch(workflow, /SUPABASE_DB_PASSWORD|PGPASSWORD|\bpsql\b|session pooler/i);
  assert.match(workflow, /import-canonical-snapshots\.cjs/);
  assert.match(workflow, /inputs\.mode != 'audit'/);
  assert.match(workflow, /\$compileSql = \$migration -replace/);
  assert.match(workflow, /BEGIN;`n\$compileSql`nROLLBACK;/);
  assert.match(workflow, /read_only = \$true/);
  assert.match(runner, /mode === 'audit'.*applied_links/s);
  assert.match(runner, /totals\.applied > canaryLimit/);
  assert.match(runner, /duplicate_verified_phones/);
  assert.match(runner, /orphan_links/);
  assert.match(runner, /qnsa_dealer_linkage_reconciliation\(\) AS result', false, fetchImpl/);
  assert.match(runner, /pii_logged: false/);
});

test('only a fully exhausted global scan can publish completed linkage', () => {
  assert.match(checkpointMigration, /dealer_listing_linkage_checkpoints/);
  assert.match(checkpointMigration, /status IN \('RUNNING', 'COMPLETE', 'FAILED'\)/);
  assert.match(checkpointMigration, /status = 'COMPLETE' AND completed_at IS NOT NULL/);
  assert.match(checkpointMigration, /REVOKE ALL ON TABLE[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(runner, /mode === 'full'[\s\S]*status = 'RUNNING'/);
  assert.match(runner, /if \(mode === 'full'\)[\s\S]*if \(!cursorExhausted\)[\s\S]*status = 'COMPLETE'/);
  assert.match(runner, /Full linkage cannot complete before global cursor exhaustion/);
  assert.match(runner, /'cursor_exhausted', true/);
  assert.doesNotMatch(runner, /mode === 'canary'[\s\S]{0,300}status = 'COMPLETE'/);
});

test('private canonical identity import is idempotent, reconciled, and never runs the retired bucket linker', () => {
  assert.match(importer, /apply_qnsa_dealer_directory_snapshot/);
  assert.match(importer, /duplicate_verified_phones/);
  assert.match(importer, /pii_logged: false/);
  assert.doesNotMatch(importer, /sync_qnsa_dealer_public_listing_links_bucket/);
});

test('runner input validators fail closed', () => {
  const { boundedInteger, safeUuid, EXPECTED_PROJECT } = require('../tools/dealer-directory/run-exact-phone-linkage.cjs');
  assert.equal(EXPECTED_PROJECT, 'qnsafosakvonzgfcsphh');
  assert.equal(boundedInteger('10', 5, 1, 10, 'X'), 10);
  assert.throws(() => boundedInteger('11', 5, 1, 10, 'X'));
  assert.equal(safeUuid('00000000-0000-4000-8000-000000000000'), '00000000-0000-4000-8000-000000000000');
  assert.throws(() => safeUuid('not-a-uuid'));
});

function jsonResponse(payload) {
  return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
}

function errorResponse(status) {
  return {
    ok: false,
    status,
    json: async () => ({ message: 'database request rejected' }),
    text: async () => JSON.stringify({ message: 'database request rejected' }),
  };
}

test('lost canary page response reconciles before replay and cannot exceed the global cap', async () => {
  const { run } = require('../tools/dealer-directory/run-exact-phone-linkage.cjs');
  let reconciliationCalls = 0;
  let pageCalls = 0;
  const fetchImpl = async (_url, options) => {
    const sql = JSON.parse(options.body).query;
    if (/raw_version_primary_key_valid/.test(sql)) return jsonResponse([{ capacity: {
      database_gib: 7.898, raw_version_primary_key_valid: true, raw_version_lineage_index: true,
      raw_versions_count: 2000,
    } }]);
    if (/EXPLAIN[\s\S]*WITH raw_page[\s\S]*JOIN LATERAL/.test(sql)) {
      return jsonResponse([{ 'QUERY PLAN': 'Nested Loop raw_message_versions_pkey idx_staging_mariadb_raw_version' }]);
    }
    if (/EXPLAIN[\s\S]*ORDER BY raw_version\.id/.test(sql)) {
      return jsonResponse([{ 'QUERY PLAN': 'Index Only Scan using raw_message_versions_pkey' }]);
    }
    if (/EXPLAIN[\s\S]*staging\.listings/.test(sql)) {
      return jsonResponse([{ 'QUERY PLAN': 'Index Scan using idx_staging_mariadb_raw_version' }]);
    }
    if (/qnsa_dealer_linkage_reconciliation/.test(sql)) {
      reconciliationCalls += 1;
      return jsonResponse([{ result: {
        duplicate_verified_phones: 0, orphan_links: 0, dealers_with_verified_phone: 54,
        applied_links: reconciliationCalls === 1 ? 100 : 110,
      } }]);
    }
    if (/qnsa_dealer_global_raw_phone_link_page/.test(sql)) {
      pageCalls += 1;
      return errorResponse(502);
    }
    throw new Error(`Unexpected SQL: ${sql.slice(0, 80)}`);
  };

  const result = await run({ env: {
    SUPABASE_PROJECT_REF: 'qnsafosakvonzgfcsphh', SUPABASE_ACCESS_TOKEN: 'test',
    LINKAGE_MODE: 'canary', LINKAGE_PAGE_SIZE: '1000', LINKAGE_CANARY_LIMIT: '10',
    LINKAGE_MAX_PAGES: '5000', LINKAGE_DELAY_MS: '0',
  }, fetchImpl });
  assert.equal(pageCalls, 1, 'a committed canary page is not replayed after the cap is observed');
  assert.equal(result.totals.applied, 10);
  assert.equal(result.cursor_exhausted, false);
});

test('management-only canary globally scans and cannot exceed ten writes or complete checkpoints', async () => {
  const { run } = require('../tools/dealer-directory/run-exact-phone-linkage.cjs');
  const queries = [];
  let reconciliationCalls = 0;
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    queries.push(request);
    const sql = request.query;
    if (/raw_version_primary_key_valid/.test(sql)) return jsonResponse([{ capacity: {
      database_gib: 7.898, raw_version_primary_key_valid: true, raw_version_lineage_index: true,
      raw_versions_count: 2000,
    } }]);
    if (/EXPLAIN[\s\S]*WITH raw_page[\s\S]*JOIN LATERAL/.test(sql)) {
      return jsonResponse([{ 'QUERY PLAN': 'Nested Loop raw_message_versions_pkey idx_staging_mariadb_raw_version' }]);
    }
    if (/EXPLAIN[\s\S]*ORDER BY raw_version\.id/.test(sql)) {
      return jsonResponse([{ 'QUERY PLAN': 'Index Only Scan using raw_message_versions_pkey' }]);
    }
    if (/EXPLAIN[\s\S]*staging\.listings/.test(sql)) {
      return jsonResponse([{ 'QUERY PLAN': 'Index Scan using idx_staging_mariadb_raw_version' }]);
    }
    if (/qnsa_dealer_linkage_reconciliation/.test(sql)) {
      reconciliationCalls += 1;
      return jsonResponse([{ result: {
        duplicate_verified_phones: 0, orphan_links: 0, dealers_with_verified_phone: 54,
        applied_links: reconciliationCalls === 1 ? 0 : 10,
      } }]);
    }
    if (/qnsa_dealer_global_raw_phone_link_page/.test(sql)) return jsonResponse([{ result: {
      scanned: 1000, eligible: 14, applied: 10, already_linked: 0,
      conflicting_links: 0, dealers_matched: 2,
      next_raw_version_id: '00000000-0000-4000-8000-000000000001', has_more: true,
    } }]);
    throw new Error(`Unexpected SQL: ${sql.slice(0, 80)}`);
  };
  const result = await run({ env: {
    SUPABASE_PROJECT_REF: 'qnsafosakvonzgfcsphh', SUPABASE_ACCESS_TOKEN: 'test',
    LINKAGE_MODE: 'canary', LINKAGE_PAGE_SIZE: '1000', LINKAGE_CANARY_LIMIT: '10',
    LINKAGE_MAX_PAGES: '5000', LINKAGE_DELAY_MS: '0',
  }, fetchImpl });
  assert.equal(result.totals.applied, 10);
  assert.equal(result.cursor_exhausted, false);
  assert.doesNotMatch(queries.map(item => item.query).join('\n'), /status\s*=\s*'COMPLETE'/i);
  const pageRequest = queries.find(item => /qnsa_dealer_global_raw_phone_link_page/.test(item.query));
  assert.equal(pageRequest.read_only, false, 'service-only RPC uses privileged Management execution');
});

test('full mode writes COMPLETE only after the global raw cursor is exhausted', async () => {
  const { run } = require('../tools/dealer-directory/run-exact-phone-linkage.cjs');
  const queries = [];
  let reconciliationCalls = 0;
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    queries.push(request.query);
    const sql = request.query;
    if (/raw_version_primary_key_valid/.test(sql)) return jsonResponse([{ capacity: {
      database_gib: 7.898, raw_version_primary_key_valid: true, raw_version_lineage_index: true,
      raw_versions_count: 1000,
    } }]);
    if (/EXPLAIN[\s\S]*WITH raw_page[\s\S]*JOIN LATERAL/.test(sql)) {
      return jsonResponse([{ 'QUERY PLAN': 'Nested Loop raw_message_versions_pkey idx_staging_mariadb_raw_version' }]);
    }
    if (/EXPLAIN[\s\S]*ORDER BY raw_version\.id/.test(sql)) return jsonResponse([{ 'QUERY PLAN': 'raw_message_versions_pkey' }]);
    if (/EXPLAIN[\s\S]*staging\.listings/.test(sql)) return jsonResponse([{ 'QUERY PLAN': 'idx_staging_mariadb_raw_version' }]);
    if (/qnsa_dealer_linkage_reconciliation/.test(sql)) {
      reconciliationCalls += 1;
      return jsonResponse([{ result: {
        duplicate_verified_phones: 0, orphan_links: 0, dealers_with_verified_phone: 54,
        applied_links: reconciliationCalls === 1 ? 0 : 3,
      } }]);
    }
    if (/INSERT INTO public\.dealer_listing_linkage_checkpoints/.test(sql)) return jsonResponse([]);
    if (/qnsa_dealer_global_raw_phone_link_page/.test(sql)) return jsonResponse([{ result: {
      scanned: 1000, eligible: 3, applied: 3, already_linked: 0,
      conflicting_links: 0, dealers_matched: 2, next_raw_version_id: null, has_more: false,
    } }]);
    if (/SELECT count\(\*\)::bigint AS raw_versions_count/.test(sql)) {
      return jsonResponse([{ raw_versions_count: 1000 }]);
    }
    if (/UPDATE public\.dealer_listing_linkage_checkpoints/.test(sql)) return jsonResponse([]);
    if (/count\(\*\) FILTER \(WHERE status='RUNNING'\)/.test(sql)) {
      return jsonResponse([{ result: { running: 0, complete: 54 } }]);
    }
    throw new Error(`Unexpected SQL: ${sql.slice(0, 80)}`);
  };
  const result = await run({ env: {
    SUPABASE_PROJECT_REF: 'qnsafosakvonzgfcsphh', SUPABASE_ACCESS_TOKEN: 'test',
    LINKAGE_MODE: 'full', LINKAGE_PAGE_SIZE: '1000', LINKAGE_CANARY_LIMIT: '10',
    LINKAGE_MAX_PAGES: '5000', LINKAGE_DELAY_MS: '0',
  }, fetchImpl });
  assert.equal(result.cursor_exhausted, true);
  const runningInsert = queries.find(sql => /INSERT INTO public\.dealer_listing_linkage_checkpoints/.test(sql));
  assert.match(runningInsert,
    /\(\s*dealer_id, run_key, status, started_at, completed_at, updated_at, evidence\s*\)[\s\S]*SELECT DISTINCT dealer\.id,[\s\S]*'RUNNING',\s*now\(\), NULL::timestamptz, now\(\), jsonb_build_object/i);
  const pageIndex = queries.findIndex(sql => /qnsa_dealer_global_raw_phone_link_page/.test(sql));
  const completeIndex = queries.findIndex(sql => /UPDATE public\.dealer_listing_linkage_checkpoints/.test(sql));
  assert.ok(pageIndex >= 0 && completeIndex > pageIndex);
});

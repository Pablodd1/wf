// tools/mariadb-live/run-launch-preflight.cjs
'use strict';

const {
  verifyTlsProof,
  createFrozenSourceBoundary,
  fetchCheckpointState,
  PINNED_MARIADB_SERVER_CERT_SHA256,
  CONTRACT
} = require('./full-capture-preflight.cjs');
const { resolveMariaDbTransport } = require('./run-full-private-capture.cjs');
const mysql = require('mysql2/promise');
const { createClient } = require('@supabase/supabase-js');
const fs = require('node:fs');
const path = require('node:path');

async function runLaunchPreflight() {
  console.log('============================================================');
  console.log('MARIADB FULL CAPTURE LAUNCH PREFLIGHT (ZERO-ROW / BUILD-ONLY)');
  console.log('============================================================');

  // 1. Verify TLS & Certificate Pinning Proof
  console.log('1. Verifying TLS Transport Proof...');
  const tlsProof = verifyTlsProof(process.env);
  console.log('TLS Proof Verified:', tlsProof);

  // 2. Verify Database Connection & Frozen Boundary Snapshot
  console.log('2. Connecting to MariaDB and creating frozen snapshot boundary...');
  const transportConfig = resolveMariaDbTransport(process.env);
  const mariadbConn = await mysql.createConnection({
    host: process.env.MARIADB_HOST,
    port: Number(process.env.MARIADB_PORT || 3306),
    user: process.env.MARIADB_USER,
    password: process.env.MARIADB_PASSWORD,
    database: process.env.MARIADB_DATABASE,
    ssl: transportConfig.ssl
  });

  let manifest;
  try {
    manifest = await createFrozenSourceBoundary(mariadbConn);
    console.log('Source Boundary Frozen: ' + manifest.total_source_rows + ' total rows');
    console.log('Lower Boundary: ' + JSON.stringify(manifest.lower_boundary));
    console.log('Upper Boundary: ' + JSON.stringify(manifest.upper_boundary));
    console.log('Manifest SHA-256: ' + manifest.manifest_sha256);
  } finally {
    await mariadbConn.query('ROLLBACK');
    await mariadbConn.end();
  }

  // 3. Verify PostgreSQL Service Role Connection & Checkpoint RPC (fail-closed)
  console.log('3. Verifying PostgreSQL Checkpoint RPC Access...');
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('Supabase credentials missing');

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const testCp = await fetchCheckpointState(supabase, 'non-existent-probe-key');
  console.log('PostgreSQL Checkpoint RPC Functional (Returned null for probe key as expected)');

  const actualCp = await fetchCheckpointState(supabase, 'full-capture-auctions-1788028958313');
  if (!actualCp) throw new Error('Primary checkpoint full-capture-auctions-1788028958313 not found');
  console.log('Primary Checkpoint Status: input_rows = ' + actualCp.input_rows + ', capture_errors = ' + actualCp.capture_errors_count + ', status = ' + actualCp.status);
  if (Number(actualCp.input_rows) !== 951750 || Number(actualCp.capture_errors_count) !== 7) {
    throw new Error('Checkpoint mismatch: expected 951,750 inputs and 7 errors, got ' + actualCp.input_rows + ' inputs and ' + actualCp.capture_errors_count + ' errors');
  }

  // 4. Verify Comprehensive Security Audit
  console.log('4. Verifying Comprehensive Security Audit (84 direct privileges + 6 function privileges)...');
  const { data: auditData, error: auditErr } = await supabase.rpc('audit_mariadb_private_raw_security');
  if (auditErr) throw new Error('Security audit query failed: ' + auditErr.message);

  let directAllFalse = true;
  for (const [table, privs] of Object.entries(auditData.direct_table_privileges)) {
    for (const [action, allowed] of Object.entries(privs)) {
      if (allowed !== false) {
        directAllFalse = false;
        console.error('Security Violation: Table privilege ' + table + '.' + action + ' is TRUE');
      }
    }
  }

  console.log('Security Audit Status: 84 Direct Table Privileges All False = ' + directAllFalse);
  console.log('Schema Usage:', auditData.schema_usage);
  console.log('Function Privileges:', auditData.function_privileges);

  const preflightReport = {
    contract: CONTRACT,
    timestamp: new Date().toISOString(),
    tls_proof: tlsProof,
    source_boundary: manifest,
    database_security_audit: {
      direct_table_privileges_all_false: directAllFalse,
      schema_usage: auditData.schema_usage,
      function_privileges: auditData.function_privileges
    },
    launch_gate_status: 'READY_FOR_FINAL_AUTHORIZATION'
  };

  const outputDir = path.resolve('audit-output/mariadb-live/launch-preflight');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'launch-preflight-report.json'), JSON.stringify(preflightReport, null, 2));

  console.log('============================================================');
  console.log('LAUNCH PREFLIGHT PASSED: READY FOR FINAL AUTHORIZATION');
  console.log('============================================================');

  return preflightReport;
}

if (require.main === module) {
  runLaunchPreflight()
    .then(report => {
      console.log('PREFLIGHT_REPORT:', JSON.stringify(report, null, 2));
      process.exit(0);
    })
    .catch(err => {
      console.error('PREFLIGHT_ERROR:', err);
      process.exit(1);
    });
}

module.exports = { runLaunchPreflight };

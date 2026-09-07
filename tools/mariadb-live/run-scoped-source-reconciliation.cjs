"use strict";

const mysql = require("mysql2/promise");
const { Client } = require("pg");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PINNED_MARIADB_SERVER_CERT_SHA256 = "07:F7:B9:58:1B:79:C7:42:61:8D:3F:85:91:DC:54:9B:F1:6E:FB:C6:2E:45:0E:FD:9B:56:F7:54:D3:52:E1:97";
const PINNED_MARIADB_CA_CERT_SHA256 = "08:61:92:B8:05:ED:58:A3:3F:A5:7B:AA:D1:61:DB:CE:2E:63:13:A4:26:12:36:52:60:E0:61:9F:35:6B:94:8B";

function checkPinnedServerIdentity(servername, cert) {
  if (!cert) throw new Error("TLS Peer Certificate Missing");
  const rawHex = cert.raw ? crypto.createHash("sha256").update(cert.raw).digest("hex").toUpperCase() : null;
  const fp256 = cert.fingerprint256 || (rawHex ? rawHex.match(/../g).join(":") : null);
  const expectedFps = [PINNED_MARIADB_SERVER_CERT_SHA256, PINNED_MARIADB_CA_CERT_SHA256];
  if (!fp256 || !expectedFps.includes(fp256.toUpperCase())) {
    throw new Error(`TLS Pinning Violation: fingerprint ${fp256} != pinned ${PINNED_MARIADB_SERVER_CERT_SHA256}`);
  }
  return undefined;
}

async function runScopedReconciliation(env = process.env) {
  const host = env.MARIADB_HOST || "161.35.0.209";
  const port = Number(env.MARIADB_PORT || 3306);
  const user = env.MARIADB_USER || "jasmel";
  const password = env.MARIADB_PASSWORD;
  const database = env.MARIADB_DATABASE || "thecollective_inventory";
  const caPath = env.MARIADB_TLS_CA_FILE || path.resolve(__dirname, "mariadb-server-ca.pem");

  const lowerCreatedOn = "2025-01-08 13:28:49";
  const lowerId = "7534d09b-28b9-4052-8005-228c32f972df";
  const upperCreatedOn = "2026-08-29 14:42:32";
  const upperId = "f1bdf67a-3723-41c6-a1e3-35c5ca9138b0";

  // 1. MariaDB (Source of Truth)
  const mConn = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database,
    ssl: {
      ca: fs.readFileSync(caPath),
      rejectUnauthorized: true,
      checkServerIdentity: checkPinnedServerIdentity
    },
    connectTimeout: 10000
  });

  const mSql = `
    SELECT id, created_on
    FROM auctions
    WHERE (created_on > ? OR (created_on = ? AND id >= ?))
      AND (created_on < ? OR (created_on = ? AND id <= ?))
    ORDER BY created_on ASC, id ASC;
  `;
  const [mRows] = await mConn.query(mSql, [
    lowerCreatedOn, lowerCreatedOn, lowerId,
    upperCreatedOn, upperCreatedOn, upperId
  ]);
  const mariadbIdSet = new Set(mRows.map(r => r.id));
  const mariadbCount = mRows.length;
  await mConn.end();

  // 2. PostgreSQL Staging with Exact Lower and Upper Boundaries and Strict Verified TLS
  const pgSslConfig = {
    rejectUnauthorized: true
  };
  if (env.PGSSLROOTCERT && fs.existsSync(env.PGSSLROOTCERT)) {
    pgSslConfig.ca = fs.readFileSync(env.PGSSLROOTCERT).toString();
  }

  const pgClient = new Client({
    connectionString: env.DATABASE_URL,
    ssl: pgSslConfig
  });
  await pgClient.connect();

  const stagedRes = await pgClient.query(`
    SELECT DISTINCT source_id
    FROM wf_canonical_staging.mariadb_raw_source_rows
    WHERE source_system = 'OceanDigital MariaDB'
      AND source_database = 'thecollective_inventory'
      AND source_table = 'auctions'
      AND (source_created_on > $1 OR (source_created_on = $1 AND source_id >= $2))
      AND (source_created_on < $3 OR (source_created_on = $3 AND source_id <= $4));
  `, [
    "2025-01-08T13:28:49.000Z", lowerId,
    "2026-08-29T14:42:32.000Z", upperId
  ]);
  const stagedIdSet = new Set(stagedRes.rows.map(r => r.source_id));

  // 3. Error Ledger with Exact Lower and Upper Boundaries
  const errRes = await pgClient.query(`
    SELECT DISTINCT source_id
    FROM wf_canonical_staging.mariadb_raw_import_errors
    WHERE run_key = 'full-capture-auctions-1788028958313'
      AND (source_created_on > $1 OR (source_created_on = $1 AND source_id >= $2))
      AND (source_created_on < $3 OR (source_created_on = $3 AND source_id <= $4));
  `, [
    "2025-01-08T13:28:49.000Z", lowerId,
    "2026-08-29T14:42:32.000Z", upperId
  ]);
  const errorIdSet = new Set(errRes.rows.map(r => r.source_id));
  await pgClient.end();

  let overlapCount = 0;
  for (const id of errorIdSet) {
    if (stagedIdSet.has(id)) overlapCount++;
  }
  const unionSet = new Set([...stagedIdSet, ...errorIdSet]);

  const capturedAbsentFromMariadb = [];
  for (const id of unionSet) {
    if (!mariadbIdSet.has(id)) capturedAbsentFromMariadb.push(id);
  }

  const mariadbAbsentFromCapture = [];
  for (const id of mariadbIdSet) {
    if (!unionSet.has(id)) mariadbAbsentFromCapture.push(id);
  }

  const auditResult = {
    contract: "wf-mariadb-scoped-reconciliation-v1",
    run_key: "full-capture-auctions-1788028958313",
    timestamp: new Date().toISOString(),
    boundary: {
      source_system: "OceanDigital MariaDB",
      source_database: "thecollective_inventory",
      source_table: "auctions",
      lower_boundary: { created_on: lowerCreatedOn, id: lowerId },
      upper_boundary: { created_on: upperCreatedOn, id: upperId }
    },
    counts: {
      current_mariadb_boundary_count: mariadbCount,
      current_mariadb_distinct_ids: mariadbIdSet.size,
      distinct_scoped_staged_ids: stagedIdSet.size,
      distinct_scoped_error_ids: errorIdSet.size,
      overlap_staged_and_errors: overlapCount,
      union_captured_ids: unionSet.size,
      captured_absent_from_current_mariadb: capturedAbsentFromMariadb.length,
      current_mariadb_absent_from_capture: mariadbAbsentFromCapture.length,
      capture_completeness_rate: mariadbAbsentFromCapture.length === 0 ? 1.0 : (1 - mariadbAbsentFromCapture.length / mariadbCount)
    },
    drift_details: {
      sample_deleted_source_ids: capturedAbsentFromMariadb.slice(0, 20),
      sample_unmigrated_source_ids: mariadbAbsentFromCapture.slice(0, 20)
    }
  };

  return auditResult;
}

if (require.main === module) {
  runScopedReconciliation()
    .then(res => console.log(JSON.stringify(res, null, 2)))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { runScopedReconciliation };

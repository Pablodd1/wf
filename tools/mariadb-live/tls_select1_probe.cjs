// tools/mariadb-live/tls_select1_probe.cjs
"use strict";

const mysql = require("mysql2/promise");
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

async function runProbe() {
  const host = process.env.MARIADB_HOST;
  const port = Number(process.env.MARIADB_PORT || 3306);
  const user = process.env.MARIADB_USER;
  const password = process.env.MARIADB_PASSWORD;
  const database = process.env.MARIADB_DATABASE;
  const caPath = process.env.MARIADB_TLS_CA_FILE || path.resolve(__dirname, "mariadb-server-ca.pem");

  console.log("============================================================");
  console.log("MARIADB ONE-SHOT CONNECTIVITY PROBE (SELECT 1 ONLY)");
  console.log("============================================================");
  console.log(`Region/Host: ${host}:${port}, User: ${user}, DB: ${database}`);
  console.log(`CA Path: ${caPath} (exists: ${fs.existsSync(caPath)})`);

  const sslConfig = {
    ca: fs.readFileSync(caPath),
    rejectUnauthorized: true,
    checkServerIdentity: checkPinnedServerIdentity
  };

  try {
    const conn = await mysql.createConnection({
      host,
      port,
      user,
      password,
      database,
      ssl: sslConfig,
      connectTimeout: 10000
    });

    const [rows] = await conn.query("SELECT 1 AS alive, VERSION() AS version, USER() AS authenticated_user, CURRENT_USER() AS matched_grant_user");
    console.log("PROBE_RESULT: SUCCESS");
    console.log("Row:", JSON.stringify(rows[0]));
    await conn.end();
    process.exit(0);
  } catch (err) {
    console.log(`PROBE_RESULT: FAILURE [${err.code || "ERR"}] (${err.errno}): ${err.message}`);
    process.exit(1);
  }
}

runProbe();

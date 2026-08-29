// tools/mariadb-live/full-capture-preflight.cjs
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { sourceTransport, assertSourceIndex, assertExplainPlan } = require('./source-preflight.cjs');

const CONTRACT = 'wf-mariadb-private-raw-staging-v1';
const CANONICAL_VERSION = 'v1-json-keys-sorted-compact';
const HASH_ALGO = 'sha256';

const PINNED_MARIADB_SERVER_CERT_SHA256 = '07:F7:B9:58:1B:79:C7:42:61:8D:3F:85:91:DC:54:9B:F1:6E:FB:C6:2E:45:0E:FD:9B:56:F7:54:D3:52:E1:97';
const PINNED_MARIADB_CA_CERT_SHA256 = '08:61:92:B8:05:ED:58:A3:3F:A5:7B:AA:D1:61:DB:CE:2E:63:13:A4:26:12:36:52:60:E0:61:9F:35:6B:94:8B';

function sha256(data) {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function stableJson(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (obj instanceof Date) return JSON.stringify(obj.toISOString());
  if (Array.isArray(obj)) return '[' + obj.map(stableJson).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableJson(obj[k])).join(',') + '}';
}

function canonicalizeRawPayload(rawData) {
  return stableJson(rawData || {});
}

function checkPinnedServerIdentity(servername, cert) {
  if (!cert) {
    throw new Error('TLS Peer Certificate Missing: server did not present a peer certificate');
  }

  const rawHex = cert.raw ? crypto.createHash('sha256').update(cert.raw).digest('hex').toUpperCase() : null;
  const fp256 = cert.fingerprint256 || (rawHex ? rawHex.match(/../g).join(':') : null);

  const expectedFps = [
    PINNED_MARIADB_SERVER_CERT_SHA256,
    PINNED_MARIADB_CA_CERT_SHA256
  ];

  if (!fp256 || !expectedFps.includes(fp256.toUpperCase())) {
    throw new Error(`TLS Certificate Pinning Violation: server certificate fingerprint ${fp256} does not match pinned certificate fingerprint ${PINNED_MARIADB_SERVER_CERT_SHA256}`);
  }

  return undefined; // Strictly verified and pinned
}

function verifyTlsProof(env = process.env) {
  const transport = sourceTransport(env);
  if (transport.transport === 'TLS_CA_VERIFIED') {
    if (!transport.ssl || transport.ssl.rejectUnauthorized !== true) {
      throw new Error('TLS Security Violation: rejectUnauthorized must strictly be true');
    }
    if (!transport.ssl.ca || transport.ssl.ca.length === 0) {
      throw new Error('TLS Security Violation: CA certificate buffer must be non-empty');
    }
  } else if (transport.transport !== 'PRIVATE_TUNNEL_VERIFIED') {
    throw new Error('Transport Security Violation: Unknown or untrusted transport: ' + transport.transport);
  }
  return {
    verified: true,
    transport: transport.transport,
    tls_reject_unauthorized: transport.ssl ? transport.ssl.rejectUnauthorized : null,
    ca_bytes: transport.ssl?.ca ? transport.ssl.ca.length : 0,
    pinned_server_cert_sha256: PINNED_MARIADB_SERVER_CERT_SHA256
  };
}

async function createFrozenSourceBoundary(mariadbConn) {
  await mariadbConn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await mariadbConn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');

  const [countRows] = await mariadbConn.query('SELECT COUNT(*) as total FROM auctions');
  const [minRows] = await mariadbConn.query('SELECT id, created_on, updated_on FROM auctions ORDER BY created_on ASC, id ASC LIMIT 1');
  const [maxRows] = await mariadbConn.query('SELECT id, created_on, updated_on FROM auctions ORDER BY created_on DESC, id DESC LIMIT 1');

  const totalRows = countRows[0]?.total || 0;
  const minBoundary = minRows[0] || null;
  const maxBoundary = maxRows[0] || null;

  if (totalRows === 0 || !minBoundary || !maxBoundary) {
    throw new Error('Source Boundary Error: Empty or unreadable source table auctions');
  }

  const manifest = {
    contract: CONTRACT,
    source_system: 'OceanDigital MariaDB',
    source_database: 'thecollective_inventory',
    source_table: 'auctions',
    isolation_level: 'REPEATABLE READ (CONSISTENT SNAPSHOT, READ ONLY)',
    total_source_rows: totalRows,
    lower_boundary: {
      id: minBoundary.id,
      created_on: minBoundary.created_on instanceof Date ? minBoundary.created_on.toISOString() : minBoundary.created_on,
      updated_on: minBoundary.updated_on instanceof Date ? minBoundary.updated_on.toISOString() : minBoundary.updated_on
    },
    upper_boundary: {
      id: maxBoundary.id,
      created_on: maxBoundary.created_on instanceof Date ? maxBoundary.created_on.toISOString() : maxBoundary.created_on,
      updated_on: maxBoundary.updated_on instanceof Date ? maxBoundary.updated_on.toISOString() : maxBoundary.updated_on
    },
    snapshot_timestamp: new Date().toISOString()
  };

  const manifestJson = stableJson(manifest);
  manifest.manifest_sha256 = sha256(manifestJson);

  return manifest;
}

function buildKeysetQuery({ lastCreatedOn, lastSourceId, upperBoundary, batchSize }) {
  const upperCreatedOn = upperBoundary.created_on;
  const upperId = upperBoundary.id;

  if (!lastCreatedOn && !lastSourceId) {
    return {
      sql: `
        SELECT * FROM auctions
        WHERE (created_on < ? OR (created_on = ? AND id <= ?))
        ORDER BY created_on ASC, id ASC
        LIMIT ?
      `.trim().replace(/\s+/g, ' '),
      params: [upperCreatedOn, upperCreatedOn, upperId, batchSize]
    };
  }

  return {
    sql: `
      SELECT * FROM auctions
      WHERE (
        (created_on > ? OR (created_on = ? AND id > ?))
        AND
        (created_on < ? OR (created_on = ? AND id <= ?))
      )
      ORDER BY created_on ASC, id ASC
      LIMIT ?
    `.trim().replace(/\s+/g, ' '),
    params: [lastCreatedOn, lastCreatedOn, lastSourceId, upperCreatedOn, upperCreatedOn, upperId, batchSize]
  };
}

async function fetchKeysetBatch(mariadbConn, options) {
  const { sql, params } = buildKeysetQuery(options);
  const [rows] = await mariadbConn.query(sql, params);
  return rows || [];
}

function verifyHashReadbackContract(stagedRows, expectedRecords) {
  const stagedBySourceId = new Map();
  for (const row of stagedRows) {
    if (!stagedBySourceId.has(row.source_id)) {
      stagedBySourceId.set(row.source_id, []);
    }
    stagedBySourceId.get(row.source_id).push(row);
  }

  let verifiedCount = 0;
  const mismatches = [];

  for (const exp of expectedRecords) {
    const candidates = stagedBySourceId.get(exp.source_id) || [];
    const exactMatch = candidates.find(c => c.source_hash === exp.source_hash);

    if (!exactMatch) {
      mismatches.push({
        source_id: exp.source_id,
        expected_hash: exp.source_hash,
        error: 'No staged row matched expected source_hash'
      });
      continue;
    }

    const recalculated = sha256(exactMatch.raw_payload_text);
    if (recalculated !== exp.source_hash) {
      mismatches.push({
        source_id: exp.source_id,
        expected_hash: exp.source_hash,
        stored_hash: exactMatch.source_hash,
        recalculated_hash: recalculated,
        error: 'Recalculated hash does not match expected hash'
      });
    } else {
      verifiedCount++;
    }
  }

  if (mismatches.length > 0 || verifiedCount !== expectedRecords.length) {
    throw new Error(`Hash Readback Gate Failure: Verified=${verifiedCount}/${expectedRecords.length}, Mismatches=${mismatches.length}`);
  }

  return {
    verified: true,
    total_verified: verifiedCount,
    mismatches_count: 0
  };
}

function verifyErrorLedgerContract(ledgerRows, expectedErrorCount) {
  if (!Array.isArray(ledgerRows)) {
    throw new Error('Error Ledger Contract Failure: ledger rows must be an array');
  }
  if (ledgerRows.length !== expectedErrorCount) {
    throw new Error(`Error Ledger Contract Discrepancy: Retrieved ${ledgerRows.length} error rows, expected ${expectedErrorCount}`);
  }
  return {
    verified: true,
    error_count: ledgerRows.length,
    reconciled: true
  };
}

function verifyDryRunReconciliation(accounting) {
  const { input_rows, newly_staged, already_staged, errors, public_mutations } = accounting;
  const sum = (newly_staged || 0) + (already_staged || 0) + (errors || 0);

  if (sum !== input_rows) {
    throw new Error(`Reconciliation Formula Discrepancy: Input=${input_rows}, Staged+Existing+Errors=${sum}`);
  }

  if (public_mutations !== 0) {
    throw new Error(`Public Isolation Violation: Detected ${public_mutations} public table writes`);
  }

  return {
    reconciled: true,
    input_rows,
    newly_staged,
    already_staged,
    errors,
    public_mutations,
    formula: 'input_rows = newly_staged + already_staged + errors'
  };
}

module.exports = {
  CONTRACT,
  CANONICAL_VERSION,
  HASH_ALGO,
  PINNED_MARIADB_SERVER_CERT_SHA256,
  PINNED_MARIADB_CA_CERT_SHA256,
  sha256,
  stableJson,
  canonicalizeRawPayload,
  checkPinnedServerIdentity,
  verifyTlsProof,
  createFrozenSourceBoundary,
  buildKeysetQuery,
  fetchKeysetBatch,
  verifyHashReadbackContract,
  verifyErrorLedgerContract,
  verifyDryRunReconciliation
};

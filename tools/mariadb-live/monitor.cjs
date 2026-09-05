'use strict';

const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const { assertReadOnlyGrants, atomicJson, boundedInteger } = require('./lib.cjs');

async function run() {
  const required = ['MARIADB_HOST', 'MARIADB_USER', 'MARIADB_PASSWORD'];
  const missing = required.filter(name => !process.env[name]);
  if (missing.length) throw new Error(`Missing required secret environment variables: ${missing.join(', ')}`);
  const output = path.resolve(process.env.MARIADB_MONITOR_OUTPUT || 'audit-output/mariadb-live/monitor-status.json');
  const staleSeconds = boundedInteger(process.env.MARIADB_STALE_SECONDS, 900, 60, 86_400, 'MARIADB_STALE_SECONDS');
  const sourceOffset = process.env.MARIADB_SOURCE_UTC_OFFSET || '-04:00';
  let db;
  try {
    db = await mysql.createConnection({
      host: process.env.MARIADB_HOST,
      port: boundedInteger(process.env.MARIADB_PORT, 3306, 1, 65535, 'MARIADB_PORT'),
      user: process.env.MARIADB_USER,
      password: process.env.MARIADB_PASSWORD,
      database: process.env.MARIADB_DATABASE || 'thecollective_inventory',
      connectTimeout: 10_000,
      dateStrings: true,
    });
    const [grantRows] = await db.query('SHOW GRANTS FOR CURRENT_USER()');
    assertReadOnlyGrants(grantRows.map(row => Object.values(row)[0]));
    const [rows] = await db.execute(
      `SELECT DATE_FORMAT(MAX(created_on), '%Y-%m-%d %H:%i:%s') latest_created_on,
              COUNT(*) total_rows,
              SUM(created_on >= MAX_CREATED.latest_created_on - INTERVAL 24 HOUR) latest_24h_rows,
              TIMESTAMPDIFF(SECOND, MAX(created_on), CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', ?)) freshness_lag_seconds
       FROM auctions
       CROSS JOIN (SELECT MAX(created_on) latest_created_on FROM auctions) MAX_CREATED`,
      [sourceOffset],
    );
    const row = rows[0];
    const lag = Number(row.freshness_lag_seconds);
    const errors = [];
    if (!row.latest_created_on) errors.push('SOURCE_HAS_NO_ROWS');
    if (!Number.isFinite(lag)) errors.push('FRESHNESS_LAG_UNAVAILABLE');
    if (Number.isFinite(lag) && lag > staleSeconds) errors.push('SOURCE_STALE');
    const report = {
      contract: 'wf-mariadb-source-monitor-v1',
      checked_at: new Date().toISOString(),
      source: 'thecollective_inventory.auctions',
      source_mode: 'READ_ONLY',
      source_utc_offset: sourceOffset,
      latest_created_on: row.latest_created_on,
      freshness_lag_seconds: lag,
      stale_after_seconds: staleSeconds,
      total_rows: Number(row.total_rows),
      latest_24h_rows: Number(row.latest_24h_rows),
      status: errors.length ? 'ERROR' : 'HEALTHY',
      declared_errors: errors,
      production_writes: 0,
    };
    atomicJson(output, report);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (errors.length) process.exitCode = 2;
  } finally {
    if (db) await db.end();
  }
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({ contract: 'wf-mariadb-source-monitor-v1', status: 'ERROR', declared_errors: ['MONITOR_EXECUTION_FAILED'], error_name: error.name || 'Error', error_message: error.message || String(error) })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { run };

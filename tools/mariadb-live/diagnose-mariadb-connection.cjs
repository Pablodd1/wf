// tools/mariadb-live/diagnose-mariadb-connection.cjs
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const { resolveMariaDbTransport } = require('./run-full-private-capture.cjs');

async function diagnose(env = process.env) {
  const result = {
    timestamp: new Date().toISOString(),
    host: env.MARIADB_HOST,
    port: env.MARIADB_PORT || 3306,
    user: env.MARIADB_USER,
    database: env.MARIADB_DATABASE,
    transport: null,
    connected: false,
    error_code: null,
    error_message: null
  };

  try {
    const transport = resolveMariaDbTransport(env);
    result.transport = transport.transport;

    const conn = await mysql.createConnection({
      host: env.MARIADB_HOST,
      port: Number(env.MARIADB_PORT || 3306),
      user: env.MARIADB_USER,
      password: env.MARIADB_PASSWORD,
      database: env.MARIADB_DATABASE,
      ssl: transport.ssl
    });

    result.connected = true;
    const [rows] = await conn.query('SELECT COUNT(*) as c FROM auctions');
    result.total_source_rows = rows[0].c;
    await conn.end();
  } catch (err) {
    result.error_code = err.code || null;
    result.error_message = err.message || String(err);
  }

  const outDir = path.resolve('audit-output/mariadb-live');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'mariadb-connectivity-diagnosis.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  diagnose().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { diagnose };

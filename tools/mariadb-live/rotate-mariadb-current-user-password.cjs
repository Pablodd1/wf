'use strict';

const mysql = require('mysql2/promise');
const { resolveMariaDbTransport } = require('./run-full-private-capture.cjs');

async function rotate(env = process.env) {
  if (!env.MARIADB_PASSWORD || !env.MARIADB_ROTATED_PASSWORD) {
    throw new Error('Current and rotated MariaDB passwords must be provided through environment variables');
  }
  if (env.MARIADB_ROTATED_PASSWORD.length < 32) {
    throw new Error('Rotated MariaDB password does not meet the minimum length');
  }

  const transport = resolveMariaDbTransport(env);
  const db = await mysql.createConnection({
    host: env.MARIADB_HOST,
    port: Number(env.MARIADB_PORT || 3306),
    user: env.MARIADB_USER,
    password: env.MARIADB_PASSWORD,
    database: env.MARIADB_DATABASE,
    ssl: transport.ssl
  });
  // MariaDB does not accept a prepared-statement placeholder inside PASSWORD().
  // mysql2.escape provides the required SQL literal quoting without logging it.
  await db.query(`SET PASSWORD = PASSWORD(${db.escape(env.MARIADB_ROTATED_PASSWORD)})`);
  await db.end();
  return { mariadb_password_rotated: true };
}

if (require.main === module) {
  rotate()
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = { rotate };

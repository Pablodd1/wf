'use strict';

const mysql = require('mysql2/promise');
const { resolveMariaDbTransport } = require('./run-full-private-capture.cjs');

async function verify(env = process.env) {
  const presence = {
    MARIADB_HOST: Boolean(env.MARIADB_HOST),
    MARIADB_USER: Boolean(env.MARIADB_USER),
    MARIADB_PASSWORD: Boolean(env.MARIADB_PASSWORD),
    MARIADB_DATABASE: Boolean(env.MARIADB_DATABASE),
    SUPABASE_URL: Boolean(env.SUPABASE_URL),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(env.SUPABASE_SERVICE_ROLE_KEY)
  };
  if (!presence.MARIADB_PASSWORD) throw new Error('MARIADB_PASSWORD is missing');

  const transport = resolveMariaDbTransport(env);
  const db = await mysql.createConnection({
    host: env.MARIADB_HOST,
    port: Number(env.MARIADB_PORT || 3306),
    user: env.MARIADB_USER,
    password: env.MARIADB_PASSWORD,
    database: env.MARIADB_DATABASE,
    ssl: transport.ssl
  });
  await db.query('SELECT 1');
  await db.end();

  return { presence, mariadb_connection_verified: true, transport: transport.transport };
}

if (require.main === module) {
  verify()
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = { verify };

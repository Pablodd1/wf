'use strict';

const fs = require('node:fs');
const path = require('node:path');

function sourceTransport(env = process.env) {
  if (env.MARIADB_TLS_CA_FILE) {
    const caFile = path.resolve(env.MARIADB_TLS_CA_FILE);
    if (!fs.existsSync(caFile)) throw new Error(`MariaDB TLS CA file does not exist: ${caFile}`);
    return { ssl: { ca: fs.readFileSync(caFile), rejectUnauthorized: true }, transport: 'TLS_CA_VERIFIED' };
  }
  if (env.MARIADB_PRIVATE_TUNNEL_VERIFIED === 'true') return { ssl: null, transport: 'PRIVATE_TUNNEL_VERIFIED' };
  throw new Error('MariaDB source requires a verified TLS CA or an explicitly verified private tunnel');
}

function assertSourceIndex(rows) {
  const indexes = new Map();
  for (const row of rows) {
    const name = row.Key_name || row.key_name;
    const sequence = Number(row.Seq_in_index || row.seq_in_index);
    const column = String(row.Column_name || row.column_name || '').toLowerCase();
    if (!name || !sequence || !column) continue;
    if (!indexes.has(name)) indexes.set(name, []);
    indexes.get(name)[sequence - 1] = column;
  }
  const proved = new Set([...indexes.entries()]
    .filter(([, columns]) => columns[0] === 'created_on' && columns[1] === 'id')
    .map(([name]) => name));
  if (!proved.size) throw new Error('MariaDB auctions requires a composite (created_on, id) cursor index');
  return proved;
}

function assertExplainPlan(rows, provedIndexes) {
  const plan = rows[0] || {};
  const accessType = String(plan.type || '').toUpperCase();
  const boundedAccessTypes = new Set(['RANGE']);
  if (!plan.key || !boundedAccessTypes.has(accessType)
    || !(provedIndexes instanceof Set) || !provedIndexes.has(plan.key)) {
    throw new Error('MariaDB cursor EXPLAIN did not select a proved composite cursor index');
  }
}

async function preflightSource(db, cursor) {
  const [indexRows] = await db.query('SHOW INDEX FROM auctions');
  const proved = assertSourceIndex(indexRows);
  const [explainRows] = await db.execute(
    'EXPLAIN SELECT id, created_on FROM auctions WHERE created_on > ? OR (created_on = ? AND id > ?) ORDER BY created_on ASC, id ASC LIMIT 10',
    [cursor.last_created_on, cursor.last_created_on, cursor.last_id || cursor.last_source_id || ''],
  );
  assertExplainPlan(explainRows, proved);
  return { proved_cursor_indexes: [...proved], selected_cursor_index: explainRows[0].key };
}

module.exports = { assertExplainPlan, assertSourceIndex, preflightSource, sourceTransport };

#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_REF = 'qnsafosakvonzgfcsphh';
const SQL_PATH = path.join(__dirname, 'sql', 'rolex-phase2-readonly-census.sql');
const OUTPUT_DIR = path.resolve(process.env.AUDIT_OUTPUT_DIR || 'audit-output/rolex-phase2-census');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function assertReadOnlySql(sql) {
  const stripped = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:''|[^'])*'/g, "''");
  const forbidden = /\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|EXECUTE|REFRESH|VACUUM|ANALYZE|SET|RESET|NOTIFY|LISTEN|LOCK)\b/i;
  const match = stripped.match(forbidden);
  if (match) throw new Error(`SQL is not read-only: forbidden token ${match[1]}`);
  if (!/^\s*(WITH|SELECT)\b/i.test(stripped)) throw new Error('SQL must start with WITH or SELECT.');
  if ((stripped.match(/;/g) || []).length !== 1 || !/;\s*$/.test(stripped)) {
    throw new Error('SQL must be exactly one statement.');
  }
}

async function managementQuery(sql) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is unavailable.');
  if ((process.env.SUPABASE_PROJECT_REF || PROJECT_REF) !== PROJECT_REF) {
    throw new Error('Census is pinned to canonical QNSA.');
  }
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: sql, read_only: true }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase read-only query failed (${response.status}): ${body.slice(0, 500)}`);
  return JSON.parse(body);
}

function assertSafeReport(census) {
  if (!census || census.contract !== 'watchfacts-rolex-phase2-readonly-census-v1') {
    throw new Error('Unexpected census contract.');
  }
  if (census.project_ref !== PROJECT_REF || census.read_only !== true) {
    throw new Error('Census project/read-only assertion failed.');
  }
  if (census.transaction_read_only !== 'on') {
    throw new Error(`Database transaction was not read-only (${census.transaction_read_only || 'unknown'}).`);
  }
  const serialized = JSON.stringify(census);
  for (const forbidden of ['raw_message_text', 'raw_message', 'phone_number', 'seller_phone', 'contact_number']) {
    if (serialized.includes(`\"${forbidden}\"`)) throw new Error(`Unsafe field leaked into report: ${forbidden}`);
  }
  const counts = census.counts || {};
  for (const [key, value] of Object.entries(counts)) {
    if (!Number.isSafeInteger(Number(value)) || Number(value) < 0) throw new Error(`Invalid count ${key}.`);
  }
  if (Number(census.lineage_integrity?.active_rows_missing_exact_raw_version) !== 0) {
    throw new Error('Active normalized Rolex rows have broken immutable raw lineage.');
  }
}

async function main() {
  const sql = fs.readFileSync(SQL_PATH, 'utf8');
  assertReadOnlySql(sql);
  if (process.argv.includes('--validate-only')) {
    process.stdout.write('Rolex Phase 2 census SQL is one read-only statement.\n');
    return;
  }
  const result = await managementQuery(sql);
  if (!Array.isArray(result) || result.length !== 1 || !result[0]?.census) {
    throw new Error('Census query did not return exactly one report.');
  }
  const census = result[0].census;
  assertSafeReport(census);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const reportText = `${JSON.stringify(census, null, 2)}\n`;
  fs.writeFileSync(path.join(OUTPUT_DIR, 'census.json'), reportText, { encoding: 'utf8', mode: 0o600 });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'manifest.json'), `${JSON.stringify({
    contract: 'watchfacts-rolex-phase2-readonly-census-manifest-v1',
    project_ref: PROJECT_REF,
    read_only: true,
    sql_sha256: sha256(sql),
    census_sha256: sha256(reportText),
    generated_at: census.generated_at,
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ counts: census.counts, checksums: census.checksums }, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

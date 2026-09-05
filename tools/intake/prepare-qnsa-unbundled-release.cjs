'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PROJECT_REF = 'qnsafosakvonzgfcsphh';
const MIGRATION = 'supabase/migrations/20260817030000_reviewed_workbook_unbundled_lineage.sql';
const DEALER_LINK_MIGRATION = 'supabase/migrations/20260817020000_reviewed_workbook_dealer_links.sql';

async function managementRequest(route, { token, body } = {}) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}${route}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`Supabase Management API ${route} failed with ${response.status}`);
  return response.json();
}

function migrationBody(repoRoot, migrationFile = MIGRATION) {
  const migrationPath = path.join(repoRoot, migrationFile);
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const withoutComments = sql.replace(/^\s*--.*$/gm, '');
  if (/\b(?:INSERT\s+INTO|UPDATE\s+[^;]+\s+SET|DELETE\s+FROM|TRUNCATE|COPY)\b/is.test(withoutComments)) {
    throw new Error('unbundled lineage migration may not contain inventory DML');
  }
  return sql
    .replace(/^\s*BEGIN\s*;\s*$/gim, '')
    .replace(/^\s*COMMIT\s*;\s*$/gim, '')
    .trim();
}

async function prepare({ mode, token, repoRoot, envFile }) {
  if (!['audit', 'canary', 'full'].includes(mode)) throw new Error('invalid release mode');
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN unavailable');
  if (!envFile) throw new Error('QNSA_ENV_FILE unavailable');
  const sql = migrationBody(repoRoot);
  const dealerLinkSql = migrationBody(repoRoot, DEALER_LINK_MIGRATION);
  await managementRequest('/database/query', {
    token,
    body: { query: `BEGIN;\n${sql}\nROLLBACK;`, read_only: false },
  });
  await managementRequest('/database/query', {
    token,
    body: { query: `BEGIN;\n${dealerLinkSql}\nROLLBACK;`, read_only: false },
  });
  if (mode !== 'audit') {
    await managementRequest('/database/query', {
      token,
      body: { query: `BEGIN;\n${sql}\nCOMMIT;`, read_only: false },
    });
  }
  if (mode === 'full') {
    await managementRequest('/database/query', {
      token,
      body: { query: `BEGIN;\n${dealerLinkSql}\nCOMMIT;`, read_only: false },
    });
  }
  const verify = await managementRequest('/database/query', {
    token,
    body: {
      query: `SELECT ARRAY['source_platform','source_group_id','source_message_id','parent_source_message_id'] <@ ARRAY(SELECT column_name::text FROM information_schema.columns WHERE table_schema='public' AND table_name='reviewed_workbook_inventory') AS lineage_ready`,
      read_only: true,
    },
  });
  const lineageReady = verify?.[0]?.lineage_ready === true;
  if (mode !== 'audit' && !lineageReady) throw new Error('reviewed workbook lineage schema is not ready');
  const dealerLinkReadyResult = await managementRequest('/database/query', {
    token,
    body: {
      query: `SELECT to_regclass('public.reviewed_workbook_dealer_links') IS NOT NULL AS dealer_link_ready`,
      read_only: true,
    },
  });
  const dealerLinkReady = dealerLinkReadyResult?.[0]?.dealer_link_ready === true;
  if (mode === 'full' && !dealerLinkReady) throw new Error('reviewed workbook dealer link schema is not ready');
  const keys = await managementRequest('/api-keys', { token });
  const service = keys.find(item => item?.api_key && (item.name === 'service_role' || item.type === 'secret'));
  if (!service) throw new Error('QNSA service API key unavailable');
  fs.writeFileSync(envFile, [
    `SUPABASE_URL=https://${PROJECT_REF}.supabase.co`,
    `SUPABASE_SERVICE_ROLE_KEY=${service.api_key}`,
    `EXPECTED_SUPABASE_PROJECT_REF=${PROJECT_REF}`,
    `UNBUNDLED_LINEAGE_SCHEMA_READY=${lineageReady ? 'true' : 'false'}`,
    `UNBUNDLED_DEALER_LINK_SCHEMA_READY=${dealerLinkReady ? 'true' : 'false'}`,
    '',
  ].join('\n'), { mode: 0o600 });
  process.stdout.write(`::add-mask::${service.api_key}\n`);
  return {
    mode,
    project_ref: PROJECT_REF,
    migration: MIGRATION,
    dealer_link_migration: DEALER_LINK_MIGRATION,
    lineage_ready: lineageReady,
    dealer_link_ready: dealerLinkReady,
    audit_schema_pending: mode === 'audit' && !lineageReady,
  };
}

if (require.main === module) {
  prepare({
    mode: process.env.RELEASE_MODE,
    token: process.env.SUPABASE_ACCESS_TOKEN,
    repoRoot: process.cwd(),
    envFile: process.env.QNSA_ENV_FILE,
  }).then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => {
    process.stderr.write(`${JSON.stringify({ status: 'error', error: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { DEALER_LINK_MIGRATION, MIGRATION, PROJECT_REF, migrationBody, prepare };

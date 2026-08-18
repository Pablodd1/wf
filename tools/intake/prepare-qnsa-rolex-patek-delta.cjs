'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PROJECT_REF = 'qnsafosakvonzgfcsphh';
const MIGRATION = 'supabase/migrations/20260817120000_qnsa_rolex_patek_delta_lineage.sql';
const REPAIR_MIGRATION = 'supabase/migrations/20260817123000_qnsa_rolex_patek_delta_overlap_index_repair.sql';
const MIGRATIONS = [MIGRATION, REPAIR_MIGRATION];

async function request(route, token, body) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}${route}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`Supabase Management API ${route} failed with ${response.status}`);
  return response.json();
}

function migrationSql(root, migrations = MIGRATIONS) {
  const body = migrations.map(file => fs.readFileSync(path.join(root, file), 'utf8')
    .replace(/^\s*(?:BEGIN|COMMIT)\s*;\s*$/gim, '').trim()).join('\n\n');
  const withoutFunctions = body.replace(/CREATE OR REPLACE FUNCTION[\s\S]*?\$\$\s*;/gi, '');
  if (/^\s*(?:INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|TRUNCATE|COPY)\b/im.test(withoutFunctions)) {
    throw new Error('delta lineage migration may not contain top-level inventory DML');
  }
  return body;
}

async function prepare({ mode, token, root, envFile }) {
  if (!['schema', 'audit', 'canary', 'full'].includes(mode)) throw new Error('invalid release mode');
  if (!token || !envFile) throw new Error('management token and QNSA_ENV_FILE are required');
  const sql = migrationSql(root);
  await request('/database/query', token, { query: `BEGIN;\n${sql}\nROLLBACK;`, read_only: false });
  if (mode !== 'audit') {
    await request('/database/query', token, { query: `BEGIN;\n${sql}\nCOMMIT;`, read_only: false });
  }
  const schema = await request('/database/query', token, {
    query: `SELECT
      ARRAY['source_platform','source_group_id','source_message_id'] <@ ARRAY(SELECT column_name::text FROM information_schema.columns WHERE table_schema='public' AND table_name='reviewed_workbook_inventory')
      AND to_regclass('public.reviewed_workbook_delta_release_runs') IS NOT NULL
      AND to_regprocedure('public.qnsa_rolex_patek_delta_overlap(text[],jsonb)') IS NOT NULL
      AND to_regprocedure('public.rollback_qnsa_rolex_patek_delta(text,text[])') IS NOT NULL AS ready`,
    read_only: true,
  });
  if (schema?.[0]?.ready !== true) throw new Error('private delta lineage schema is not ready');
  const keys = await request('/api-keys', token);
  const service = keys.find(item => item?.api_key && (item.name === 'service_role' || item.type === 'secret'));
  if (!service) throw new Error('QNSA service key unavailable');
  fs.writeFileSync(envFile, [
    `SUPABASE_URL=https://${PROJECT_REF}.supabase.co`,
    `SUPABASE_SERVICE_ROLE_KEY=${service.api_key}`,
    '',
  ].join('\n'), { mode: 0o600 });
  process.stdout.write(`::add-mask::${service.api_key}\n`);
  return { project_ref: PROJECT_REF, mode, schema_ready: true };
}

if (require.main === module) prepare({
  mode: process.env.RELEASE_MODE,
  token: process.env.SUPABASE_ACCESS_TOKEN,
  root: process.cwd(),
  envFile: process.env.QNSA_ENV_FILE,
}).then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => {
  process.stderr.write(`${JSON.stringify({ status: 'error', error: error.message })}\n`);
  process.exitCode = 1;
});

module.exports = { MIGRATION, MIGRATIONS, PROJECT_REF, REPAIR_MIGRATION, migrationSql, prepare };

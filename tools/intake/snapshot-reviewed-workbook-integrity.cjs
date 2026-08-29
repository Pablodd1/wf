'use strict';

// Capture a PII-free, exact-ID recovery snapshot before the atomic reviewed
// workbook correction when project-level PITR is unavailable.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const {
  PROJECT_REF, assertQnsa, buildPlan, readCsv,
} = require('./apply-reviewed-workbook-integrity-canary.cjs');

const TABLE = 'reviewed_workbook_inventory';

function text(value) { return value === null || value === undefined ? '' : String(value).trim(); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!key?.startsWith('--') || argv[index + 1] === undefined) throw new Error(`invalid argument: ${key}`);
    values[key.slice(2)] = argv[index + 1];
  }
  return {
    identityManifest: values['identity-manifest'],
    residualIdentityManifest: values['residual-identity-manifest'],
    priceManifest: values['price-manifest'],
    driftPriceManifest: values['drift-price-manifest'],
    promotionManifest: values['promotion-manifest'],
    outputDir: values['output-dir'],
    confirmProject: values['confirm-project'],
    runSha: text(values['run-sha']),
  };
}

async function captureSnapshot(client, plan) {
  const rows = [];
  for (let offset = 0; offset < plan.length; offset += 100) {
    const batch = plan.slice(offset, offset + 100);
    const { data, error } = await client.from(TABLE)
      .select('id,source_payload_sha256,verification_status,price_evidence_status,workbook_price_usd,updated_at')
      .in('id', batch.map(action => action.id));
    if (error) throw error;
    rows.push(...(data || []));
  }
  const byId = new Map(rows.map(row => [row.id, row]));
  if (rows.length !== plan.length || byId.size !== plan.length) {
    throw new Error(`recovery snapshot count mismatch: expected ${plan.length}, received ${rows.length}`);
  }
  for (const action of plan) {
    const row = byId.get(action.id);
    if (!row || text(row.source_payload_sha256).toLowerCase() !== action.source_payload_sha256) {
      throw new Error(`recovery snapshot exact hash mismatch: ${action.id}`);
    }
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  assertQnsa(process.env.SUPABASE_URL || '', options.confirmProject);
  if (!/^[0-9a-f]{40}$/i.test(options.runSha)) throw new Error('run-sha must be a 40-character commit sha');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('service-role credential is required');
  const plan = buildPlan({
    identityRows: readCsv(options.identityManifest).rows,
    residualIdentityRows: readCsv(options.residualIdentityManifest).rows,
    priceRows: readCsv(options.priceManifest).rows,
    driftPriceRows: readCsv(options.driftPriceManifest).rows,
    promotionRows: readCsv(options.promotionManifest).rows,
  });
  const client = createClient(process.env.SUPABASE_URL, key, { auth: { persistSession: false } });
  const rows = await captureSnapshot(client, plan);
  const snapshot = {
    captured_at: new Date().toISOString(),
    project_ref: PROJECT_REF,
    run_sha: options.runSha,
    rows: rows.length,
    full_plan_sha256: sha256(JSON.stringify(plan)),
    mutable_fields: ['verification_status', 'price_evidence_status', 'workbook_price_usd', 'updated_at'],
    records: rows,
  };
  fs.mkdirSync(options.outputDir, { recursive: true });
  const output = path.join(options.outputDir, 'recovery-snapshot.json');
  fs.writeFileSync(output, `${JSON.stringify(snapshot, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ...snapshot, records: undefined, output }, null, 2)}\n`);
  return snapshot;
}

if (require.main === module) run().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = { captureSnapshot, parseArgs, run };

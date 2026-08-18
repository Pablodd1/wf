'use strict';

// QNSA-pinned, PII-free control runner for exact reviewed-workbook corrections.
// Audit is the default. Canary/full require explicit confirmation and
// never modify immutable raw/source lineage columns.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const PROJECT_REF = 'qnsafosakvonzgfcsphh';
const TABLE = 'reviewed_workbook_inventory';
const CONFIRM_CANARY = 'APPLY_QNSA_REVIEWED_WORKBOOK_CANARY';
const CONFIRM_FULL = 'APPLY_QNSA_REVIEWED_WORKBOOK_FULL_AFTER_CANARY';

function text(value) { return value === null || value === undefined ? '' : String(value).trim(); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function readCsv(filePath) {
  if (!filePath) return [];
  const buffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: true });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: null, raw: true });
  return { rows, sha256: sha256(buffer), file: path.resolve(filePath) };
}

function validateHash(value, field) {
  if (!/^[0-9a-f]{64}$/i.test(text(value))) throw new Error(`${field} must be sha256`);
  return text(value).toLowerCase();
}

function strictBoolean(value, field) {
  if (value === true || value === false) return value;
  const normalized = text(value).toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error(`${field} must be true or false`);
}

function legacyDriftPatch(row) {
  const target = text(row.target_price_evidence_status);
  // Older currency-conflict manifests predate per-row targets. Preserve their
  // fail-closed behavior while allowing the deterministic legacy-ledger audit
  // to distinguish unpriced rows from Trading-Floor-only price evidence.
  if (!target) {
    return { price_evidence_status: 'PRICE_EVIDENCE_INCOMPLETE', workbook_price_usd: null };
  }
  if (!['PRICE_NOT_SUPPLIED', 'PRICE_RESEARCH_ADMISSION_NOT_ELIGIBLE'].includes(target)) {
    throw new Error(`unsupported target_price_evidence_status: ${target}`);
  }
  const patch = { price_evidence_status: target };
  if (strictBoolean(row.null_price, 'null_price')) patch.workbook_price_usd = null;
  return patch;
}

function assertManifestControl(row, action, expectedStatus, newStatus) {
  if (text(row.action) !== action
    || text(row.expected_status) !== expectedStatus
    || text(row.new_status) !== newStatus) {
    throw new Error(`manifest control fields do not match ${action}`);
  }
}

function canaryMetadata(row) {
  const priority = Number(row.canary_priority || 1000);
  if (!Number.isInteger(priority) || priority < 1) throw new Error('canary_priority must be a positive integer');
  const category = text(row.canary_category);
  if (!category) throw new Error('canary_category is required');
  return { canary_priority: priority, canary_category: category };
}

function buildPlan({ identityRows = [], residualIdentityRows = [], priceRows = [], driftPriceRows = [], promotionRows = [] }) {
  const actions = [];
  for (const [rows, actionName] of [
    [identityRows, 'QUARANTINE_IDENTITY_CONFLICT'],
    [residualIdentityRows, 'QUARANTINE_RESIDUAL_IDENTITY_CONFLICT'],
  ]) for (const row of rows) {
    assertManifestControl(
      row, actionName,
      'APPROVED_SINGLE_CANDIDATE', 'QUARANTINED_IDENTITY_CONFLICT',
    );
    const alsoHoldPrice = strictBoolean(row.also_hold_price, 'also_hold_price');
    const action = {
      action: actionName,
      id: text(row.listing_id),
      source_payload_sha256: validateHash(row.source_payload_sha256, 'source_payload_sha256'),
      expected: { verification_status: 'APPROVED_SINGLE_CANDIDATE' },
      patch: { verification_status: 'QUARANTINED_IDENTITY_CONFLICT' },
      ...canaryMetadata(row),
    };
    if (alsoHoldPrice) {
      if (text(row.expected_price_status) !== 'SOURCE_EXPLICIT_USD_MATCH'
        || text(row.new_price_status) !== 'PRICE_EVIDENCE_INCOMPLETE') {
        throw new Error('dual identity/price action has invalid price control fields');
      }
      action.expected.price_evidence_status = 'SOURCE_EXPLICIT_USD_MATCH';
      action.patch.price_evidence_status = 'PRICE_EVIDENCE_INCOMPLETE';
      action.patch.workbook_price_usd = null;
    }
    actions.push(action);
  }
  for (const row of priceRows) {
    assertManifestControl(
      row, 'HOLD_CURRENCY_CONFLICT_PRICE',
      'SOURCE_EXPLICIT_USD_MATCH', 'PRICE_EVIDENCE_INCOMPLETE',
    );
    const mergedResidual = actions.find(action => action.id === text(row.listing_id)
      && action.action === 'QUARANTINE_RESIDUAL_IDENTITY_CONFLICT');
    if (mergedResidual) {
      if (mergedResidual.source_payload_sha256 !== validateHash(row.source_payload_sha256, 'source_payload_sha256')
        || mergedResidual.expected.price_evidence_status !== 'SOURCE_EXPLICIT_USD_MATCH'
        || mergedResidual.patch.price_evidence_status !== 'PRICE_EVIDENCE_INCOMPLETE'
        || mergedResidual.patch.workbook_price_usd !== null) {
        throw new Error('residual identity/price overlap is not an exact controlled merge');
      }
      continue;
    }
    actions.push({
      action: 'HOLD_CURRENCY_CONFLICT_PRICE',
      id: text(row.listing_id),
      source_payload_sha256: validateHash(row.source_payload_sha256, 'source_payload_sha256'),
      expected: { price_evidence_status: 'SOURCE_EXPLICIT_USD_MATCH' },
      patch: { price_evidence_status: 'PRICE_EVIDENCE_INCOMPLETE', workbook_price_usd: null },
      evidence_reason: text(row.drift_reason) || text(row.reason) || 'RAW_WORKBOOK_CURRENCY_CONFLICT',
      ...canaryMetadata(row),
    });
  }
  for (const row of driftPriceRows) {
    assertManifestControl(
      row, 'RECONCILE_LEGACY_LEDGER_PRICE_EVIDENCE',
      'SOURCE_EXPLICIT_USD_MATCH', text(row.target_price_evidence_status),
    );
    actions.push({
      action: 'RECONCILE_LEGACY_LEDGER_PRICE_EVIDENCE',
      id: text(row.listing_id),
      source_payload_sha256: validateHash(row.source_payload_sha256, 'source_payload_sha256'),
      expected: { price_evidence_status: 'SOURCE_EXPLICIT_USD_MATCH' },
      patch: legacyDriftPatch(row),
      evidence_reason: text(row.drift_reason) || 'CURRENT_STRICT_IMPORTER_DEMOTION',
      ...canaryMetadata(row),
    });
  }
  for (const row of promotionRows) {
    const proposedPrice = Number(row.proposed_price_usd);
    const expectedStatus = text(row.expected_status);
    if (text(row.action) !== 'PROMOTE_EXACT_RAW_USD_PRICE'
      || !['PRICE_RESEARCH_ADMISSION_NOT_ELIGIBLE', 'DATED_FX_PROVENANCE_REQUIRES_EXISTING_SIDECAR'].includes(expectedStatus)
      || text(row.new_status) !== 'SOURCE_EXPLICIT_USD_MATCH'
      || !Number.isFinite(proposedPrice) || proposedPrice < 1000
      || !['USD', 'USDT'].includes(text(row.source_currency).toUpperCase())) {
      throw new Error('promotion manifest control fields are invalid');
    }
    actions.push({
      action: 'PROMOTE_EXACT_RAW_USD_PRICE',
      id: text(row.listing_id),
      source_payload_sha256: validateHash(row.source_payload_sha256, 'source_payload_sha256'),
      expected: { verification_status: 'APPROVED_SINGLE_CANDIDATE', price_evidence_status: expectedStatus },
      patch: { price_evidence_status: 'SOURCE_EXPLICIT_USD_MATCH', workbook_price_usd: proposedPrice },
      evidence_reason: 'EXACT_RAW_USD_USDT_IDENTITY_SUPPORTED',
      ...canaryMetadata(row),
    });
  }
  if (actions.some(action => !action.id)) throw new Error('listing_id is required');
  const duplicates = actions.filter((action, index) => actions.findIndex(other => other.id === action.id) !== index);
  if (duplicates.length) throw new Error('manifests contain overlapping or duplicate listing ids');
  return actions.sort((left, right) => left.id.localeCompare(right.id));
}

function assertQnsa(url, confirmProject) {
  if (confirmProject !== PROJECT_REF) throw new Error('explicit QNSA project confirmation is required');
  const parsed = new URL(url);
  if (parsed.hostname !== `${PROJECT_REF}.supabase.co`) throw new Error('SUPABASE_URL is not canonical QNSA');
}

function validateMode(options, actions, fullPlanSha256 = null) {
  if (options.mode === 'audit') return;
  if (!/^[0-9a-f]{40}$/i.test(text(options.runSha))) throw new Error('write modes require the exact 40-character workflow commit sha');
  if (options.mode === 'canary') {
    if (options.confirm !== CONFIRM_CANARY) throw new Error('canary confirmation token mismatch');
    if (actions.length < 1 || actions.length > 10) throw new Error('canary must contain 1..10 exact rows');
  } else if (options.mode === 'full') {
    if (options.confirm !== CONFIRM_FULL) throw new Error('full confirmation token mismatch');
    if (!options.canaryReport) throw new Error('successful canary report is required before full mode');
    const canary = JSON.parse(fs.readFileSync(options.canaryReport, 'utf8'));
    if (canary.mode !== 'canary' || canary.status !== 'COMPLETE' || canary.failed_rows !== 0
      || canary.reconciled_rows !== canary.requested_rows || canary.project_ref !== PROJECT_REF
      || canary.run_sha !== options.runSha
      || !fullPlanSha256 || canary.full_plan_sha256 !== fullPlanSha256
      || !/^[0-9a-f]{64}$/.test(text(canary.control_plan_sha256))) {
      throw new Error('canary report is not complete and reconciled');
    }
  } else throw new Error('mode must be audit, canary, or full');
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    values[argv[index].slice(2)] = argv[++index];
  }
  return {
    mode: values.mode || 'audit',
    identityManifest: values['identity-manifest'],
    residualIdentityManifest: values['residual-identity-manifest'],
    priceManifest: values['price-manifest'],
    driftPriceManifest: values['drift-price-manifest'], promotionManifest: values['promotion-manifest'],
    outputDir: path.resolve(values['output-dir'] || path.join('audit-output', `reviewed-integrity-${Date.now()}`)),
    confirmProject: values['confirm-project'], confirm: values.confirm,
    maxIdentity: Number(values['max-identity'] || 0), maxPrice: Number(values['max-price'] || 0),
    maxLegacy: Number(values['max-legacy'] || 0), maxResidual: Number(values['max-residual'] || 0),
    maxPromotion: Number(values['max-promotion'] || 0),
    runSha: values['run-sha'],
    canaryReport: values['canary-report'],
  };
}

function selectActions(plan, options) {
  if (options.mode !== 'canary') return plan;
  const prioritize = rows => [...rows].sort((left, right) => (
    left.canary_priority - right.canary_priority || left.id.localeCompare(right.id)
  ));
  const representatives = (rows, limit) => {
    const ordered = prioritize(rows);
    const selected = [];
    const categories = new Set();
    for (const row of ordered) {
      if (selected.length >= limit) break;
      if (categories.has(row.canary_category)) continue;
      categories.add(row.canary_category);
      selected.push(row);
    }
    for (const row of ordered) {
      if (selected.length >= limit) break;
      if (!selected.includes(row)) selected.push(row);
    }
    return selected;
  };
  const identity = representatives(plan.filter(action => (
    action.action === 'QUARANTINE_IDENTITY_CONFLICT'
  )), options.maxIdentity);
  const residual = representatives(plan.filter(action => (
    action.action === 'QUARANTINE_RESIDUAL_IDENTITY_CONFLICT'
  )), options.maxResidual);
  const price = representatives(plan.filter(action => [
    'HOLD_CURRENCY_CONFLICT_PRICE',
  ].includes(action.action)), options.maxPrice);
  const legacy = representatives(plan.filter(action => (
    action.action === 'RECONCILE_LEGACY_LEDGER_PRICE_EVIDENCE'
  )), options.maxLegacy);
  const promotion = representatives(plan.filter(action => (
    action.action === 'PROMOTE_EXACT_RAW_USD_PRICE'
  )), Number(options.maxPromotion || 0));
  return [...identity, ...residual, ...price, ...legacy, ...promotion].sort((left, right) => left.id.localeCompare(right.id));
}

function sqlLiteral(value) { return `'${String(value).replaceAll("'", "''")}'`; }

function atomicFullSql(actions) {
  const payload = actions.map(action => ({
    id: action.id,
    source_payload_sha256: action.source_payload_sha256,
    action: action.action,
    expected_verification_status: action.expected.verification_status || null,
    new_verification_status: action.patch.verification_status || null,
    expected_price_status: action.expected.price_evidence_status || null,
    new_price_status: action.patch.price_evidence_status || null,
    set_price: Object.hasOwn(action.patch, 'workbook_price_usd'),
    new_price: Object.hasOwn(action.patch, 'workbook_price_usd') ? action.patch.workbook_price_usd : null,
  }));
  const json = sqlLiteral(JSON.stringify(payload));
  return `BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
CREATE TEMP TABLE reviewed_integrity_plan ON COMMIT DROP AS
SELECT * FROM jsonb_to_recordset(${json}::jsonb) AS p(
  id text, source_payload_sha256 text, action text,
  expected_verification_status text, new_verification_status text,
  expected_price_status text, new_price_status text, set_price boolean, new_price numeric
);
DO $control$
DECLARE
  expected_count integer := ${actions.length};
  matched_count integer;
  eligible_count integer;
  updated_count integer;
  immutable_before text;
  immutable_after text;
BEGIN
  SELECT count(*) INTO matched_count
  FROM public.reviewed_workbook_inventory t
  JOIN reviewed_integrity_plan p
    ON p.id = t.id AND p.source_payload_sha256 = t.source_payload_sha256;
  IF matched_count <> expected_count THEN
    RAISE EXCEPTION 'exact id/hash match count % differs from plan %', matched_count, expected_count;
  END IF;

  SELECT count(*) INTO eligible_count
  FROM public.reviewed_workbook_inventory t
  JOIN reviewed_integrity_plan p
    ON p.id = t.id AND p.source_payload_sha256 = t.source_payload_sha256
  WHERE (p.action IN ('QUARANTINE_IDENTITY_CONFLICT', 'QUARANTINE_RESIDUAL_IDENTITY_CONFLICT')
      AND t.verification_status IN (p.expected_verification_status, p.new_verification_status)
      AND (p.expected_price_status IS NULL
        OR t.price_evidence_status IN (p.expected_price_status, p.new_price_status)))
     OR (p.action IN ('HOLD_CURRENCY_CONFLICT_PRICE', 'RECONCILE_LEGACY_LEDGER_PRICE_EVIDENCE', 'PROMOTE_EXACT_RAW_USD_PRICE')
      AND (p.expected_verification_status IS NULL OR t.verification_status = p.expected_verification_status)
      AND t.price_evidence_status IN (p.expected_price_status, p.new_price_status));
  IF eligible_count <> expected_count THEN
    RAISE EXCEPTION 'eligible state count % differs from plan %', eligible_count, expected_count;
  END IF;

  SELECT md5(string_agg((to_jsonb(t) - 'verification_status' - 'price_evidence_status'
    - 'workbook_price_usd' - 'updated_at')::text, E'\\n' ORDER BY t.id))
  INTO immutable_before
  FROM public.reviewed_workbook_inventory t
  JOIN reviewed_integrity_plan p
    ON p.id = t.id AND p.source_payload_sha256 = t.source_payload_sha256;

  UPDATE public.reviewed_workbook_inventory t
  SET verification_status = CASE WHEN p.action IN ('QUARANTINE_IDENTITY_CONFLICT', 'QUARANTINE_RESIDUAL_IDENTITY_CONFLICT')
        THEN p.new_verification_status ELSE t.verification_status END,
      price_evidence_status = CASE WHEN p.new_price_status IS NOT NULL
        THEN p.new_price_status ELSE t.price_evidence_status END,
      workbook_price_usd = CASE WHEN p.set_price THEN p.new_price ELSE t.workbook_price_usd END,
      updated_at = now()
  FROM reviewed_integrity_plan p
  WHERE p.id = t.id AND p.source_payload_sha256 = t.source_payload_sha256;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> expected_count THEN
    RAISE EXCEPTION 'atomic update count % differs from plan %', updated_count, expected_count;
  END IF;

  SELECT md5(string_agg((to_jsonb(t) - 'verification_status' - 'price_evidence_status'
    - 'workbook_price_usd' - 'updated_at')::text, E'\\n' ORDER BY t.id))
  INTO immutable_after
  FROM public.reviewed_workbook_inventory t
  JOIN reviewed_integrity_plan p
    ON p.id = t.id AND p.source_payload_sha256 = t.source_payload_sha256;
  IF immutable_before IS DISTINCT FROM immutable_after THEN
    RAISE EXCEPTION 'immutable source-row hash changed';
  END IF;

  SELECT count(*) INTO matched_count
  FROM public.reviewed_workbook_inventory t
  JOIN reviewed_integrity_plan p
    ON p.id = t.id AND p.source_payload_sha256 = t.source_payload_sha256
  WHERE (p.action IN ('QUARANTINE_IDENTITY_CONFLICT', 'QUARANTINE_RESIDUAL_IDENTITY_CONFLICT')
      AND t.verification_status = p.new_verification_status
      AND (p.new_price_status IS NULL OR (t.price_evidence_status = p.new_price_status
        AND (NOT p.set_price OR t.workbook_price_usd IS NOT DISTINCT FROM p.new_price))))
     OR (p.action IN ('HOLD_CURRENCY_CONFLICT_PRICE', 'RECONCILE_LEGACY_LEDGER_PRICE_EVIDENCE', 'PROMOTE_EXACT_RAW_USD_PRICE')
      AND (p.new_verification_status IS NULL OR t.verification_status = p.new_verification_status)
      AND t.price_evidence_status = p.new_price_status
      AND (NOT p.set_price OR t.workbook_price_usd IS NOT DISTINCT FROM p.new_price));
  IF matched_count <> expected_count THEN
    RAISE EXCEPTION 'post-update reconciliation count % differs from plan %', matched_count, expected_count;
  END IF;
END
$control$;
COMMIT;`;
}

async function executeFullAtomic(actions, accessToken) {
  if (!accessToken) throw new Error('full mode requires SUPABASE_ACCESS_TOKEN for one atomic Management SQL transaction');
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: atomicFullSql(actions), read_only: false }),
  });
  if (!response.ok) throw new Error(`atomic Management SQL failed (${response.status}): ${await response.text()}`);
}

async function readExact(client, action) {
  const { data, error } = await client.from(TABLE)
    .select('id,source_payload_sha256,verification_status,price_evidence_status,workbook_price_usd')
    .eq('id', action.id).eq('source_payload_sha256', action.source_payload_sha256).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function executeAction(client, action) {
  const before = await readExact(client, action);
  if (!before) return { action, status: 'FAILED_EXACT_ID_HASH_NOT_FOUND', before: null, after: null };
  const alreadyApplied = Object.entries(action.patch).every(([field, value]) => before[field] === value);
  if (alreadyApplied) return { action, status: 'ALREADY_APPLIED', before, after: before };
  for (const [field, expected] of Object.entries(action.expected)) {
    if (before[field] !== expected) return { action, status: `FAILED_EXPECTED_${field.toUpperCase()}`, before, after: null };
  }
  let query = client.from(TABLE).update(action.patch)
    .eq('id', action.id).eq('source_payload_sha256', action.source_payload_sha256);
  for (const [field, expected] of Object.entries(action.expected)) query = query.eq(field, expected);
  const { data, error } = await query.select('id,source_payload_sha256,verification_status,price_evidence_status,workbook_price_usd').maybeSingle();
  if (error) throw error;
  if (!data) return { action, status: 'FAILED_GUARDED_UPDATE_ZERO_ROWS', before, after: null };
  return { action, status: 'UPDATED', before, after: data };
}

async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const identity = readCsv(options.identityManifest);
  const residualIdentity = readCsv(options.residualIdentityManifest);
  const price = readCsv(options.priceManifest);
  const driftPrice = readCsv(options.driftPriceManifest);
  const promotion = readCsv(options.promotionManifest);
  const plan = buildPlan({
    identityRows: identity.rows || [], residualIdentityRows: residualIdentity.rows || [],
    priceRows: price.rows || [],
    driftPriceRows: driftPrice.rows || [], promotionRows: promotion.rows || [],
  });
  const actions = selectActions(plan, options);
  const fullPlanSha256 = sha256(JSON.stringify(plan));
  validateMode(options, actions, fullPlanSha256);
  fs.mkdirSync(options.outputDir, { recursive: true });
  const manifest = {
    generated_at: new Date().toISOString(), project_ref: PROJECT_REF, mode: options.mode,
    run_sha: options.runSha || null,
    source_manifests: [
      identity.file && { role: 'identity_conflicts', file: identity.file, sha256: identity.sha256, rows: identity.rows.length },
      residualIdentity.file && { role: 'residual_identity_conflicts', file: residualIdentity.file, sha256: residualIdentity.sha256, rows: residualIdentity.rows.length },
      price.file && { role: 'three_brand_currency_regressions', file: price.file, sha256: price.sha256, rows: price.rows.length },
      driftPrice.file && { role: 'legacy_ledger_price_drift', file: driftPrice.file, sha256: driftPrice.sha256, rows: driftPrice.rows.length },
      promotion.file && { role: 'exact_raw_usd_promotions', file: promotion.file, sha256: promotion.sha256, rows: promotion.rows.length },
    ].filter(Boolean),
    planned_rows: plan.length, requested_rows: actions.length,
    full_plan_sha256: fullPlanSha256,
    selected_plan_sha256: sha256(JSON.stringify(actions)),
    actions: actions.map(action => ({ ...action, patch: action.patch })), database_writes: 0,
  };
  manifest.control_plan_sha256 = sha256(JSON.stringify(manifest));
  fs.writeFileSync(path.join(options.outputDir, 'control-plan.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (options.mode === 'audit') { process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`); return manifest; }
  assertQnsa(process.env.SUPABASE_URL || '', options.confirmProject);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('service-role credential is required');
  const client = createClient(process.env.SUPABASE_URL, key, { auth: { persistSession: false } });
  const results = [];
  if (options.mode === 'full') {
    await executeFullAtomic(actions, process.env.SUPABASE_ACCESS_TOKEN);
    for (const action of actions) {
      const after = await readExact(client, action);
      const reconciled = after && Object.entries(action.patch).every(([field, value]) => after[field] === value);
      results.push({ action, status: reconciled ? 'RECONCILED_ATOMIC' : 'FAILED_POST_ATOMIC_RECONCILIATION', before: null, after });
    }
    fs.writeFileSync(path.join(options.outputDir, 'execution-checkpoint.json'), `${JSON.stringify({
      project_ref: PROJECT_REF, mode: options.mode, run_sha: options.runSha,
      full_plan_sha256: fullPlanSha256, control_plan_sha256: manifest.control_plan_sha256,
      requested_rows: actions.length, processed_rows: results.length,
      atomic_transaction_completed: true, results,
    }, null, 2)}\n`);
  } else for (const action of actions) {
    results.push(await executeAction(client, action));
    const checkpoint = {
      project_ref: PROJECT_REF, mode: options.mode, full_plan_sha256: fullPlanSha256,
      control_plan_sha256: manifest.control_plan_sha256, requested_rows: actions.length,
      processed_rows: results.length, results,
    };
    const checkpointPath = path.join(options.outputDir, 'execution-checkpoint.json');
    const temporaryPath = `${checkpointPath}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
    fs.renameSync(temporaryPath, checkpointPath);
  }
  const updated = results.filter(result => result.status === 'UPDATED').length;
  const alreadyApplied = results.filter(result => result.status === 'ALREADY_APPLIED').length;
  const atomicReconciled = results.filter(result => result.status === 'RECONCILED_ATOMIC').length;
  const reconciled = updated + alreadyApplied + atomicReconciled;
  const report = { ...manifest, status: reconciled === actions.length ? 'COMPLETE' : 'FAILED', updated_rows: updated, already_applied_rows: alreadyApplied, atomic_reconciled_rows: atomicReconciled, reconciled_rows: reconciled, failed_rows: actions.length - reconciled, database_writes: options.mode === 'full' ? atomicReconciled : updated, resumable: options.mode !== 'full', atomic: options.mode === 'full', results };
  fs.writeFileSync(path.join(options.outputDir, 'execution-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (report.failed_rows) throw new Error('one or more guarded updates failed; stop before expansion');
  return report;
}

if (require.main === module) run().catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });

module.exports = {
  PROJECT_REF, assertQnsa, atomicFullSql, buildPlan, legacyDriftPatch, readCsv, selectActions,
  strictBoolean, validateMode,
};

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const RUN_ID = '17d6d831-86cd-5e67-9830-c881bcf16e0d';
const PROJECT_REF = 'qnsafosakvonzgfcsphh';
const POSTER_EVIDENCE_VERSION = 'card-poster-evidence-v1';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readJson(file) {
  const value = fs.readFileSync(file);
  return JSON.parse((file.endsWith('.gz') ? zlib.gunzipSync(value) : value).toString('utf8'));
}

function chunks(rows, size = 1000) {
  const result = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result;
}

async function request(url, options, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(120000) });
      if (response.ok) return response;
      const body = await response.text();
      if (![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === attempts) {
        throw new Error(`HTTP ${response.status}: ${body.slice(0, 1000)}`);
      }
      lastError = new Error(`HTTP ${response.status}: ${body.slice(0, 1000)}`);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
    }
    await new Promise(resolve => setTimeout(resolve, attempt * 1000));
  }
  throw lastError;
}

function restHeaders(key, prefer = 'return=minimal') {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: prefer };
}

async function insertRows(baseUrl, key, table, conflictColumns, rows) {
  let loaded = 0;
  for (const group of chunks(rows)) {
    const url = `${baseUrl}/rest/v1/${table}?on_conflict=${encodeURIComponent(conflictColumns)}`;
    await request(url, { method: 'POST', headers: restHeaders(key, 'resolution=ignore-duplicates,return=minimal'),
      body: JSON.stringify(group) });
    loaded += group.length;
  }
  return loaded;
}

async function rpc(baseUrl, key, name, body) {
  const response = await request(`${baseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: restHeaders(key, 'return=representation'), body: JSON.stringify(body),
  });
  return response.json();
}

async function main() {
  const mode = String(process.env.CARD_EVIDENCE_LOAD_MODE || 'dry-run');
  if (!['dry-run', 'canary', 'full'].includes(mode)) throw new Error('CARD_EVIDENCE_LOAD_MODE must be dry-run, canary, or full');
  const root = path.resolve(required('CARD_EVIDENCE_OUTPUT'));
  const manifest = readJson(path.join(root, 'card-evidence-manifest.json'));
  if (manifest.shadow_run_id !== RUN_ID || manifest.source_freeze_run_id !== '32953447624'
    || manifest.raw_source_mutated !== false || manifest.frozen_cohort_mutated !== false
    || manifest.production_selector_changed !== false) throw new Error('Evidence manifest does not match the pinned immutable cohort');

  const report = { contract: 'curated-luxury-card-evidence-load-v1', project_ref: PROJECT_REF,
    run_id: RUN_ID, mode, model_rows_submitted: 0, price_rows_submitted: 0,
    fx_rows_submitted: 0, poster: null, reconciliation: null,
    raw_source_mutated: false, frozen_cohort_mutated: false, production_selector_changed: false };
  if (mode === 'dry-run') {
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return;
  }
  const files = type => fs.readdirSync(path.join(root, type)).filter(name => name.endsWith('.json.gz')).sort();
  const allModelFiles = files('model-evidence');
  const allPriceFiles = files('price-evidence');
  if (allModelFiles.length !== 256 || allPriceFiles.length !== 256) throw new Error('Expected 256 model and 256 price evidence shards');
  const limit = mode === 'canary' ? Math.max(1, Number(process.env.CARD_EVIDENCE_CANARY_PARTITIONS || 1)) : 256;
  const selectedModelFiles = allModelFiles.slice(0, limit);
  const selectedPriceFiles = allPriceFiles.slice(0, limit);

  const baseUrl = required('SUPABASE_URL').replace(/\/$/, '');
  const key = required('SUPABASE_SERVICE_ROLE_KEY');
  if (!baseUrl.includes(PROJECT_REF)) throw new Error('SUPABASE_URL is not canonical QNSA');
  const fxByKey = new Map();
  for (const row of readJson(required('CARD_EVIDENCE_FX_FILE'))) {
    const value = { provider: row.provider, source_currency: row.source_currency,
      effective_date: row.effective_date, rate_direction: row.rate_direction,
      usd_per_source_unit: row.usd_per_source_unit, source_url: row.source_url,
      source_response_sha256: row.source_response_sha256 };
    fxByKey.set(`${value.provider}|${value.source_currency}|${value.effective_date}`, value);
  }
  const fxRows = [...fxByKey.values()];
  report.fx_rows_submitted = await insertRows(baseUrl, key,
    'curated_luxury_historical_fx_rates_shadow', 'provider,source_currency,effective_date', fxRows);
  for (const name of selectedModelFiles) {
    report.model_rows_submitted += await insertRows(baseUrl, key,
      'curated_luxury_card_model_evidence_shadow',
      'run_id,current_listing_key,latest_raw_occurrence_key,evidence_version',
      readJson(path.join(root, 'model-evidence', name)));
  }
  for (const name of selectedPriceFiles) {
    report.price_rows_submitted += await insertRows(baseUrl, key,
      'curated_luxury_card_price_evidence_shadow',
      'run_id,current_listing_key,latest_raw_occurrence_key,evidence_version',
      readJson(path.join(root, 'price-evidence', name)));
  }
  if (mode === 'full') {
    report.poster = await rpc(baseUrl, key, 'curated_luxury_materialize_card_poster_evidence_v1', {
      p_run_id: RUN_ID, p_evidence_version: POSTER_EVIDENCE_VERSION,
      p_confirmation: 'MATERIALIZE_QNSA_CARD_POSTER_EVIDENCE_V1',
    });
    report.reconciliation = await rpc(baseUrl, key, 'curated_luxury_card_evidence_reconciliation_v1', { p_run_id: RUN_ID });
    const brands = report.reconciliation?.brands || {};
    const rolex = brands.Rolex || {};
    const patek = brands['Patek Philippe'] || {};
    if (Number(rolex.total) !== 1535763 || Number(rolex.wts) !== 1386508 || Number(rolex.wtb) !== 149255
      || Number(patek.total) !== 937001 || Number(patek.wts) !== 884326 || Number(patek.wtb) !== 52675
      || Number(report.reconciliation?.duplicate_current_listing_keys) !== 0
      || Number(report.reconciliation?.duplicate_offer_family_keys) !== 0
      || Number(report.reconciliation?.duplicate_offer_state_keys) !== 0
      || Number(report.reconciliation?.duplicate_unique_observation_keys) !== 0
      || Number(report.reconciliation?.invalid_availability) !== 0
      || Number(rolex.missing_lineage) !== 0 || Number(patek.missing_lineage) !== 0) {
      throw new Error(`Full evidence reconciliation failed: ${JSON.stringify(report.reconciliation)}`);
    }
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = { PROJECT_REF, RUN_ID, chunks, insertRows, readJson };

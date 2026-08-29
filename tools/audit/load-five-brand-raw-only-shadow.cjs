'use strict';

// Prepared operator tool. It never changes raw/source rows or customer selectors.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { applicableDate, validFx } = require('./raw-only-price-evidence-lib.cjs');

const PROJECT_REF = 'qnsafosakvonzgfcsphh';
const CONTRACT = 'curated-luxury-five-brand-raw-only-batch-v1';
const BRANDS = ['IWC', 'Hublot', 'Seiko', 'Bell & Ross', 'Tissot'];

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readJson(file) {
  const bytes = fs.readFileSync(file);
  return JSON.parse((file.endsWith('.gz') ? zlib.gunzipSync(bytes) : bytes).toString('utf8'));
}

function sha256(value) {
  return require('node:crypto').createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function chunks(rows, size = 500) {
  const output = [];
  for (let index = 0; index < rows.length; index += size) output.push(rows.slice(index, index + size));
  return output;
}

function normalizedUsd(row) {
  const amount = Number(row.normalized_usd_amount);
  const classification = String(row.price_evidence_classification || '').toUpperCase();
  if (!(amount > 0) || !['SOURCE_EXPLICIT_USD_MATCH', 'SOURCE_EXPLICIT_USD_USDT', 'DATED_VERIFIED_FX']
    .includes(classification)) {
    return { normalized_usd_amount: null, normalized_usd_evidence: null };
  }
  return { normalized_usd_amount: amount, normalized_usd_evidence:
    classification === 'DATED_VERIFIED_FX' ? 'DATED_VERIFIED_FX'
      : classification === 'SOURCE_EXPLICIT_USD_USDT' ? 'SOURCE_EXPLICIT_USDT' : 'SOURCE_EXPLICIT_USD' };
}

function databaseRow(row, runId) {
  const usd = normalizedUsd(row);
  return {
    run_id: runId, current_listing_key: row.current_listing_key,
    offer_family_key: row.offer_family_key, offer_state_key: row.offer_state_key,
    parent_raw_message_id: row.parent_raw_message_id, raw_version_id: row.raw_version_id,
    source_record_id: row.source_record_id, raw_occurrence_key: row.raw_occurrence_key,
    exact_child_text_sha256: row.exact_child_text_sha256, brand: row.brand,
    model_as_posted: row.model_as_posted, observed_reference: row.reference,
    observed_reference_key: row.reference_key, intent: row.intent,
    current_status: row.current_status, cohort_status: row.cohort_status,
    source_timestamp: row.timestamp, source_price_amount: row.source_price_amount,
    source_currency: row.source_currency, price_evidence_status: row.price_status,
    ...usd, country_code: row.country_code, country_name: row.country_name,
    dealer_id: row.dealer_id, source_poster_evidence_present: Boolean(row.source_poster_name),
    raw_message_sha256: row.raw_message_sha256,
  };
}

function priceEvidenceRow(row, runId) {
  const usd = normalizedUsd(row);
  if (!usd.normalized_usd_amount) return null;
  const classification = String(row.price_evidence_classification || '').toUpperCase();
  const base = { run_id: runId, current_listing_key: row.current_listing_key, evidence_version: 1,
    source_price_amount: row.source_price_amount, source_currency: row.source_currency,
    normalized_usd_amount: usd.normalized_usd_amount, price_evidence_classification: classification };
  if (classification !== 'DATED_VERIFIED_FX') return { ...base, fx_provider: null,
    fx_applicable_date: null, fx_effective_date: null, fx_lookback_days: null,
    fx_usd_per_source_unit: null, fx_source_url: null,
    evidence_checksum: sha256(JSON.stringify({ ...base, direct: true })) };
  const fx = row.price_fx;
  const date = applicableDate(row.timestamp);
  if (!validFx(fx, String(row.source_currency || '').toUpperCase(), date)) {
    throw new Error(`Invalid dated FX evidence for ${row.current_listing_key}`);
  }
  return { ...base, fx_provider: fx.provider, fx_applicable_date: fx.applicable_date,
    fx_effective_date: fx.effective_date, fx_lookback_days: fx.lookback_days,
    fx_usd_per_source_unit: fx.usd_per_source_unit, fx_source_url: fx.source_url,
    evidence_checksum: sha256(JSON.stringify({ ...base, fx })) };
}

async function request(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(120000) });
  if (response.ok) return response;
  throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 1000)}`);
}

function headers(key, prefer = 'return=minimal') {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: prefer };
}

async function insertRows(url, key, table, conflictColumns, rows) {
  for (const group of chunks(rows)) {
    await request(`${url}/rest/v1/${table}?on_conflict=${encodeURIComponent(conflictColumns)}`, {
      method: 'POST', headers: headers(key, 'resolution=ignore-duplicates,return=minimal'), body: JSON.stringify(group),
    });
  }
  return rows.length;
}

function loadArtifact(root) {
  const summary = readJson(path.join(root, 'summary.json'));
  if (summary.contract !== CONTRACT || summary.read_only !== true
    || summary.production_writes !== 0 || summary.raw_mutations !== 0 || summary.endpoint_switches !== 0
    || summary.rolex_patek_changes !== 0) throw new Error('Raw-only source manifest does not meet the immutable contract');
  const observations = BRANDS.flatMap(brand => readJson(path.join(root, 'observations',
    `${brand.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json.gz`)));
  if (observations.some(row => !BRANDS.includes(row.brand) || !row.parent_raw_message_id || !row.raw_version_id
    || !row.raw_occurrence_key || !row.exact_child_text_sha256)) {
    throw new Error('Observation artifact has incomplete immutable lineage');
  }
  return { summary, observations };
}

async function main() {
  const mode = String(process.env.FIVE_BRAND_RAW_ONLY_LOAD_MODE || 'dry-run');
  if (!['dry-run', 'load'].includes(mode)) throw new Error('FIVE_BRAND_RAW_ONLY_LOAD_MODE must be dry-run or load');
  const root = path.resolve(required('FIVE_BRAND_RAW_ONLY_OUTPUT'));
  const { summary, observations } = loadArtifact(root);
  const report = { contract: 'curated-luxury-five-brand-raw-only-loader-v1', mode,
    brands: BRANDS, observations: observations.length, raw_mutations: 0,
    production_selector_changed: false, customer_endpoint_changed: false };
  if (mode === 'dry-run') return report;

  const runId = required('FIVE_BRAND_RAW_ONLY_RUN_ID');
  if (required('FIVE_BRAND_RAW_ONLY_CONFIRMATION') !== 'LOAD_FIVE_BRAND_RAW_ONLY_SHADOW_V1') {
    throw new Error('Exact load confirmation is required');
  }
  const baseUrl = required('SUPABASE_URL').replace(/\/$/, '');
  const key = required('SUPABASE_SERVICE_ROLE_KEY');
  if (!baseUrl.includes(PROJECT_REF)) throw new Error('Canonical QNSA URL is required');
  const sourceManifestSha = sha256(JSON.stringify(summary));
  await insertRows(baseUrl, key, 'curated_luxury_raw_only_shadow_runs', 'run_id', [{
    run_id: runId, contract: CONTRACT, source_manifest_sha256: sourceManifestSha, status: 'LOADED',
  }]);
  report.rows_submitted = await insertRows(baseUrl, key, 'curated_luxury_raw_only_current_listings_shadow',
    'run_id,current_listing_key', observations.map(row => databaseRow(row, runId)));
  const priceEvidence = observations.map(row => priceEvidenceRow(row, runId)).filter(Boolean);
  report.price_evidence_rows_submitted = await insertRows(baseUrl, key,
    'curated_luxury_raw_only_price_evidence_shadow', 'run_id,current_listing_key,evidence_version', priceEvidence);
  return report;
}

if (require.main === module) main().then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
  .catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });

module.exports = { BRANDS, CONTRACT, databaseRow, loadArtifact, normalizedUsd, priceEvidenceRow };

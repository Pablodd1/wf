'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const readline = require('node:readline');
const { normalizeSourceRecord, loadFxSnapshot } = require('./normalize-local.cjs');
const { buildPublicationReview, normalizedPrice } = require('./publication-review.cjs');

const TARGET_BRANDS = new Set(['Rolex', 'Patek Philippe']);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function correctionRecord(source, proposal) {
  const review = buildPublicationReview(source, proposal);
  if (review.bundle_status !== 'SINGLE_CANDIDATE' || review.category !== 'WATCH') return null;
  const candidate = review.candidate;
  const price = normalizedPrice(candidate);
  if (!candidate || !TARGET_BRANDS.has(candidate.brand) || !candidate.reference) return null;
  if (!price?.amount_original || !price?.amount_usd || !price?.currency_original) return null;
  if (!price.conversion_rate || !price.conversion_source) return null;
  if (!['USD', 'USDT'].includes(price.currency_original) && !price.conversion_timestamp) return null;
  return {
    source_record_id: review.source_record_id,
    source_hash: review.source_hash,
    candidate: {
      brand: candidate.brand,
      reference: candidate.reference,
      price,
    },
  };
}

async function collectCorrectionRecords({ rawInput, fxSnapshot, limit = 100 }) {
  const records = [];
  const input = fs.createReadStream(rawInput, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const source = JSON.parse(line);
    const proposal = normalizeSourceRecord(source, { fxSnapshot });
    const record = correctionRecord(source, proposal);
    if (record) records.push(record);
    if (records.length >= limit) break;
  }
  return records;
}

async function applyCorrection({ url, serviceKey, runKey, records, fetchImpl = fetch }) {
  const stable = JSON.stringify(records.map(record => [record.source_record_id, record.source_hash]));
  const batchToken = sha256(`${runKey}:${stable}`);
  const response = await fetchImpl(`${url}/rest/v1/rpc/apply_mariadb_two_brand_price_policy_batch`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_run_key: runKey, p_batch_token: batchToken, p_records: records }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`price correction RPC failed: ${response.status} ${body.slice(0, 500)}`);
  return { batchToken, result: JSON.parse(body) };
}

async function main() {
  const rawInput = process.env.MARIADB_CORRECTION_RAW_INPUT;
  const fxPath = process.env.MARIADB_CORRECTION_FX_SNAPSHOT;
  const runKey = process.env.MARIADB_CORRECTION_RUN_KEY;
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const limit = Math.min(100, Math.max(1, Number(process.env.MARIADB_CORRECTION_LIMIT || 100)));
  if (!rawInput || !fxPath || !runKey || !url || !serviceKey) throw new Error('correction environment is incomplete');
  const fxSnapshot = loadFxSnapshot(fxPath);
  const records = await collectCorrectionRecords({ rawInput, fxSnapshot, limit });
  if (records.length !== limit) throw new Error(`only ${records.length}/${limit} correction records were found`);
  const applied = await applyCorrection({ url, serviceKey, runKey, records });
  process.stdout.write(`${JSON.stringify({ event: 'two_brand_price_correction', input_rows: records.length, ...applied })}\n`);
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'two_brand_price_correction_error', error: error.message })}\n`);
  process.exitCode = 1;
});

module.exports = { applyCorrection, collectCorrectionRecords, correctionRecord, sha256 };

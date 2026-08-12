'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sha256, stableJson } = require('./lib.cjs');
const { normalizeSourceRecord, loadFxSnapshot } = require('./normalize-local.cjs');
const { normalizedPrice } = require('./publication-review.cjs');
const { extractPriceObservations } = require('../../api/_lib/normalization-v4.cjs');
const { applyCurrencyPolicy } = require('../shadow-reprocess/shadow-reprocess.cjs');

const ALLOWED_BRANDS = new Set(['Rolex', 'Patek Philippe']);

function exactIdentity(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function recoveredLineagedPrice(source, fxSnapshot) {
  const observations = extractPriceObservations(source?.raw_message || '', {});
  if (!observations.length) return null;
  const converted = observations
    .map(observation => applyCurrencyPolicy(observation, fxSnapshot))
    .filter(price => price?.amount_original > 0 && price?.amount_usd > 0
      && price?.currency_original && price?.conversion_rate > 0 && price?.conversion_source);
  if (!converted.length) return null;

  // If the seller supplied USD/USDT alongside an Asian-currency amount, the
  // supplied dollar amount is the authoritative display value. Otherwise a
  // single explicit asking-price observation can be converted safely. Multiple
  // materially different non-USD observations remain unresolved rather than
  // assigning one watch another item's price.
  const suppliedUsd = converted.find(price => ['USD', 'USDT'].includes(price.currency_original));
  if (suppliedUsd) return normalizedPrice({ prices: [suppliedUsd] });
  if (converted.length === 1) return normalizedPrice({ prices: converted });

  const usdValues = converted.map(price => Number(price.amount_usd)).filter(Number.isFinite);
  const low = Math.min(...usdValues);
  const high = Math.max(...usdValues);
  if (low > 0 && high / low <= 1.05) return normalizedPrice({ prices: [converted[0]] });
  return null;
}

function hasConflictingTargetBrand(rawMessage, canonicalBrand) {
  const raw = String(rawMessage || '');
  const mentionsRolex = /\brolex\b/i.test(raw);
  const mentionsPatek = /\b(?:patek(?:\s+philippe)?|pp)\b/i.test(raw);
  return canonicalBrand === 'Rolex' ? mentionsPatek : mentionsRolex;
}

function correctionRecord(row, fxSnapshot) {
  const source = row?.raw_payload;
  if (!source || typeof source !== 'object') return null;
  if (source.source_record_id !== row.source_record_id || source.raw_sha256 !== row.source_hash) return null;
  if (!ALLOWED_BRANDS.has(row.canonical_brand)) return null;
  if (hasConflictingTargetBrand(source.raw_message, row.canonical_brand)) return null;
  const proposal = normalizeSourceRecord(source, { fxSnapshot });
  const candidates = proposal.normalization?.proposed_candidates || [];
  const candidate = proposal.bundle_status === 'SINGLE_CANDIDATE' && candidates.length === 1
    && candidates[0].brand === row.canonical_brand
    && exactIdentity(candidates[0].reference) === exactIdentity(row.normalized_reference)
    ? candidates[0]
    : null;
  const price = normalizedPrice(candidate) || (proposal.bundle_status !== 'BUNDLE_SPLIT_REQUIRED'
    ? recoveredLineagedPrice(source, fxSnapshot)
    : null);
  if (!price?.amount_original || !price?.amount_usd || !price?.currency_original
    || !price?.conversion_rate || !price?.conversion_source) return null;
  if (!['USD', 'USDT'].includes(price.currency_original)
    && !price.conversion_timestamp) return null;
  return {
    materialization: 'SINGLE',
    source_record_id: row.source_record_id,
    source_hash: row.source_hash,
    candidate: {
      brand: row.canonical_brand,
      reference: row.normalized_reference,
      price,
    },
  };
}

function buildCanary(rows, fxSnapshot, options = {}) {
  const targetRows = Number(options.targetRows || 100);
  if (!Number.isSafeInteger(targetRows) || targetRows < 1 || targetRows > 100) {
    throw new Error('targetRows must be an integer between 1 and 100');
  }
  const records = [];
  const seen = new Set();
  for (const row of rows || []) {
    const record = correctionRecord(row, fxSnapshot);
    if (!record || seen.has(record.source_record_id)) continue;
    seen.add(record.source_record_id);
    records.push(record);
    if (records.length === targetRows) break;
  }
  if (records.length !== targetRows) {
    throw new Error(`Canary selection produced ${records.length}/${targetRows} exact eligible rows`);
  }
  const runKey = String(options.runKey || '');
  if (!/^[A-Za-z0-9._:-]{1,100}$/.test(runKey)) throw new Error('runKey is invalid');
  const batchToken = sha256(stableJson({
    contract: 'wf-two-brand-price-policy-canary-v1',
    run_key: runKey,
    records,
  }));
  return {
    contract: 'wf-two-brand-price-policy-canary-v1',
    run_key: runKey,
    batch_token: batchToken,
    input_rows: records.length,
    records,
  };
}

function buildCorrectionPage(rows, fxSnapshot, options = {}) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 500) {
    throw new Error('Correction page must contain between 1 and 500 scanned rows');
  }
  const runKey = String(options.runKey || '');
  const correctionRunKey = String(options.correctionRunKey || '');
  if (!/^[A-Za-z0-9._:-]{1,100}$/.test(runKey)
    || !/^[A-Za-z0-9._:-]{1,100}$/.test(correctionRunKey)) throw new Error('run keys are invalid');
  const seen = new Set();
  const records = [];
  const skipped = {};
  for (const row of rows) {
    const listingId = String(row?.listing_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(listingId) || seen.has(listingId)) {
      throw new Error('Correction page contains an invalid or duplicate listing cursor');
    }
    seen.add(listingId);
    const record = correctionRecord(row, fxSnapshot);
    if (record) records.push(record);
    else skipped.NOT_EXACTLY_REPARSABLE = (skipped.NOT_EXACTLY_REPARSABLE || 0) + 1;
  }
  const previousCursor = options.previousCursor || null;
  const nextCursor = rows.at(-1).listing_id;
  const batchToken = records.length ? sha256(stableJson({
    contract: 'wf-two-brand-price-policy-full-v1',
    correction_run_key: correctionRunKey,
    normalization_run_key: runKey,
    previous_cursor: previousCursor,
    next_cursor: nextCursor,
    records,
  })) : null;
  return {
    contract: 'wf-two-brand-price-policy-full-v1',
    correction_run_key: correctionRunKey,
    run_key: runKey,
    previous_cursor: previousCursor,
    next_cursor: nextCursor,
    scanned_rows: rows.length,
    corrected_rows: records.length,
    skipped_rows: rows.length - records.length,
    skipped_by_reason: skipped,
    batch_token: batchToken,
    records,
  };
}

function main() {
  const inputPath = path.resolve(process.env.QNSA_CANARY_INPUT || 'qnsa-canary-input.json');
  const fxPath = path.resolve(process.env.MARIADB_NORMALIZE_FX_SNAPSHOT || 'fx-snapshot.json');
  const outputPath = path.resolve(process.env.QNSA_CANARY_OUTPUT || 'qnsa-canary-records.json');
  const rows = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const fxSnapshot = loadFxSnapshot(fxPath);
  const canary = buildCanary(rows, fxSnapshot, {
    runKey: process.env.NORMALIZED_RUN_KEY,
    targetRows: process.env.QNSA_CANARY_ROWS || 100,
  });
  fs.writeFileSync(outputPath, JSON.stringify(canary));
  // Do not print record IDs, raw text, private contact fields, or price values.
  process.stdout.write(`${JSON.stringify({
    event: 'two_brand_price_canary_built',
    contract: canary.contract,
    input_rows: canary.input_rows,
    batch_token: canary.batch_token,
    raw_text_logged: false,
    pii_logged: false,
  })}\n`);
}

if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`${JSON.stringify({
      event: 'two_brand_price_canary_error',
      error_name: error.name || 'Error',
      error_message: error.message || String(error),
      raw_text_logged: false,
      pii_logged: false,
    })}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildCanary, buildCorrectionPage, correctionRecord, exactIdentity,
  recoveredLineagedPrice, hasConflictingTargetBrand,
};

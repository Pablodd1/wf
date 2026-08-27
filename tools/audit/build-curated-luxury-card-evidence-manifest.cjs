'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const {
  buildModelEvidence, buildPriceEvidence, ECB_CURRENCIES, sha256,
} = require('./curated-luxury-card-evidence-lib.cjs');

const RUN_ID = '17d6d831-86cd-5e67-9830-c881bcf16e0d';
const FREEZE_RUN_ID = '32953447624';
const FREEZE_MANIFEST_SHA256 = '17d6d83186cd8e675830c881bcf16e0d3c011ba1835eecf90710a4c665e4472a';

function requiredDirectory(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return path.resolve(value);
}

function readJson(file) {
  const buffer = fs.readFileSync(file);
  const payload = file.endsWith('.gz') ? zlib.gunzipSync(buffer) : buffer;
  return JSON.parse(payload.toString('utf8'));
}

function verifyFreezeFiles(root) {
  const manifestFile = path.join(root, 'manifest-sha256.json');
  const manifest = readJson(manifestFile);
  if (manifest.contract !== 'curated-luxury-rolex-patek-final-freeze-v1') {
    throw new Error('Unexpected final freeze contract');
  }
  const entries = new Map(manifest.files.map(item => [item.relative, item]));
  const partitions = [...entries.keys()].filter(relative => /^cohort-pages\/partition-\d{3}\.json\.gz$/.test(relative)).sort();
  if (partitions.length !== 256) throw new Error(`Expected 256 frozen partitions; found ${partitions.length}`);
  for (const relative of partitions) {
    const file = path.join(root, ...relative.split('/'));
    const payload = fs.readFileSync(file);
    const expected = entries.get(relative);
    if (payload.length !== Number(expected.bytes) || sha256(payload) !== expected.sha256) {
      throw new Error(`Frozen partition checksum mismatch: ${relative}`);
    }
  }
  return partitions;
}

function fxKey(date, currency) {
  return `${date}|${currency}`;
}

function loadFxMap(file) {
  if (!file) return new Map();
  const rows = readJson(path.resolve(file));
  const map = new Map();
  for (const row of rows) {
    if (row.provider !== 'ECB' || row.rate_direction !== 'USD_PER_SOURCE_UNIT') continue;
    map.set(fxKey(row.applicable_date, row.source_currency), row);
  }
  return map;
}

function blankBrand() {
  return { total: 0, models_verified: 0, models_unresolved: 0, prices_verified: 0,
    prices_unresolved: 0, direct_usd_usdt: 0, dated_fx: 0, unsupported_fx_currency: 0 };
}

function writeGzipJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, zlib.gzipSync(Buffer.from(`${JSON.stringify(value)}\n`), { level: 9 }));
}

function main() {
  const input = requiredDirectory('FINAL_FREEZE_ARTIFACT');
  const output = requiredDirectory('CARD_EVIDENCE_OUTPUT');
  const mode = String(process.env.CARD_EVIDENCE_MODE || 'dry-run');
  if (!['dry-run', 'materialize'].includes(mode)) throw new Error('CARD_EVIDENCE_MODE must be dry-run or materialize');
  const partitions = verifyFreezeFiles(input);
  const fx = loadFxMap(process.env.CARD_EVIDENCE_FX_FILE);
  const stats = { Rolex: blankBrand(), 'Patek Philippe': blankBrand() };

  for (const relative of partitions) {
    const rows = readJson(path.join(input, ...relative.split('/')));
    const modelRows = [];
    const priceRows = [];
    for (const sourceRow of rows) {
      const row = { ...sourceRow, run_id: RUN_ID, source_artifact_id: FREEZE_RUN_ID,
        source_artifact_sha256: FREEZE_MANIFEST_SHA256 };
      const brand = stats[row.brand];
      if (!brand) throw new Error(`Unexpected brand: ${row.brand}`);
      brand.total += 1;
      const model = buildModelEvidence(row);
      if (model) { brand.models_verified += 1; if (mode === 'materialize') modelRows.push(model); }
      else brand.models_unresolved += 1;

      const currency = String(row.source_currency || '').toUpperCase();
      const applicableDate = String(row.source_timestamp || '').slice(0, 10);
      const rate = fx.get(fxKey(applicableDate, currency)) || null;
      const price = buildPriceEvidence(row, rate);
      if (price) {
        brand.prices_verified += 1;
        if (price.price_evidence_classification === 'DATED_VERIFIED_FX') brand.dated_fx += 1;
        else brand.direct_usd_usdt += 1;
        if (mode === 'materialize') priceRows.push(price);
      } else if (Number(row.source_price_amount) > 0 && currency) {
        brand.prices_unresolved += 1;
        if (!['USD', 'USDT'].includes(currency) && !ECB_CURRENCIES.has(currency)) brand.unsupported_fx_currency += 1;
      }
    }
    if (mode === 'materialize') {
      const stem = path.basename(relative, '.json.gz');
      writeGzipJson(path.join(output, 'model-evidence', `${stem}.json.gz`), modelRows);
      writeGzipJson(path.join(output, 'price-evidence', `${stem}.json.gz`), priceRows);
    }
  }

  const manifest = {
    contract: 'curated-luxury-rolex-patek-card-evidence-manifest-v1', mode,
    source_freeze_run_id: FREEZE_RUN_ID, source_freeze_manifest_sha256: FREEZE_MANIFEST_SHA256,
    shadow_run_id: RUN_ID, raw_source_mutated: false, frozen_cohort_mutated: false,
    production_selector_changed: false, counts: stats, generated_at: new Date().toISOString(),
  };
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'card-evidence-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest)}\n`);
}

if (require.main === module) main();

module.exports = { FREEZE_MANIFEST_SHA256, FREEZE_RUN_ID, RUN_ID, fxKey, loadFxMap, verifyFreezeFiles };

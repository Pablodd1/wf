#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { listCanonicalCatalogReferences } = require('../../api/_lib/catalog.js');
const { isQualifiedComparable } = require('./current-inventory-shadow-lib.cjs');

const CONTRACT = 'curated-luxury-rolex-patek-shadow-load-v1';
const PROJECT_REF = 'qnsafosakvonzgfcsphh';
const EXPECTED = Object.freeze({
  finalRun: '32953447624',
  sourceRun: '32934432129',
  manifestSha256: '17d6d83186cd8e675830c881bcf16e0d3c011ba1835eecf90710a4c665e4472a',
  brands: {
    Rolex: { final: 1535763, wts: 1386508, wtb: 149255, priceResearch: 38521 },
    'Patek Philippe': { final: 937001, wts: 884326, wtb: 52675, priceResearch: 45638 },
  },
  canaryPassed: 20,
  partitionCount: 256,
});

const CURRENT_COLUMNS = [
  'run_id', 'current_listing_key', 'offer_family_key', 'offer_state_key', 'latest_raw_occurrence_key',
  'current_status', 'cohort_status', 'brand', 'observed_reference', 'observed_reference_key', 'intent',
  'condition_as_observed', 'dial_or_color_as_observed', 'source_timestamp', 'source_price_amount',
  'source_currency', 'normalized_usd_amount', 'price_verified', 'image_linked', 'source_image_key',
  'dealer_key', 'dealer_rating_qualified', 'country_code', 'search_text',
];
const PRICE_COLUMNS = [
  'run_id', 'offer_state_key', 'offer_family_key', 'brand', 'observed_reference_key',
  'source_price_amount', 'source_currency', 'normalized_usd_amount', 'first_seen', 'last_seen',
  'occurrence_count', 'repost_same_offer_count', 'qualified_price_research', 'latest_raw_occurrence_key',
];
const REFERENCE_COLUMNS = [
  'run_id', 'brand', 'observed_reference', 'observed_reference_key', 'catalog_status',
  'source_occurrence_count', 'unique_market_observation_count', 'current_listing_count',
  'qualified_comparable_states', 'first_seen', 'last_seen',
];

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function artifactChecksum(file) {
  return sha256(fs.readFileSync(file).toString('base64'));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readGzipJson(file) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
}

function readGzipJsonl(file) {
  return zlib.gunzipSync(fs.readFileSync(file)).toString('utf8').trim()
    .split('\n').filter(Boolean).map(line => JSON.parse(line));
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value);
  return `"${text.replaceAll('"', '""').replace(/[\r\n\0]+/g, ' ')}"`;
}

function csv(columns, rows) {
  return `${columns.join(',')}\n${rows.map(row => columns.map(column => csvCell(row[column])).join(',')).join('\n')}\n`;
}

function writeGzipCsv(file, columns, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, zlib.gzipSync(csv(columns, rows), { level: 9 }));
}

function deterministicRunId(manifestSha) {
  const value = manifestSha.slice(0, 32).split('');
  value[12] = '5';
  value[16] = ['8', '9', 'a', 'b'][Number.parseInt(value[16], 16) % 4];
  const hex = value.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function manifestMap(root, manifestFile) {
  const manifest = readJson(manifestFile);
  const map = new Map();
  for (const row of manifest.files || []) {
    const relative = row.relative || row.path;
    if (!relative || map.has(relative)) throw new Error(`Invalid or duplicate manifest path: ${relative}`);
    map.set(relative, row);
  }
  return map;
}

function verifiedFile(root, map, relative) {
  const metadata = map.get(relative);
  if (!metadata) throw new Error(`Manifest missing ${relative}`);
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) throw new Error(`Artifact missing ${relative}`);
  if (fs.statSync(file).size !== Number(metadata.bytes) || artifactChecksum(file) !== metadata.sha256) {
    throw new Error(`Artifact checksum mismatch: ${relative}`);
  }
  return file;
}

function normalizedReference(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function localCatalogs() {
  return new Map(['Rolex', 'Patek Philippe'].map(brand => [brand,
    new Set(listCanonicalCatalogReferences(brand).map(row => normalizedReference(row.reference)))]));
}

function referenceState(states, row) {
  const key = `${row.brand}|${row.observed_reference_key}`;
  let state = states.get(key);
  if (!state) {
    state = {
      brand: row.brand,
      observed_reference: row.observed_reference || row.observed_reference_key,
      observed_reference_key: row.observed_reference_key,
      source_occurrence_count: 0,
      unique_market_observation_count: 0,
      current_listing_count: 0,
      qualified_comparable_states: 0,
      first_seen: null,
      last_seen: null,
    };
    states.set(key, state);
  }
  return state;
}

function updateRange(state, timestamp) {
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return;
  if (!state.first_seen || timestamp < state.first_seen) state.first_seen = timestamp;
  if (!state.last_seen || timestamp > state.last_seen) state.last_seen = timestamp;
}

function latest(rows) {
  return [...rows].sort((a, b) => (Date.parse(a.source_timestamp || '') || 0)
    - (Date.parse(b.source_timestamp || '') || 0)
    || String(a.raw_occurrence_key).localeCompare(String(b.raw_occurrence_key))).at(-1);
}

function requireFrozenContract(freeze, priceSummary, expected) {
  if (freeze.decision !== 'CURATED_LUXURY_ROLEX_PATEK_FINAL_READY') throw new Error('Final cohort is not ready');
  if (String(freeze.source_artifact_run_id) !== expected.sourceRun) throw new Error('Source run mismatch');
  if (freeze.manifest_sha256 !== expected.manifestSha256) throw new Error('Frozen manifest mismatch');
  if (freeze.canary?.passed !== expected.canaryPassed || freeze.canary?.failed !== 0) throw new Error('Canary mismatch');
  for (const [brand, counts] of Object.entries(expected.brands)) {
    const actual = freeze.brands?.[brand] || {};
    if (actual.final_publishable !== counts.final || actual.wts !== counts.wts || actual.wtb !== counts.wtb
      || actual.qualified_price_research_observations !== counts.priceResearch) {
      throw new Error(`${brand} frozen count mismatch`);
    }
    if (priceSummary.brands?.[brand]?.qualified_unique_wts_states !== counts.priceResearch
      || priceSummary.brands?.[brand]?.reposts_inflate_comparables !== false
      || priceSummary.brands?.[brand]?.catalog_match_required !== false) {
      throw new Error(`${brand} Price Research contract mismatch`);
    }
  }
}

function materialize(options = {}) {
  const expected = options.expected || EXPECTED;
  const finalRoot = path.resolve(options.finalRoot || process.env.FINAL_FREEZE_ARTIFACT || '');
  const sourceRoot = path.resolve(options.sourceRoot || process.env.CURRENT_INVENTORY_SOURCE_ARTIFACT || '');
  const outputRoot = path.resolve(options.outputRoot || process.env.SHADOW_LOAD_OUTPUT || 'audit-output/final-shadow-load');
  const freezeFile = path.join(finalRoot, 'freeze.json');
  const finalManifestFile = path.join(finalRoot, 'manifest-sha256.json');
  const sourceManifestFile = path.join(sourceRoot, 'manifest-sha256.json');
  for (const file of [freezeFile, finalManifestFile, sourceManifestFile]) {
    if (!fs.existsSync(file)) throw new Error(`Missing required artifact file: ${file}`);
  }
  const freeze = readJson(freezeFile);
  if (String(freeze.version || '').split('-').at(-1) !== expected.finalRun) throw new Error('Final run mismatch');
  if (artifactChecksum(finalManifestFile) !== expected.manifestSha256) throw new Error('Final manifest checksum mismatch');
  if (artifactChecksum(sourceManifestFile) !== freeze.source_manifest_sha256) throw new Error('Source manifest checksum mismatch');
  const finalManifest = manifestMap(finalRoot, finalManifestFile);
  const sourceManifest = manifestMap(sourceRoot, sourceManifestFile);
  const priceSummary = readJson(verifiedFile(finalRoot, finalManifest, 'price-research-summary.json'));
  verifiedFile(finalRoot, finalManifest, 'canary-evidence.json');
  requireFrozenContract(freeze, priceSummary, expected);

  fs.mkdirSync(outputRoot, { recursive: true });
  const runId = deterministicRunId(expected.manifestSha256);
  const references = new Map();
  const totals = Object.fromEntries(Object.keys(expected.brands).map(brand => [brand,
    { current: 0, wts: 0, wtb: 0, priceResearch: 0 }]));
  const currentRelatives = [...finalManifest.keys()].filter(relative => /^cohort-pages\/partition-\d{3}\.json\.gz$/.test(relative)).sort();
  const offerRelatives = [...sourceManifest.keys()].filter(relative => /^offer-partitions\/partition-\d{3}\.jsonl\.gz$/.test(relative)).sort();
  if (currentRelatives.length !== expected.partitionCount || offerRelatives.length !== expected.partitionCount) {
    throw new Error(`Expected ${expected.partitionCount} current and offer partitions`);
  }

  for (const relative of currentRelatives) {
    const rows = readGzipJson(verifiedFile(finalRoot, finalManifest, relative));
    const outputRows = rows.map(row => {
      const state = referenceState(references, row);
      state.current_listing_count += 1;
      updateRange(state, row.source_timestamp);
      totals[row.brand].current += 1;
      totals[row.brand][row.intent.toLowerCase()] += 1;
      return {
        run_id: runId,
        current_listing_key: row.current_listing_key,
        offer_family_key: row.offer_family_key,
        offer_state_key: row.offer_state_key,
        latest_raw_occurrence_key: row.raw_occurrence_key,
        current_status: 'CURRENT_ACTIVE',
        cohort_status: row.cohort_status,
        brand: row.brand,
        observed_reference: row.observed_reference,
        observed_reference_key: row.observed_reference_key,
        intent: row.intent,
        condition_as_observed: row.condition_as_observed,
        dial_or_color_as_observed: row.dial_or_color_as_observed,
        source_timestamp: row.source_timestamp,
        source_price_amount: row.source_price_amount,
        source_currency: row.source_currency,
        normalized_usd_amount: row.price_verified ? row.normalized_usd_amount : null,
        price_verified: row.price_verified === true,
        image_linked: row.image_linked === true,
        source_image_key: row.source_image_key,
        dealer_key: row.dealer_key,
        dealer_rating_qualified: row.dealer_rating_qualified === true,
        country_code: row.country_code,
        search_text: [row.brand, row.observed_reference, row.condition_as_observed,
          row.dial_or_color_as_observed].filter(Boolean).join(' '),
      };
    });
    writeGzipCsv(path.join(outputRoot, 'current', path.basename(relative).replace('.json.gz', '.csv.gz')),
      CURRENT_COLUMNS, outputRows);
  }

  for (const relative of offerRelatives) {
    const rows = readGzipJsonl(verifiedFile(sourceRoot, sourceManifest, relative));
    const uniqueInPartition = new Set();
    const states = new Map();
    for (const row of rows) {
      const reference = referenceState(references, row);
      reference.source_occurrence_count += 1;
      updateRange(reference, row.source_timestamp);
      if (!uniqueInPartition.has(row.unique_observation_key)) {
        uniqueInPartition.add(row.unique_observation_key);
        reference.unique_market_observation_count += 1;
      }
      const grouped = states.get(row.offer_state_key) || [];
      grouped.push(row);
      states.set(row.offer_state_key, grouped);
    }
    const outputRows = [];
    for (const grouped of states.values()) {
      const row = latest(grouped);
      if (!isQualifiedComparable(row)) continue;
      const reference = referenceState(references, row);
      reference.qualified_comparable_states += 1;
      totals[row.brand].priceResearch += 1;
      outputRows.push({
        run_id: runId,
        offer_state_key: row.offer_state_key,
        offer_family_key: row.offer_family_key,
        brand: row.brand,
        observed_reference_key: row.observed_reference_key,
        source_price_amount: row.source_price_amount,
        source_currency: row.source_currency,
        normalized_usd_amount: row.source_price_amount,
        first_seen: grouped.reduce((value, item) => !value || item.source_timestamp < value ? item.source_timestamp : value, null),
        last_seen: row.source_timestamp,
        occurrence_count: grouped.length,
        repost_same_offer_count: Math.max(0, grouped.length - 1),
        qualified_price_research: true,
        latest_raw_occurrence_key: row.raw_occurrence_key,
      });
    }
    writeGzipCsv(path.join(outputRoot, 'price-research', path.basename(relative).replace('.jsonl.gz', '.csv.gz')),
      PRICE_COLUMNS, outputRows);
  }

  for (const [brand, counts] of Object.entries(expected.brands)) {
    const actual = totals[brand];
    if (actual.current !== counts.final || actual.wts !== counts.wts || actual.wtb !== counts.wtb
      || actual.priceResearch !== counts.priceResearch) throw new Error(`${brand} materialized count mismatch`);
  }
  const catalogs = localCatalogs();
  const referenceRows = [...references.values()].sort((a, b) => a.brand.localeCompare(b.brand)
    || a.observed_reference_key.localeCompare(b.observed_reference_key)).map(row => ({
    run_id: runId,
    ...row,
    catalog_status: catalogs.get(row.brand).has(row.observed_reference_key) ? 'CATALOG_CONFIRMED' : 'OBSERVED_ONLY',
  }));
  writeGzipCsv(path.join(outputRoot, 'observed-references.csv.gz'), REFERENCE_COLUMNS, referenceRows);
  const loadFiles = fs.readdirSync(path.join(outputRoot, 'current')).map(name => `current/${name}`)
    .concat(fs.readdirSync(path.join(outputRoot, 'price-research')).map(name => `price-research/${name}`))
    .concat('observed-references.csv.gz').sort();
  const summary = {
    contract: CONTRACT,
    canonical_project_ref: PROJECT_REF,
    run_id: runId,
    status: 'READY_TO_LOAD_SHADOW_ONLY',
    final_freeze_run_id: expected.finalRun,
    source_artifact_run_id: expected.sourceRun,
    final_manifest_sha256: expected.manifestSha256,
    freeze_version: freeze.version,
    counts: totals,
    reference_rows: referenceRows.length,
    canary: freeze.canary,
    source_switch: false,
    customer_endpoints_changed: false,
    production_source_tables_mutated: false,
    load_files: loadFiles.map(relative => ({ relative, bytes: fs.statSync(path.join(outputRoot, relative)).size,
      sha256: artifactChecksum(path.join(outputRoot, relative)) })),
  };
  fs.writeFileSync(path.join(outputRoot, 'load-manifest.json'), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(materialize(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ contract: CONTRACT, status: 'NOT_READY_TO_LOAD',
      error: String(error.message || error) })}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  CONTRACT,
  CURRENT_COLUMNS,
  EXPECTED,
  PRICE_COLUMNS,
  PROJECT_REF,
  REFERENCE_COLUMNS,
  artifactChecksum,
  deterministicRunId,
  materialize,
};

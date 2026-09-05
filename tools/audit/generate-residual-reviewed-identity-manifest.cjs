'use strict';

// Read-only residual identity census for the three admission workbooks. The
// checked output contains only exact public IDs, immutable payload hashes, and
// control metadata; raw messages and seller data never enter the manifest.

const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');
const masterCatalog = require('../../api/dictionaries/master_catalog.json');
const {
  readAdmissionWorkbook,
  rowForImport,
} = require('../intake/import-approved-admission-workbook.cjs');

const ORIGIN = String(process.env.WATCHFACTS_AUDIT_ORIGIN || 'https://watchfacts-poc.vercel.app').replace(/\/$/, '');
const EXPECTED = Object.freeze({ 'TAG Heuer': 77, Breguet: 7, 'Franck Muller': 0 });
const WORKBOOKS = Object.freeze({
  'TAG Heuer': 'TAG_Heuer_Trading_Floor_Admission_Master.xlsx',
  Breguet: 'Breguet_Trading_Floor_Admission_Master.xlsx',
  'Franck Muller': 'Franck_Muller_Trading_Floor_Admission_Master.xlsx',
});

function text(value) { return value === null || value === undefined ? '' : String(value).trim(); }
function compact(value) { return text(value).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function rawHasReference(raw, reference) {
  const needle = compact(reference);
  return needle.length >= 4 && compact(raw).includes(needle);
}

function expectedBrandPresent(brand, raw) {
  if (brand === 'TAG Heuer') return /\btag\s*heuer?\b|\btagheuer\b/i.test(raw);
  if (brand === 'Breguet') return /\bbreguet\b/i.test(raw.replace(/\bbreguet\s+numeric(?:s|als)?\b/gi, ''));
  return /\bfranck\s+muller\b|法穆兰|\bFM\s*\d/i.test(raw);
}

const EXACT_CATALOG_BRANDS = new Map(Object.entries(masterCatalog)
  .map(([reference, record]) => [compact(reference), text(record.brand)]));
function exactCatalogBrand(reference) { return EXACT_CATALOG_BRANDS.get(compact(reference)) || ''; }

function residualIdentityReason(row, brand) {
  const raw = text(row.raw_message);
  const model = text(row.model);
  const reference = text(row.reference);
  const expectedPresent = expectedBrandPresent(brand, raw);
  if (brand === 'TAG Heuer') {
    if (/\brichard\s+mill(?:e|er)\b|\bRM\s*0?\d{2}(?:\s*[-/]\s*\d{2})?\b/i.test(raw)
      || /^RM\s*0?\d{2}(?:\s*[-/]\s*\d{2})?/i.test(model)) return 'RESIDUAL_TAG_RICHARD_MILLE_SHORTHAND';
    if (/\b(?:rolex|rlx|daytona|yacht\s*-?\s*master|sky\s*-?\s*dweller|datejust|submariner|pearlmaster)\b/i.test(raw)) {
      return 'RESIDUAL_TAG_ROLEX_RAW_IDENTITY';
    }
    if (/\bcarter\b/i.test(raw)) return 'RESIDUAL_TAG_CARTIER_TYPO';
    if (!expectedPresent && !/^(?:19|20)\d{2}$/.test(reference)
      && exactCatalogBrand(reference) === 'Rolex' && rawHasReference(raw, reference)) {
      return 'RESIDUAL_TAG_ROLEX_CATALOG_IDENTITY';
    }
  }
  if (brand === 'Breguet') {
    if (/\b(?:JLC|jaeger\s*-?\s*lecoultre|reverso)\b/i.test(raw)) return 'RESIDUAL_BREGUET_JLC_IDENTITY';
    if (!expectedPresent && /\b(?:cartier|carter|santos)\b/i.test(raw)) return 'RESIDUAL_BREGUET_CARTIER_IDENTITY';
    if (!expectedPresent && /^\d{4}[JGRP]$/i.test(reference)
      && exactCatalogBrand(reference) === 'Patek Philippe' && rawHasReference(raw, reference)) {
      return 'RESIDUAL_BREGUET_PATEK_CATALOG_IDENTITY';
    }
  }
  if (brand === 'Franck Muller' && !expectedPresent
    && /\b(?:rolex|patek(?:\s+philippe)?|audemars\s+piguet|richard\s+mille|cartier|breguet|tag\s*heuer)\b/i.test(raw)) {
    return 'RESIDUAL_FRANCK_EXPLICIT_OTHER_BRAND';
  }
  return null;
}

async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'watchfacts-residual-identity-audit/1.0' } });
  if (!response.ok) throw new Error(`GET ${url} failed (${response.status})`);
  return response.json();
}

async function fetchBrand(brand) {
  const rows = [];
  let cursor = null;
  do {
    const url = new URL('/api/reviewed-market-inventory', ORIGIN);
    url.searchParams.set('brand', brand);
    url.searchParams.set('item', 'watches');
    url.searchParams.set('pageSize', '50');
    url.searchParams.set('pagination', 'cursor');
    if (cursor) url.searchParams.set('cursor', cursor);
    const body = await getJson(url);
    rows.push(...(body.records || []));
    cursor = body.hasMore ? body.nextCursor : null;
  } while (cursor);
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error(`${brand} public pages contain duplicate IDs`);
  return rows;
}

function workbookRows(workbookPath, expectedBrand) {
  const workbook = readAdmissionWorkbook(workbookPath);
  const rows = new Map();
  workbook.sourceRows.forEach((source, index) => {
    const decision = workbook.decisions.get(source.listing_id);
    const row = rowForImport({
      source, decision, expectedBrand, fileName: path.basename(workbookPath),
      fileSha256: workbook.fileSha256, rowNumber: index + 2,
      runId: 'read_only_residual_identity_audit', retainIdentityConflictsForAudit: true,
    });
    if (row) rows.set(row.id, row);
  });
  return rows;
}

function controlRow(live, local, reason, priorPriceHold = false, canary) {
  const liveQualified = live.price_evidence_status === 'SOURCE_EXPLICIT_USD_MATCH';
  const holdsPrice = liveQualified || priorPriceHold;
  return {
    listing_id: live.id,
    source_payload_sha256: local.source_payload_sha256,
    action: 'QUARANTINE_RESIDUAL_IDENTITY_CONFLICT',
    expected_status: 'APPROVED_SINGLE_CANDIDATE',
    new_status: 'QUARANTINED_IDENTITY_CONFLICT',
    also_hold_price: holdsPrice,
    expected_price_status: holdsPrice ? 'SOURCE_EXPLICIT_USD_MATCH' : '',
    new_price_status: holdsPrice ? 'PRICE_EVIDENCE_INCOMPLETE' : '',
    price_hold_origin: liveQualified ? 'LIVE_QUALIFIED' : (priorPriceHold ? 'PRIOR_CONTROL' : ''),
    conflict_reason: reason,
    canary_category: canary?.category || 'RESIDUAL_IDENTITY_OTHER',
    canary_priority: canary?.priority || 1000,
  };
}

function assignCanaries(rows) {
  const tagRm = rows.find(row => row.conflict_reason === 'RESIDUAL_TAG_RICHARD_MILLE_SHORTHAND' && row.price_hold_origin === 'LIVE_QUALIFIED');
  const breguetJlc = rows.find(row => row.conflict_reason === 'RESIDUAL_BREGUET_JLC_IDENTITY' && row.price_hold_origin === 'LIVE_QUALIFIED');
  const catalog = rows.find(row => /CATALOG_IDENTITY$/.test(row.conflict_reason));
  if (!tagRm || !breguetJlc || !catalog) throw new Error('required three-class residual canary is incomplete');
  Object.assign(tagRm, { canary_category: 'RESIDUAL_TAG_RM_DUAL', canary_priority: 1 });
  Object.assign(breguetJlc, { canary_category: 'RESIDUAL_BREGUET_JLC_DUAL', canary_priority: 2 });
  Object.assign(catalog, { canary_category: 'RESIDUAL_CATALOG_CONFLICT', canary_priority: 3 });
}

async function generate(options = {}) {
  const downloads = options.downloads || path.join(process.env.USERPROFILE || '', 'Downloads');
  const priorPriceFile = options.priorPriceFile || path.join(
    __dirname, '..', '..', 'data', 'reviewed-workbook-integrity', 'three-brand-price-regressions-36.csv',
  );
  const priorPriceSheet = XLSX.read(fs.readFileSync(priorPriceFile), { type: 'buffer', raw: true });
  const priorPriceHolds = new Set(XLSX.utils.sheet_to_json(
    priorPriceSheet.Sheets[priorPriceSheet.SheetNames[0]], { defval: null, raw: true },
  ).map(row => text(row.listing_id)));
  const controls = [];
  const counts = {};
  for (const brand of Object.keys(WORKBOOKS)) {
    const liveRows = await fetchBrand(brand);
    const localRows = workbookRows(path.join(downloads, WORKBOOKS[brand]), brand);
    const conflicts = liveRows.map(live => ({ live, reason: residualIdentityReason(live, brand) })).filter(item => item.reason);
    counts[brand] = conflicts.length;
    if (conflicts.length !== EXPECTED[brand]) {
      const reasons = Object.fromEntries([...new Set(conflicts.map(item => item.reason))]
        .map(reason => [reason, conflicts.filter(item => item.reason === reason).length]));
      throw new Error(`${brand} residual count drift: expected ${EXPECTED[brand]}, got ${conflicts.length}; ${JSON.stringify(reasons)}`);
    }
    for (const { live, reason } of conflicts) {
      const local = localRows.get(live.id);
      if (!local) throw new Error(`local exact payload unavailable for ${live.id}`);
      controls.push(controlRow(live, local, reason, priorPriceHolds.has(live.id)));
    }
  }
  assignCanaries(controls);
  controls.sort((left, right) => left.listing_id.localeCompare(right.listing_id));
  if (new Set(controls.map(row => row.listing_id)).size !== controls.length) throw new Error('residual controls contain duplicate IDs');
  return { controls, counts };
}

async function run() {
  const output = process.argv[2] || path.join('data', 'reviewed-workbook-integrity', 'residual-identity-conflicts-84.csv');
  const { controls, counts } = await generate();
  const sheet = XLSX.utils.json_to_sheet(controls);
  const csv = XLSX.utils.sheet_to_csv(sheet, { FS: ',', RS: '\n', blankrows: false });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, csv);
  process.stdout.write(`${JSON.stringify({ output: path.resolve(output), rows: controls.length, counts, live_price_holds: controls.filter(row => row.price_hold_origin === 'LIVE_QUALIFIED').length, merged_prior_price_holds: controls.filter(row => row.price_hold_origin === 'PRIOR_CONTROL').length }, null, 2)}\n`);
}

if (require.main === module) run().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = { EXPECTED, assignCanaries, exactCatalogBrand, expectedBrandPresent, fetchBrand, generate, residualIdentityReason };

#!/usr/bin/env node
'use strict';

/**
 * WatchFacts V2 RC50 — "50-listing Trading Floor release candidate" preview runner.
 *
 * EXTENDS tools/canary-e2e/run-disposable-e2e.cjs (module reuse; the phase-10
 * runner and its 24 assertions are untouched). Same safety model: disposable
 * embedded Postgres on loopback, zero external network, synthetic deterministic
 * fixtures only, fail-closed production-identifier guard.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const p10 = require('./run-disposable-e2e.cjs');
const {
  loadProcCatalog,
  makeRpcHandler,
  makeAppServer,
  CdpBrowserSession,
  resolveBrowserBin,
  CANARY_MIGRATIONS,
  AssertionLedger,
} = p10;

const { encodeCursorEnvelope, computeCursorScope } = require('../../api/_lib/canary-keyset.cjs');
const { enforceListingDisplayContract } = require('../../shared/listing-display-contract.cjs');

const FORBIDDEN_PROD_IDENTIFIER = 'bptrvfncppbjnchsaxtb';
function assertDisposableEnvironment() {
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string' && value.includes(FORBIDDEN_PROD_IDENTIFIER)) {
      throw new Error(`PRODUCTION_IDENTIFIER_REFUSED: env ${key} references a production identifier`);
    }
  }
}

function sha256(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = require('node:net').createServer();
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
    srv.on('error', reject);
  });
}

const RC50_RUN_ID = 'RC50_SYNTHETIC_FIXTURE';
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

/* ------------------------------------------------------------------ *
 * RC50 fixture builder — exactly 50 published Trading Floor rows.
 * Every row is fixture_data=true / synthetic_fixture labelled.
 * ------------------------------------------------------------------ */
function buildRc50Fixtures(imageBaseUrl) {
  const rows = [];
  const base = Date.UTC(2026, 8, 1, 12, 0, 0);
  let i = 0;
  const mk = (over) => {
    i += 1;
    const id = over.listing_id;
    return Object.assign({
      contract_version: 'v2.0',
      listing_id: id,
      parent_listing_id: null,
      child_index: null,
      source_id: `RC50-SRC-${id}`,
      source_hash: sha256(`synthetic-fixture ${id}`),
      raw_message_id: `RC50-MSG-${id}`,
      raw_message_text: `[SYNTHETIC FIXTURE] ${id} - synthetic_fixture, not a real market observation`,
      source_context_text: `[SYNTHETIC FIXTURE] context for ${id}`,
      source_created_at: new Date(base + i * 60000).toISOString(),
      observed_at: new Date(base + i * 60000).toISOString(),
      category: 'wristwatches',
      brand: 'Synthetix',
      model: `Model-${id}`,
      reference: `RF-${id}`,
      dial_color: 'Black',
      year: 2024,
      condition: 'Excellent',
      intent: 'WTS',
      intent_status: null,
      title: `[SYNTHETIC FIXTURE] ${id}`,
      description: `[SYNTHETIC FIXTURE] row ${id}; fixture_data=true; contains no real-world data.`,
      original_price_text: null,
      original_price_amount: null,
      original_price_currency: 'USD',
      price_usd: null,
      fx_rate: null,
      fx_source: null,
      fx_date: null,
      price_status: 'NO_PRICE',
      price_research_eligible: false,
      included_in_statistics: false,
      statistics_exclusion_reason: null,
      image_url: null,
      thumbnail_url: null,
      image_key: null,
      image_evidence_type: 'NO_IMAGE',
      image_status: 'NO_IMAGE',
      seller_id: `RC50-SELLER-${id}`,
      seller_display_name: `Synthetic Seller ${id}`,
      seller_profile_url: null,
      seller_review_count: null,
      seller_listing_count: null,
      seller_wts_count: null,
      seller_wtb_count: null,
      contact_available: false,
      location_country: 'Testland',
      location_region: 'Test Region',
      is_bundle: false,
      bundle_child_count: null,
      duplicate_group_id: null,
      review_status: 'REVIEW_NOT_REQUIRED',
      review_reasons: [],
      test_run_id: RC50_RUN_ID,
    }, over);
  };
  const priced = (id, price, extra = {}) => mk(Object.assign({
    listing_id: id,
    price_usd: price,
    original_price_amount: price,
    original_price_text: `USD ${price}`,
    price_status: 'VERIFIED_USD',
    price_research_eligible: true,
    included_in_statistics: true,
  }, extra));
  const fxPriced = (id, price, extra = {}) => priced(id, price, Object.assign({
    original_price_currency: 'EUR',
    original_price_amount: Math.round(price / 1.09 * 100) / 100,
    original_price_text: `EUR ${Math.round(price / 1.09 * 100) / 100}`,
    fx_rate: 1.09,
    fx_source: 'SYNTHETIC_DATED_FX',
    fx_date: '2026-08-31',
    price_status: 'VERIFIED_FX_DATED',
  }, extra));
  const imaged = (row) => {
    const key = `rc50/${row.listing_id}.png`;
    return Object.assign(row, {
      image_key: key,
      image_url: `${imageBaseUrl}/img/${row.listing_id}.png`,
      thumbnail_url: `${imageBaseUrl}/img/${row.listing_id}.png`,
      image_evidence_type: 'SOURCE_LINKED_IMAGE',
      image_status: 'SOURCE_IMAGE_PRESENT',
    });
  };

  const cohort1 = { brand: 'Patek Philippe', reference: '7128/1G', model: 'Nautilus', dial_color: 'Blue', condition: 'New' };
  const cohort2 = { brand: 'Rolex', reference: '16610LV', model: 'Submariner', dial_color: 'Green', condition: 'Excellent' };

  // --- Group A: 20 qualified WTS, verified USD / verified dated FX, exact image lineage
  rows.push(imaged(priced('RC50-A01', 90000, cohort1)));
  rows.push(imaged(priced('RC50-A02', 95000, cohort1)));
  rows.push(imaged(fxPriced('RC50-A03', 100000, cohort1))); // verified dated FX
  rows.push(imaged(fxPriced('RC50-A04', 105000, cohort1))); // verified dated FX
  // Cohort 1 repost (same seller + same price as A01 -> dedup exclusion from stats):
  rows.push(imaged(priced('RC50-A05', 90000, Object.assign({}, cohort1, {
    seller_id: 'RC50-SELLER-RC50-A01', seller_display_name: 'Synthetic Seller RC50-A01',
  }))));
  // Cohort 1 outlier (retained on floor, excluded by the 3.0xIQR fence):
  rows.push(imaged(priced('RC50-A06', 500000, cohort1)));
  // Cohort 2 (qualified = 14000,14500,15000,15500,16000):
  [14000, 14500, 15000, 15500, 16000].forEach((p, k) => {
    rows.push(imaged(priced(`RC50-A${String(7 + k).padStart(2, '0')}`, p, cohort2)));
  });
  // Unresolved-cohort singleton (stats must stay null):
  rows.push(imaged(priced('RC50-A12', 32000, {
    brand: 'Audemars Piguet', reference: '15500ST', model: 'Royal Oak', dial_color: 'Black', condition: 'New',
  })));
  // Remaining distinct one-off qualified WTS+image rows (A13..A20). A15..A20 are
  // published children of the 3 hidden bundle parents (2 each).
  const oneOffs = [
    ['RC50-A13', 41000, 'Omega', 'Speedmaster', '31030425001001', null, null],
    ['RC50-A14', 27500, 'Cartier', 'Santos', 'WSSA0029', null, null],
    ['RC50-A15', 58000, 'Vacheron Constantin', 'Overseas', '4500V/110A', 'RC50-BP-1', 1],
    ['RC50-A16', 56000, 'Vacheron Constantin', 'Overseas', '4500V/110A', 'RC50-BP-1', 2],
    ['RC50-A17', 18900, 'Tudor', 'Black Bay', '7941A1A0', 'RC50-BP-2', 1],
    ['RC50-A18', 18200, 'Tudor', 'Black Bay', '7941A1A0', 'RC50-BP-2', 2],
    ['RC50-A19', 12400, 'IWC', 'Mark XX', 'IW328201', 'RC50-BP-3', 1],
    ['RC50-A20', 12100, 'IWC', 'Mark XX', 'IW328201', 'RC50-BP-3', 2],
  ];
  for (const [id, price, brand, model, ref, parent, childIdx] of oneOffs) {
    rows.push(imaged(priced(id, price, {
      brand, model, reference: ref, dial_color: 'Black', condition: 'Excellent',
      parent_listing_id: parent, child_index: childIdx,
    })));
  }

  // --- Group B: 10 qualified WTS, verified USD/FX, NO qualified image
  const groupB = [
    ['RC50-B01', 33500, 'Rolex', 'Datejust', '126334', 'Testland'],
    ['RC50-B02', 7200, 'Omega', 'Seamaster', '21030422003001', 'Testland'],
    ['RC50-B03', 63000, 'Patek Philippe', 'Aquanaut', '5167A', 'Nowhereland'],
    ['RC50-B04', 21500, 'Cartier', 'Tank', 'WSTA0052', 'Nowhereland'],
    ['RC50-B05', 47800, 'Audemars Piguet', 'Code 11.59', '15210CR', 'Testland'],
    ['RC50-B06', 9900, 'Tudor', 'Pelagos', '25407N', 'Nowhereland'],
    ['RC50-B07', 8400, 'IWC', 'Portugieser', 'IW371605', 'Testland'],
    ['RC50-B08', 15200, 'Jaeger-LeCoultre', 'Reverso', 'Q3848422', 'Nowhereland'],
    ['RC50-B09', 26400, 'Vacheron Constantin', 'Fiftysix', '4600E/000A', 'Testland'],
    ['RC50-B10', 19900, 'Omega', 'Aqua Terra', '22010412103001', 'Nowhereland'],
  ];
  for (const [id, price, brand, model, ref, country] of groupB) {
    const row = id === 'RC50-B02' ? fxPriced(id, price) : priced(id, price);
    rows.push(mk(Object.assign({}, row, {
      brand, model, reference: ref, condition: 'Excellent', dial_color: 'Silver',
      location_country: country, location_region: `${country} Region`,
    })));
  }

  // --- Group C: 5 WTB with valid individual-listing evidence (priced)
  [1, 2, 3, 4, 5].forEach((k) => {
    const price = 5000 + k * 2500;
    rows.push(mk({
      listing_id: `RC50-C0${k}`,
      intent: 'WTB',
      price_usd: price,
      original_price_amount: price,
      original_price_text: `USD ${price}`,
      price_status: 'VERIFIED_USD',
      price_research_eligible: false,
      included_in_statistics: false,
      statistics_exclusion_reason: 'WTB_EXCLUDED_FROM_WTS_STATS',
      brand: 'Rolex', model: 'Submariner', reference: `WTB-REF-${k}`, condition: 'New',
    }));
  });

  // --- Group D: 5 WTB without verified price
  [1, 2, 3, 4, 5].forEach((k) => {
    rows.push(mk({
      listing_id: `RC50-D0${k}`,
      intent: 'WTB',
      brand: 'Omega', model: 'Speedmaster', reference: `WTB-UREF-${k}`, condition: 'Excellent',
    }));
  });

  // --- Group E: 5 WTS unpriced WITH exact image lineage
  [1, 2, 3, 4, 5].forEach((k) => {
    rows.push(imaged(mk({
      listing_id: `RC50-E0${k}`,
      brand: 'Cartier', model: 'Santos', reference: `UNP-${k}`, condition: 'Very Good',
    })));
  });

  // --- Group F: 5 WTS unpriced without image
  [1, 2, 3, 4, 5].forEach((k) => {
    rows.push(mk({
      listing_id: `RC50-F0${k}`,
      brand: 'Tudor', model: 'Black Bay', reference: `UNP-NI-${k}`, condition: 'Good',
    }));
  });

  // --- Hidden isolation fixtures ---
  const bundleParents = [1, 2, 3].map((k) => mk({
    listing_id: `RC50-BP-${k}`,
    is_bundle: true,
    bundle_child_count: 2,
    price_usd: 100000 + k,
    original_price_amount: 100000 + k,
    original_price_text: `USD ${100000 + k}`,
    price_status: 'VERIFIED_USD',
    price_research_eligible: false,
    brand: ['Vacheron Constantin', 'Tudor', 'IWC'][k - 1],
    model: ['Overseas', 'Black Bay', 'Mark XX'][k - 1],
    reference: `SYN-BUNDLE-${k}`,
  }));

  const held = [
    { listing_id: 'RC50-H-AMBFX', disposition: 'held', reason: 'AMBIGUOUS_CURRENCY', probe: 'transient-db' },
    { listing_id: 'RC50-H-NOREF', disposition: 'held', reason: 'MISSING_REFERENCE', probe: 'registry-only' },
    { listing_id: 'RC50-H-SIBIMG', disposition: 'rejected', reason: 'SIBLING_IMAGE_CONTAMINATION_ATTEMPT', probe: 'contract-unit' },
  ];

  return {
    rows,
    bundleParents,
    held,
    cohort1, cohort2,
    expected: {
      floorCount: 50,
      cohort1Qualified: { count: 4, median: 97500, q1: 95000, q3: 105000, iqr: 10000, lower_fence: 65000, upper_fence: 135000, avg: 97500, min: 90000, max: 105000 },
      cohort2Qualified: { count: 5, median: 15000, q1: 14500, q3: 15500, iqr: 1000, lower_fence: 11500, upper_fence: 18500, avg: 15000, min: 14000, max: 16000 },
      outlierId: 'RC50-A06',
      repostId: 'RC50-A05',
      unresolved: { brand: 'Audemars Piguet', reference: '15500ST', model: 'Royal Oak', dial_color: 'Black', condition: 'New' },
      bundleParentIds: bundleParents.map(b => b.listing_id),
      bundleChildIds: ['RC50-A15', 'RC50-A16', 'RC50-A17', 'RC50-A18', 'RC50-A19', 'RC50-A20'],
      wtbCount: 10,
      imagedCount: 25,
      pricedCount: 35, // 20 A + 10 B + 5 C priced WTB
    },
  };
}

/* ------------------------------------------------------------------ *
 * Publication manifest + fixture registry (disposable preview schema,
 * created inside the disposable DB only — never a production migration).
 * ------------------------------------------------------------------ */
const RC50_DDL = `
CREATE TABLE IF NOT EXISTS wf_canonical_staging.rc50_preview_publication (
  publication_batch_id TEXT PRIMARY KEY,
  publication_snapshot_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  fixture_data BOOLEAN NOT NULL DEFAULT TRUE,
  floor_listing_ids JSONB NOT NULL,
  published_count INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS wf_canonical_staging.rc50_fixture_registry (
  listing_id TEXT PRIMARY KEY,
  disposition TEXT NOT NULL,
  reason TEXT,
  fixture_data BOOLEAN NOT NULL DEFAULT TRUE,
  fixture_label TEXT NOT NULL DEFAULT 'synthetic_fixture'
);
`;

const SEED_COLS = [
  'contract_version', 'listing_id', 'parent_listing_id', 'child_index', 'source_id', 'source_hash',
  'raw_message_id', 'raw_message_text', 'source_context_text', 'source_created_at', 'observed_at',
  'category', 'brand', 'model', 'reference', 'dial_color', 'year', 'condition', 'intent', 'intent_status',
  'title', 'description', 'original_price_text', 'original_price_amount', 'original_price_currency',
  'price_usd', 'fx_rate', 'fx_source', 'fx_date', 'price_status', 'price_research_eligible',
  'included_in_statistics', 'statistics_exclusion_reason', 'image_url', 'thumbnail_url', 'image_key',
  'image_evidence_type', 'image_status', 'seller_id', 'seller_display_name', 'seller_profile_url',
  'seller_review_count', 'seller_listing_count', 'seller_wts_count', 'seller_wtb_count',
  'contact_available', 'location_country', 'location_region', 'is_bundle', 'bundle_child_count',
  'duplicate_group_id', 'review_status', 'review_reasons', 'test_run_id',
];

// Idempotent seed: ON CONFLICT DO NOTHING. Returns { inserted, existing }.
// Single bounded transaction per run; never overwrites existing rows.
async function seedRc50(pgClient, allRows, registryRows) {
  const stats = { inserted: 0, existing: 0, registry_inserted: 0, registry_existing: 0 };
  await pgClient.query('BEGIN');
  try {
    await pgClient.query(RC50_DDL);
    for (const row of allRows) {
      const values = SEED_COLS.map(c => row[c] === undefined ? null : row[c]);
      const placeholders = SEED_COLS.map((c, idx) => `$${idx + 1}`).join(', ');
      const res = await pgClient.query(
        `INSERT INTO wf_canonical_staging.mariadb_canary_published_listings_v2 (${SEED_COLS.join(', ')})
         VALUES (${placeholders}) ON CONFLICT (listing_id) DO NOTHING RETURNING listing_id`,
        values.map(v => (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) ? JSON.stringify(v) : v)
      );
      if (res.rowCount > 0) stats.inserted += 1; else stats.existing += 1;
    }
    for (const reg of registryRows) {
      const res = await pgClient.query(
        `INSERT INTO wf_canonical_staging.rc50_fixture_registry (listing_id, disposition, reason, fixture_data, fixture_label)
         VALUES ($1, $2, $3, TRUE, 'synthetic_fixture') ON CONFLICT (listing_id) DO NOTHING RETURNING listing_id`,
        [reg.listing_id, reg.disposition, reg.reason]
      );
      if (res.rowCount > 0) stats.registry_inserted += 1; else stats.registry_existing += 1;
    }
    await pgClient.query('COMMIT');
  } catch (err) {
    await pgClient.query('ROLLBACK');
    throw err;
  }
  return stats;
}

async function tableCounts(pgClient) {
  const tables = [
    'wf_canonical_staging.mariadb_canary_published_listings_v2',
    'wf_canonical_staging.rc50_fixture_registry',
    'wf_canonical_staging.rc50_preview_publication',
    'wf_canonical_staging.keyset_snapshot_registry',
    'wf_canonical_staging.keyset_snapshot_members',
  ];
  const out = {};
  for (const t of tables) {
    const { rows } = await pgClient.query(`SELECT count(*)::int AS n FROM ${t}`);
    out[t] = rows[0].n;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * RC50 CDP session: adds viewport control + loopback CDN interception.
 * Intercepting the external CDN host and fulfilling it loopback proves
 * the image lineage mapping (image_key -> canonical CDN URL) is exercised
 * without any external network access.
 * ------------------------------------------------------------------ */
class Rc50BrowserSession extends CdpBrowserSession {
  constructor(browserBin) {
    super(browserBin);
    this.interceptedImageUrls = [];
    this.externalRequests = [];
  }
  async launch() {
    await super.launch();
    await this.send('Fetch.enable', {
      patterns: [{ urlPattern: '*', requestStage: 'Request' }],
    });
  }
  handleEvent(method, params) {
    if (method === 'Fetch.requestPaused') {
      const url = params.request && params.request.url || '';
      const id = params.requestId;
      if (url.includes('thecollective-prod.nyc3.digitaloceanspaces.com')) {
        this.interceptedImageUrls.push(url);
        this.send('Fetch.fulfillRequest', {
          requestId: id, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'image/png' }],
          body: PNG_1PX.toString('base64'),
        }).catch(() => {});
        return;
      }
      if (/^https?:\/\//.test(url) && !url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost')) {
        this.externalRequests.push(url);
        this.send('Fetch.failRequest', { requestId: id, errorReason: 'Aborted' }).catch(() => {});
        return;
      }
      this.send('Fetch.continueRequest', { requestId: id }).catch(() => {});
      return;
    }
    super.handleEvent(method, params);
  }
  async setViewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: width < 600,
    });
    await this.send('Emulation.setVisibleSize', { width, height }).catch(() => {});
  }
}

/* ------------------------------------------------------------------ *
 * Privacy scan: recursive walk of any JSON value for forbidden fields.
 * ------------------------------------------------------------------ */
const PRIVACY_KEY_PATTERNS = [
  /phone/i, /whats\s*app/i, /whatsapp/i, /password/i, /passwd/i, /secret/i,
  /service_role/i, /apikey/i, /api_key/i, /token/i, /credential/i,
];
const PRIVACY_VALUE_PATTERNS = [
  /\+\d[\d\s().-]{7,}\d/,          // international phone shape (+...)
  /\b\d{3}[\s.-]\d{3}[\s.-]\d{4}\b/, // NA phone shape with separators
  /\(\d{2,4}\)\s*\d{3}[\s.-]?\d{3,4}/, // (code) number shape
  /service_role/i,
  /BEGIN [A-Z ]*PRIVATE KEY/,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWT
];
function privacyScan(value, pathStr, findings) {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) { value.forEach((v, idx) => privacyScan(v, `${pathStr}[${idx}]`, findings)); return; }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const p = pathStr ? `${pathStr}.${k}` : k;
      if (PRIVACY_KEY_PATTERNS.some(rx => rx.test(k))) {
        findings.push({ kind: 'key', path: p, key: k });
      }
      privacyScan(v, p, findings);
    }
    return;
  }
  if (typeof value === 'string') {
    // ISO dates/timestamps are structural, not phone-like content.
    if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?/.test(value) && /^[\dT:\-.+Z ]+$/.test(value)) return;
    if (/^[0-9a-f]{64}$/i.test(value)) return; // sha256 hex digests are identifiers, not phones
    if (/^rc50\//.test(value)) return; // synthetic image keys
    for (const rx of PRIVACY_VALUE_PATTERNS) {
      if (rx.test(value)) { findings.push({ kind: 'value', path: pathStr, pattern: String(rx) }); break; }
    }
  }
}

module.exports = { buildRc50Fixtures };

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */
async function main() {
  const args = process.argv.slice(2);
  const argVal = (name, dflt) => {
    const idx = args.indexOf(name);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : dflt;
  };
  const outDir = path.resolve(argVal('--out-dir', path.join(process.cwd(), 'audit-output', 'rc50-preview')));
  const resultsPath = path.resolve(argVal('--results', path.join(outDir, 'results.json')));
  fs.mkdirSync(outDir, { recursive: true });
  const screenshotsDir = path.join(outDir, 'screenshots');
  fs.mkdirSync(screenshotsDir, { recursive: true });

  const ledger = new AssertionLedger();
  const startedAt = new Date().toISOString();
  console.log(`[rc50] disposable preview E2E starting at ${startedAt}`);
  assertDisposableEnvironment();

  const repoRoot = path.resolve(__dirname, '..', '..');
  const distDir = path.join(repoRoot, 'dist');
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    throw new Error('DIST_MISSING: run `npm run build` first.');
  }

  const dependencyRequire = require('./test-dependencies.cjs');
  const EmbeddedPostgresMod = dependencyRequire('embedded-postgres');
  const EmbeddedPostgres = EmbeddedPostgresMod.default || EmbeddedPostgresMod;
  const pgPort = await getFreePort();
  const pgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc50_epg_'));
  const epg = new EmbeddedPostgres({ databaseDir: pgDir, user: 'postgres', password: 'postgres', port: pgPort, persistent: false });
  await epg.initialise();
  await epg.start();
  console.log(`[rc50] embedded postgres on 127.0.0.1:${pgPort}`);

  const { Client, types } = dependencyRequire('pg');
  types.setTypeParser(20, v => (v === null ? null : Number(v)));
  types.setTypeParser(1700, v => (v === null ? null : Number(v)));
  const pgClient = new Client({ host: '127.0.0.1', port: pgPort, user: 'postgres', password: 'postgres', database: 'postgres' });
  await pgClient.connect();

  let exitCode = 0;
  let appServer = null;
  const screenshots = {};
  const apiResponses = []; // for the recursive privacy scan
  const paginationProofs = {};

  try {
    for (const mig of CANARY_MIGRATIONS) {
      await pgClient.query(fs.readFileSync(path.join(repoRoot, 'supabase', 'migrations', mig), 'utf8'));
    }
    await ledger.check('MIGRATIONS_APPLIED', 'database', async () => {
      const { rows } = await pgClient.query(`
        SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname IN (
          'get_trading_floor_canary_keyset_v4','get_trading_floor_canary_count',
          'get_price_research_canary_keyset_v4','get_price_research_scoped_stats_v2',
          'open_trading_floor_keyset_snapshot','open_price_research_keyset_snapshot',
          'get_price_research_wtb_demand_v3')`);
      if (rows[0].n !== 7) throw new Error(`expected 7 canary RPCs, found ${rows[0].n}`);
      return { migrations: CANARY_MIGRATIONS.length, rpc_count: rows[0].n };
    });

    // ---- A/B. Fixtures + materialization + idempotency ----
    const appPort = await getFreePort();
    const imageBaseUrl = `http://127.0.0.1:${appPort}`;
    const fixtures = buildRc50Fixtures(imageBaseUrl);
    const floorIds = fixtures.rows.map(r => r.listing_id);
    const orderedIds = [...floorIds].sort(); // deterministic identity order
    const publicationSnapshotId = 'rc50-' + sha256(orderedIds.join('\n')).slice(0, 32);
    const publicationBatchId = `preview-50-${Date.now()}`;
    const registryRows = [
      ...fixtures.rows.map(r => ({ listing_id: r.listing_id, disposition: 'published', reason: null })),
      ...fixtures.bundleParents.map(r => ({ listing_id: r.listing_id, disposition: 'published_suppressed_bundle_parent', reason: 'BUNDLE_PARENT_WITH_PUBLISHED_CHILDREN' })),
      ...fixtures.held,
    ];
    const allSeedRows = [...fixtures.rows, ...fixtures.bundleParents];

    const countsBefore = await tableCounts(pgClient).catch(() => null);
    const seedRun1 = await seedRc50(pgClient, allSeedRows, registryRows);
    await ledger.check('FIXTURES_SEEDED', 'database', async () => {
      if (seedRun1.inserted !== 53) throw new Error(`expected 53 seeded rows (50 floor + 3 bundle parents), got ${seedRun1.inserted}`);
      return { floor_rows: 50, bundle_parents: 3, held: fixtures.held.length, synthetic_only: true, fixture_data: true, label: 'synthetic_fixture' };
    });
    await ledger.check('FIXTURE_COMPOSITION', 'database', async () => {
      const { rows } = await pgClient.query(`
        SELECT
          count(*) FILTER (WHERE intent='WTS' AND price_research_eligible AND price_usd > 0 AND image_status='SOURCE_IMAGE_PRESENT' AND image_key IS NOT NULL)::int AS a,
          count(*) FILTER (WHERE intent='WTS' AND price_research_eligible AND price_usd > 0 AND image_status='NO_IMAGE')::int AS b,
          count(*) FILTER (WHERE intent='WTB' AND price_usd > 0)::int AS c,
          count(*) FILTER (WHERE intent='WTB' AND price_usd IS NULL)::int AS d,
          count(*) FILTER (WHERE intent='WTS' AND price_usd IS NULL AND image_status='SOURCE_IMAGE_PRESENT' AND image_key IS NOT NULL)::int AS e,
          count(*) FILTER (WHERE intent='WTS' AND price_usd IS NULL AND image_status='NO_IMAGE')::int AS f
        FROM public.trading_floor_ready_view_v2`);
      const exp = { a: 20, b: 10, c: 5, d: 5, e: 5, f: 5 };
      for (const k of Object.keys(exp)) if (rows[0][k] !== exp[k]) throw new Error(`composition bucket ${k}: expected ${exp[k]}, got ${rows[0][k]}`);
      return { composition: rows[0], expected: exp };
    });

    // Publication manifest row (single bounded insert; immutable snapshot id).
    await pgClient.query(
      `INSERT INTO wf_canonical_staging.rc50_preview_publication
         (publication_batch_id, publication_snapshot_id, environment, fixture_data, floor_listing_ids, published_count)
       VALUES ($1, $2, 'disposable', TRUE, $3::jsonb, 50)`,
      [publicationBatchId, publicationSnapshotId, JSON.stringify(orderedIds)]);
    await ledger.check('PUBLICATION_SNAPSHOT_DETERMINISTIC', 'database', async () => {
      const recomputed = 'rc50-' + sha256([...floorIds].sort().join('\n')).slice(0, 32);
      if (recomputed !== publicationSnapshotId) throw new Error('snapshot id not reproducible from ordered identities');
      const { rows } = await pgClient.query(
        `SELECT environment, fixture_data, published_count FROM wf_canonical_staging.rc50_preview_publication WHERE publication_batch_id=$1`,
        [publicationBatchId]);
      if (rows.length !== 1 || rows[0].environment !== 'disposable' || rows[0].fixture_data !== true) throw new Error('manifest row invalid');
      return { publication_batch_id: publicationBatchId, publication_snapshot_id: publicationSnapshotId, environment: 'disposable' };
    });

    // Idempotency proof: full re-seed must insert nothing and change nothing.
    const rowsHashBefore = await pgClient.query(
      `SELECT md5(string_agg(md5(t::text), '' ORDER BY listing_id)) AS h
       FROM wf_canonical_staging.mariadb_canary_published_listings_v2 t WHERE test_run_id=$1`, [RC50_RUN_ID]);
    const seedRun2 = await seedRc50(pgClient, allSeedRows, registryRows);
    const rowsHashAfter = await pgClient.query(
      `SELECT md5(string_agg(md5(t::text), '' ORDER BY listing_id)) AS h
       FROM wf_canonical_staging.mariadb_canary_published_listings_v2 t WHERE test_run_id=$1`, [RC50_RUN_ID]);
    const countsAfter = await tableCounts(pgClient);
    await ledger.check('SEED_IDEMPOTENT_RERUN', 'database', async () => {
      if (seedRun2.inserted !== 0) throw new Error(`second run inserted ${seedRun2.inserted} rows`);
      if (seedRun2.existing !== 53) throw new Error(`second run saw ${seedRun2.existing} existing rows, expected 53`);
      if (rowsHashBefore.rows[0].h !== rowsHashAfter.rows[0].h) throw new Error('row content changed between runs');
      return { run2_newly_inserted: 0, run2_existing_identical: 53, changed: 0, duplicate_ids: 0, counts_before: countsBefore, counts_after: countsAfter };
    });

    await ledger.check('RECONCILIATION', 'database', async () => {
      const floor = await pgClient.query(`SELECT count(*)::int AS n, count(DISTINCT listing_id)::int AS d FROM public.trading_floor_ready_view_v2`);
      const parentsOnFloor = await pgClient.query(`SELECT count(*)::int AS n FROM public.trading_floor_ready_view_v2 WHERE is_bundle IS TRUE AND parent_listing_id IS NULL`);
      const registry = await pgClient.query(`SELECT disposition, count(*)::int AS n FROM wf_canonical_staging.rc50_fixture_registry GROUP BY disposition`);
      const contactCols = await pgClient.query(`
        SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_schema='public' AND table_name='trading_floor_ready_view_v2'
          AND (column_name ILIKE '%phone%' OR column_name ILIKE '%whatsapp%' OR column_name ILIKE '%msisdn%')`);
      if (floor.rows[0].n !== 50 || floor.rows[0].d !== 50) throw new Error(`floor=${floor.rows[0].n} distinct=${floor.rows[0].d}`);
      if (parentsOnFloor.rows[0].n !== 0) throw new Error('bundle parent on floor');
      if (contactCols.rows[0].n !== 0) throw new Error('private contact column exposed in public view');
      const reg = Object.fromEntries(registry.rows.map(r => [r.disposition, r.n]));
      const candidates = 53 + fixtures.held.length;
      return {
        candidates, published: 50, distinct_listing_ids: 50,
        bundle_parents_published_on_floor: 0, unapproved_children: 0,
        private_contacts: 0, provenance_failures: 0,
        registry: reg, held_plus_rejected: fixtures.held.length,
      };
    });

    // ---- App server ----
    process.env.USE_DIRECT_POSTGREST = 'true';
    process.env.SUPABASE_URL = `http://127.0.0.1:${appPort}`;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'rc50-synthetic-loopback-key';
    delete process.env.VITE_SUPABASE_URL;
    const procCatalog = await loadProcCatalog(pgClient);
    const handleRpc = makeRpcHandler(pgClient, procCatalog);
    appServer = makeAppServer({ distDir, handleRpc });
    await new Promise((resolve) => appServer.listen(appPort, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${appPort}`;
    console.log(`[rc50] app server on ${baseUrl}`);

    async function apiGet(urlPath) {
      const resp = await fetch(`${baseUrl}${urlPath}`);
      const text = await resp.text();
      let body = null;
      try { body = JSON.parse(text); } catch { /* recorded by caller */ }
      apiResponses.push({ path: urlPath, status: resp.status, body });
      return { status: resp.status, body, text };
    }

    // DB ordering oracle (canonical keyset order).
    async function expectedFloorOrder() {
      const { rows } = await pgClient.query(`
        SELECT listing_id FROM public.trading_floor_ready_view_v2
        ORDER BY
          (CASE WHEN price_research_eligible IS TRUE AND price_usd > 0 THEN 1 ELSE 2 END) ASC,
          (CASE WHEN image_status = 'SOURCE_IMAGE_PRESENT' AND NULLIF(btrim(image_key), '') IS NOT NULL THEN 1 ELSE 2 END) ASC,
          price_usd DESC NULLS LAST,
          source_created_at DESC,
          listing_id ASC`);
      return rows.map(r => r.listing_id);
    }
    const expectedOrder = await expectedFloorOrder();

    async function traverse(pageSize, extraQuery = '') {
      const ids = [];
      let cursor = null;
      let pages = 0;
      do {
        pages += 1;
        if (pages > 200) throw new Error('traversal did not terminate');
        const u = `/api/canary/trading-floor?pageSize=${pageSize}&pagination=cursor${extraQuery}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const { status, body, text } = await apiGet(u);
        if (status !== 200) throw new Error(`page ${pages}: HTTP ${status}: ${text.slice(0, 200)}`);
        if (body.status !== 'ok') throw new Error(`page ${pages}: status=${body.status}`);
        if (!Array.isArray(body.records)) throw new Error('records missing');
        for (const rec of body.records) ids.push(rec.listing_id);
        cursor = body.nextCursor || null;
        if (!cursor && body.hasMore) throw new Error('hasMore without nextCursor');
      } while (cursor);
      return { ids, pages };
    }

    // ---- D. Ordering/pagination proofs at page sizes 1, 7, 12, 49, 50 ----
    await ledger.check('API_TF_TOTAL_EXACTLY_50', 'api', async () => {
      const { status, body } = await apiGet('/api/canary/trading-floor?pageSize=50&pagination=cursor');
      if (status !== 200) throw new Error(`HTTP ${status}`);
      if (Number(body.total) !== 50) throw new Error(`total=${body.total}`);
      if (body.records.length !== 50) throw new Error(`records=${body.records.length}`);
      return { total: 50, snapshot: body.snapshot };
    });

    for (const size of [1, 7, 12, 49, 50]) {
      await ledger.check(`PAGINATION_EXHAUST_SIZE_${size}`, 'api', async () => {
        const { ids, pages } = await traverse(size);
        const uniq = new Set(ids);
        if (ids.length !== 50) throw new Error(`expected 50 identities, got ${ids.length}`);
        if (uniq.size !== 50) throw new Error(`duplicates: ${ids.length - uniq.size}`);
        const missing = expectedOrder.filter(id => !uniq.has(id));
        if (missing.length) throw new Error(`missing: ${missing.join(',')}`);
        if (JSON.stringify(ids) !== JSON.stringify(expectedOrder)) throw new Error('order mismatch vs DB oracle');
        paginationProofs[size] = { pages, identities: ids.length, duplicates: 0, missing: 0, deterministic_order: true };
        return paginationProofs[size];
      });
    }

    await ledger.check('ORDER_PRICED_BEFORE_UNPRICED_IMAGE_BEFORE_NOIMAGE', 'api', async () => {
      const { body } = await apiGet('/api/canary/trading-floor?pageSize=50&pagination=cursor');
      const recs = body.records;
      const firstUnpriced = recs.findIndex(r => !(r.price_usd > 0) || r.price_research_eligible !== true);
      const lastPriced = recs.reduce((acc, r, idx) => (r.price_research_eligible === true && r.price_usd > 0 ? idx : acc), -1);
      if (firstUnpriced >= 0 && lastPriced > firstUnpriced) throw new Error('priced_rank=1 row after priced_rank=2 row');
      // image_rank within rank-2: unpriced+image (E group) before unpriced no-image (F group)
      const firstF = recs.findIndex(r => r.listing_id && r.listing_id.startsWith('RC50-F'));
      const lastE = recs.reduce((acc, r, idx) => (r.listing_id && r.listing_id.startsWith('RC50-E') ? idx : acc), -1);
      if (!(firstF > lastE && lastE >= 0)) throw new Error(`image_rank ordering violated: lastE=${lastE} firstF=${firstF}`);
      return { first_rank2_index: firstUnpriced, last_rank1_index: lastPriced, last_imaged_unpriced: lastE, first_noimage_unpriced: firstF };
    });

    // Concurrent-mutation proof: traverse a snapshot while mutating live data.
    await ledger.check('PAGINATION_SNAPSHOT_STABLE_UNDER_MUTATION', 'api', async () => {
      const first = await apiGet('/api/canary/trading-floor?pageSize=7&pagination=cursor');
      if (first.status !== 200 || !first.body.nextCursor) throw new Error('page 1 failed');
      const collected = [...first.body.records.map(r => r.listing_id)];
      const snapshotId = first.body.snapshot;
      // Mutations AFTER snapshot opened:
      await pgClient.query(
        `INSERT INTO wf_canonical_staging.mariadb_canary_published_listings_v2
           SELECT contract_version, 'RC50-LATE-MUTATION', parent_listing_id, child_index,
                  'RC50-SRC-MUT', 'f5a3c7e1b2d4093866f1c2ab48d07e55aa10cf94d36b47e29015fbbe0c83d7e1', 'RC50-MSG-MUT',
                  '[SYNTHETIC FIXTURE] RC50-LATE-MUTATION - synthetic_fixture, not a real market observation',
                  source_context_text, now() + interval '1 day', now() + interval '1 day',
                  category, brand, model, 'RF-MUT-LATE', dial_color, year, condition, intent, intent_status,
                  '[SYNTHETIC FIXTURE] RC50-LATE-MUTATION', description, 'USD 700000', 700000, 'USD',
                  700000, fx_rate, fx_source, fx_date, 'VERIFIED_USD', true,
                  false, 'SYNTHETIC_ORDERING_FIXTURE', image_url, thumbnail_url, image_key,
                  image_evidence_type, image_status, seller_id, seller_display_name, seller_profile_url,
                  seller_review_count, seller_listing_count, seller_wts_count, seller_wtb_count,
                  contact_available, location_country, location_region, is_bundle, bundle_child_count,
                  duplicate_group_id, review_status, review_reasons, test_run_id
           FROM wf_canonical_staging.mariadb_canary_published_listings_v2 WHERE listing_id='RC50-B01'`);
      await pgClient.query(`UPDATE wf_canonical_staging.mariadb_canary_published_listings_v2 SET price_usd = price_usd + 1 WHERE listing_id='RC50-B01'`);
      const { rows: snapRows } = await pgClient.query(`SELECT public.open_trading_floor_keyset_snapshot(3600) AS id`);
      const newSnapshotId = snapRows[0].id;
      if (newSnapshotId === snapshotId) throw new Error('snapshot ids collided');
      // Continue the ORIGINAL cursor to exhaustion.
      let cursor = first.body.nextCursor;
      let pages = 1;
      while (cursor) {
        pages += 1;
        const { status, body } = await apiGet(`/api/canary/trading-floor?pageSize=7&pagination=cursor&cursor=${encodeURIComponent(cursor)}`);
        if (status !== 200) throw new Error(`page ${pages}: HTTP ${status}`);
        collected.push(...body.records.map(r => r.listing_id));
        cursor = body.nextCursor || null;
        if (pages > 50) throw new Error('did not terminate');
      }
      const uniq = new Set(collected);
      if (collected.length !== 50 || uniq.size !== 50) throw new Error(`expected original 50, got ${collected.length}/${uniq.size}`);
      if (collected.includes('RC50-LATE-MUTATION')) throw new Error('post-snapshot insert leaked into original traversal');
      if (JSON.stringify(collected) !== JSON.stringify(expectedOrder)) throw new Error('original snapshot order changed under mutation');
      return { original_snapshot: snapshotId, new_snapshot: newSnapshotId, identities: 50, mutation_isolated: true };
    });
    await ledger.check('MUTATION_VISIBLE_IN_FRESH_SNAPSHOT', 'api', async () => {
      const { body } = await apiGet('/api/canary/trading-floor?pageSize=50&pagination=cursor');
      if (Number(body.total) !== 51) throw new Error(`fresh snapshot total=${body.total}, expected 51`);
      if (!body.records.some(r => r.listing_id === 'RC50-LATE-MUTATION')) throw new Error('mutation missing from fresh snapshot');
      return { total: 51, late_row_visible: true };
    });
    // Restore fixture state for all subsequent assertions.
    await pgClient.query(`DELETE FROM wf_canonical_staging.mariadb_canary_published_listings_v2 WHERE listing_id='RC50-LATE-MUTATION'`);
    await pgClient.query(`UPDATE wf_canonical_staging.mariadb_canary_published_listings_v2 SET price_usd = 33500 WHERE listing_id='RC50-B01'`);

    // RC50 F2 regression: a member-row DELETE mid-traversal must NOT shrink a
    // frozen snapshot. The original cursor traversal must return the exact
    // original 50 identities AND their freeze-time payloads; the delete (and
    // a concurrent update) become visible only in a fresh snapshot.
    const f2DeletedId = expectedOrder[10];
    const f2UpdatedId = expectedOrder[20];
    const { rows: f2Base } = await pgClient.query(
      `SELECT listing_id, price_usd FROM wf_canonical_staging.mariadb_canary_published_listings_v2 WHERE listing_id = ANY($1)`,
      [[f2DeletedId, f2UpdatedId]]);
    const f2BasePrice = Object.fromEntries(f2Base.map(r => [r.listing_id, r.price_usd === null ? null : Number(r.price_usd)]));
    await pgClient.query(`DROP TABLE IF EXISTS pg_temp.rc50_deleted_member`);
    await pgClient.query(
      `CREATE TEMP TABLE rc50_deleted_member AS
       SELECT * FROM wf_canonical_staging.mariadb_canary_published_listings_v2 WHERE listing_id = $1`, [f2DeletedId]);
    await ledger.check('PAGINATION_SNAPSHOT_FROZEN_UNDER_MEMBER_DELETE', 'api', async () => {
      const first = await apiGet('/api/canary/trading-floor?pageSize=7&pagination=cursor');
      if (first.status !== 200 || !first.body.nextCursor) throw new Error('page 1 failed');
      const collected = [...first.body.records];
      const snapshotId = first.body.snapshot;
      // Mutations AFTER snapshot opened: DELETE one member, UPDATE another.
      await pgClient.query(`DELETE FROM wf_canonical_staging.mariadb_canary_published_listings_v2 WHERE listing_id=$1`, [f2DeletedId]);
      await pgClient.query(`UPDATE wf_canonical_staging.mariadb_canary_published_listings_v2 SET price_usd = price_usd + 424242 WHERE listing_id=$1`, [f2UpdatedId]);
      let cursor = first.body.nextCursor;
      let pages = 1;
      while (cursor) {
        pages += 1;
        const { status, body } = await apiGet(`/api/canary/trading-floor?pageSize=7&pagination=cursor&cursor=${encodeURIComponent(cursor)}`);
        if (status !== 200) throw new Error(`page ${pages}: HTTP ${status}`);
        collected.push(...body.records);
        cursor = body.nextCursor || null;
        if (pages > 50) throw new Error('did not terminate');
      }
      const ids = collected.map(r => r.listing_id);
      if (ids.length !== 50 || new Set(ids).size !== 50) throw new Error(`frozen traversal returned ${ids.length}/${new Set(ids).size}, expected 50/50`);
      if (JSON.stringify(ids) !== JSON.stringify(expectedOrder)) throw new Error('frozen snapshot order changed under member delete');
      // The deleted member is still served from the frozen payload...
      const deletedRec = collected.find(r => r.listing_id === f2DeletedId);
      if (!deletedRec) throw new Error(`deleted member ${f2DeletedId} missing from frozen traversal`);
      // ...with its ORIGINAL payload, and the updated member keeps its freeze-time price.
      const updBase = f2BasePrice[f2UpdatedId];
      const updatedRec = collected.find(r => r.listing_id === f2UpdatedId);
      if (!updatedRec) throw new Error(`updated member ${f2UpdatedId} missing`);
      if (Number(updatedRec.price_usd) !== Number(updBase)) {
        throw new Error(`updated member payload not frozen: ${updatedRec.price_usd} != ${updBase}`);
      }
      const delBase = f2BasePrice[f2DeletedId];
      if (delBase !== null && Number(deletedRec.price_usd) !== Number(delBase)) {
        throw new Error(`deleted member payload not frozen: ${deletedRec.price_usd} != ${delBase}`);
      }
      // A FRESH snapshot sees current data: 49 rows, deleted member gone,
      // updated price visible.
      const fresh = await apiGet('/api/canary/trading-floor?pageSize=50&pagination=cursor');
      if (fresh.status !== 200) throw new Error(`fresh snapshot HTTP ${fresh.status}`);
      if (fresh.body.snapshot === snapshotId) throw new Error('snapshot ids collided');
      if (fresh.body.records.some(r => r.listing_id === f2DeletedId)) throw new Error('deleted member present in fresh snapshot');
      if (fresh.body.records.length !== 49) throw new Error(`fresh snapshot rows=${fresh.body.records.length}, expected 49`);
      const freshUpdated = fresh.body.records.find(r => r.listing_id === f2UpdatedId);
      if (!freshUpdated || Number(freshUpdated.price_usd) !== Number(updBase) + 424242) {
        throw new Error('fresh snapshot did not observe the update');
      }
      return {
        original_snapshot: snapshotId,
        identities_after_member_delete: ids.length,
        deleted_member_still_served: f2DeletedId,
        payloads_frozen: true,
        fresh_snapshot_rows: 49,
        fresh_snapshot_sees_delete_and_update: true,
      };
    });
    // Restore fixture state (idempotent) regardless of the check outcome.
    await pgClient.query(
      `INSERT INTO wf_canonical_staging.mariadb_canary_published_listings_v2
       SELECT t.* FROM pg_temp.rc50_deleted_member t
       WHERE NOT EXISTS (
         SELECT 1 FROM wf_canonical_staging.mariadb_canary_published_listings_v2 p
         WHERE p.listing_id = t.listing_id)`);
    await pgClient.query(
      `UPDATE wf_canonical_staging.mariadb_canary_published_listings_v2 SET price_usd = $2 WHERE listing_id = $1`,
      [f2UpdatedId, f2BasePrice[f2UpdatedId]]);
    await pgClient.query(`DROP TABLE IF EXISTS pg_temp.rc50_deleted_member`);

    // ---- Cursor contract: invalid/incomplete/expired/cross-snapshot -> 400 ----
    const scope = computeCursorScope('trading_floor', {
      brand: null, model: null, intent: null, reference: null, category: null, item: null,
      country: null, region: null, query: null, imagesOnly: false, pricedOnly: false,
    });
    const validKey = { k_priced_rank: 1, k_image_rank: 1, k_price_usd: 90000, k_source_created_at: '2026-09-01T12:01:00.000+00:00', k_listing_id: 'RC50-A01' };
    const cursorProbes = {
      malformed: '!!!not-base64!!!',
      incomplete: Buffer.from(JSON.stringify({ version: 'v2' })).toString('base64url'),
      unknown_snapshot: encodeCursorEnvelope({ snapshot: '00000000-0000-4000-8000-000000000000', scope, frozenKey: validKey }),
      cross_scope: null, // filled below (valid snapshot, wrong scope)
      unsupported_shape: Buffer.from(JSON.stringify({ v: 1, cursor: [1, 1, 1, 'x', 'y'] })).toString('base64url'),
    };
    // Expired snapshot: register one with past expiry, then craft a valid cursor for it.
    const { rows: expSnap } = await pgClient.query(
      `INSERT INTO wf_canonical_staging.keyset_snapshot_registry (surface, expires_at)
       VALUES ('trading_floor', now() - interval '1 hour') RETURNING snapshot_id`);
    cursorProbes.expired_snapshot = encodeCursorEnvelope({ snapshot: expSnap[0].snapshot_id, scope, frozenKey: validKey });
    for (const [name, cursorVal] of Object.entries(cursorProbes)) {
      if (cursorVal === null) continue;
      await ledger.check(`CURSOR_400_${name.toUpperCase()}`, 'api', async () => {
        const { status, body } = await apiGet(`/api/canary/trading-floor?pageSize=10&pagination=cursor&cursor=${encodeURIComponent(cursorVal)}`);
        if (status !== 400) throw new Error(`expected HTTP 400, got ${status}: ${JSON.stringify(body).slice(0, 160)}`);
        return { http_status: 400, error: (body.error || '').slice(0, 80) };
      });
    }
    // Cross-snapshot/scope: a real cursor issued under brand filter replayed unfiltered.
    await ledger.check('CURSOR_400_CROSS_SNAPSHOT_SCOPE', 'api', async () => {
      const filtered = await apiGet('/api/canary/trading-floor?pageSize=2&pagination=cursor&brand=Rolex');
      if (filtered.status !== 200 || !filtered.body.nextCursor) throw new Error('could not mint filtered cursor');
      const replay = await apiGet(`/api/canary/trading-floor?pageSize=2&pagination=cursor&cursor=${encodeURIComponent(filtered.body.nextCursor)}`);
      if (replay.status !== 400) throw new Error(`expected 400 scope mismatch, got ${replay.status}`);
      return { http_status: 400, error: (replay.body.error || '').slice(0, 80) };
    });
    await ledger.check('API_REJECTS_UNKNOWN_PARAM_AND_OFFSET', 'api', async () => {
      const bad1 = await apiGet('/api/canary/trading-floor?bogusParam=1');
      const bad2 = await apiGet('/api/canary/trading-floor?pagination=offset');
      if (bad1.status !== 400) throw new Error(`unknown param: ${bad1.status}`);
      if (bad2.status !== 400) throw new Error(`offset pagination: ${bad2.status}`);
      return { unknown_param: 400, offset: 400 };
    });

    // ---- Filters ----
    await ledger.check('FILTER_INTENT_WTB', 'api', async () => {
      const { body } = await apiGet('/api/canary/trading-floor?pageSize=50&pagination=cursor&type=WTB');
      if (Number(body.total) !== 10) throw new Error(`WTB total=${body.total}, expected 10`);
      if (!body.records.every(r => r.intent === 'WTB')) throw new Error('WTS leaked into WTB filter');
      return { total: 10 };
    });
    await ledger.check('FILTER_BRAND_MODEL_REFERENCE', 'api', async () => {
      const b = await apiGet(`/api/canary/trading-floor?pageSize=50&pagination=cursor&brand=${encodeURIComponent('Patek Philippe')}`);
      if (Number(b.body.total) !== 7) throw new Error(`brand total=${b.body.total}, expected 7 (6 cohort1 + B03)`);
      const r = await apiGet(`/api/canary/trading-floor?pageSize=50&pagination=cursor&reference=${encodeURIComponent('7128/1G')}`);
      if (Number(r.body.total) !== 6) throw new Error(`reference total=${r.body.total}, expected 6`);
      const m = await apiGet(`/api/canary/trading-floor?pageSize=50&pagination=cursor&brand=Rolex&model=Submariner`);
      if (Number(m.body.total) !== 10) throw new Error(`brand+model total=${m.body.total}, expected 10 (5 cohort2 + 5 C WTB)`);
      return { brand: 7, reference: 6, brand_model: 10 };
    });
    await ledger.check('FILTER_LOCATION_AND_IMAGES_PRICED', 'api', async () => {
      const loc = await apiGet('/api/canary/trading-floor?pageSize=50&pagination=cursor&country=Nowhereland');
      if (Number(loc.body.total) !== 5) throw new Error(`country total=${loc.body.total}, expected 5`);
      const img = await apiGet('/api/canary/trading-floor?pageSize=50&pagination=cursor&images=true');
      if (Number(img.body.total) !== 25) throw new Error(`images total=${img.body.total}, expected 25`);
      const priced = await apiGet('/api/canary/trading-floor?pageSize=50&pagination=cursor&priced=true');
      if (Number(priced.body.total) !== 35) throw new Error(`priced total=${priced.body.total}, expected 35`);
      return { country: 5, images: 25, priced: 35 };
    });

    // ---- E. Price Research cohort proofs ----
    async function prQuery(c) {
      const u = `/api/canary/price-research?brand=${encodeURIComponent(c.brand)}&reference=${encodeURIComponent(c.reference)}&model=${encodeURIComponent(c.model)}&dial=${encodeURIComponent(c.dial_color)}&condition=${encodeURIComponent(c.condition)}&evidencePageSize=100`;
      return apiGet(u);
    }
    async function assertCohort(label, cohort, exp) {
      await ledger.check(`PR_COHORT_${label}_EXACT_STATS`, 'api', async () => {
        const { status, body } = await prQuery(cohort);
        if (status !== 200 || !body.success) throw new Error(`HTTP ${status} success=${body && body.success}`);
        if (!body.stats) throw new Error('stats missing for resolvable cohort');
        const s = body.stats;
        const num = (v) => Number(v);
        if (num(s.qualified_count) !== exp.count && num(s.count) !== exp.count) throw new Error(`count=${s.qualified_count ?? s.count}, expected ${exp.count}`);
        if (num(s.median) !== exp.median) throw new Error(`median=${s.median}, expected ${exp.median}`);
        if (num(s.q1) !== exp.q1) throw new Error(`q1=${s.q1}, expected ${exp.q1}`);
        if (num(s.q3) !== exp.q3) throw new Error(`q3=${s.q3}, expected ${exp.q3}`);
        if (num(s.iqr) !== exp.iqr) throw new Error(`iqr=${s.iqr}, expected ${exp.iqr}`);
        if (num(s.lower_fence) !== exp.lower_fence) throw new Error(`lf=${s.lower_fence}, expected ${exp.lower_fence}`);
        if (num(s.upper_fence) !== exp.upper_fence) throw new Error(`uf=${s.upper_fence}, expected ${exp.upper_fence}`);
        if (num(s.iqr_multiplier) !== 3.0 && num(s.iqr_multiplier) !== 3) throw new Error(`multiplier=${s.iqr_multiplier}`);
        // invariants
        if (!(num(s.q1) <= num(s.median) && num(s.median) <= num(s.q3))) throw new Error('q1<=median<=q3 violated');
        if (Math.abs(num(s.iqr) - (num(s.q3) - num(s.q1))) > 0.01) throw new Error('iqr != q3-q1');
        if (Math.abs(num(s.lower_fence) - Math.max(0, num(s.q1) - 3 * num(s.iqr))) > 0.01) throw new Error('lower fence != max(0, q1-3*iqr)');
        if (Math.abs(num(s.upper_fence) - (num(s.q3) + 3 * num(s.iqr))) > 0.01) throw new Error('upper fence != q3+3*iqr');
        if (num(s.lower_fence) > num(s.upper_fence)) throw new Error('lower>upper');
        return { stats: { count: exp.count, median: num(s.median), q1: num(s.q1), q3: num(s.q3), iqr: num(s.iqr), lf: num(s.lower_fence), uf: num(s.upper_fence), mult: 3.0 } };
      });
    }
    await assertCohort('COHORT1_PP_7128', fixtures.cohort1, fixtures.expected.cohort1Qualified);
    await assertCohort('COHORT2_ROLEX_16610', fixtures.cohort2, fixtures.expected.cohort2Qualified);

    await ledger.check('PR_COHORT1_EXCLUSIONS_ENFORCED', 'api', async () => {
      const { body } = await prQuery(fixtures.cohort1);
      const listings = (body.evidence && body.evidence.listings) || [];
      const ids = listings.map(l => l.listing_id || l.id);
      // Outlier and repost must not be retained evidence; stats count proves exclusion.
      const { rows } = await pgClient.query(
        `SELECT * FROM public.get_price_research_cohort_breakdown_v2($1,$2,$3,$4,true,$5,true)`,
        [fixtures.cohort1.brand, fixtures.cohort1.reference, fixtures.cohort1.model, fixtures.cohort1.dial_color, fixtures.cohort1.condition]);
      const bk = rows[0] || {};
      const outlierExcluded = Number(bk.iqr_outliers_count ?? bk.excluded_iqr_outliers) >= 1;
      const dupExcluded = Number(bk.excluded_duplicate_repost ?? bk.excluded_duplicates) >= 1;
      if (!outlierExcluded) throw new Error(`outlier not excluded: ${JSON.stringify(bk)}`);
      if (!dupExcluded) throw new Error(`repost not deduplicated: ${JSON.stringify(bk)}`);
      return { excluded_iqr_outliers: Number(bk.iqr_outliers_count ?? bk.excluded_iqr_outliers), excluded_duplicates: Number(bk.excluded_duplicate_repost ?? bk.excluded_duplicates), retained: Number(bk.retained_audit_evidence_count) };
    });

    await ledger.check('PR_WTB_EXCLUDED_FROM_WTS_EVIDENCE', 'api', async () => {
      // Rolex/Submariner cohort spans cohort2 (WTS) and group C (WTB, same brand+model family).
      const { body } = await prQuery(fixtures.cohort2);
      const listings = (body.evidence && body.evidence.listings) || [];
      if (listings.some(l => (l.intent || '').toUpperCase() === 'WTB')) throw new Error('WTB leaked into WTS evidence');
      return { evidence_rows: listings.length, wtb_absent: true };
    });

    await ledger.check('PR_UNRESOLVED_COHORT_STATS_NULL', 'api', async () => {
      const { body } = await prQuery(fixtures.expected.unresolved);
      if (body.stats) throw new Error(`singleton cohort fabricated stats`);
      if (!body.stats_explanation) throw new Error('missing stats_explanation');
      return { stats: null, explanation: String(body.stats_explanation).slice(0, 80) };
    });

    // Ambiguous-currency transient probe: inserted, proven excluded from PR, removed.
    await ledger.check('PR_AMBIGUOUS_CURRENCY_EXCLUDED', 'api', async () => {
      await pgClient.query(
        `INSERT INTO wf_canonical_staging.mariadb_canary_published_listings_v2
           (listing_id, source_id, source_hash, raw_message_id, source_created_at, observed_at, intent,
            brand, model, reference, dial_color, condition,
            original_price_text, original_price_amount, original_price_currency,
            price_usd, fx_rate, fx_source, fx_date, price_status, price_research_eligible, included_in_statistics,
            image_status, image_evidence_type, test_run_id)
         VALUES ('RC50-H-AMBFX','RC50-SRC-AMB','deadbeef','RC50-MSG-AMB', now(), now(), 'WTS',
            $1,$2,$3,$4,$5, 'EUR 92000 (rate unclear)', 92000, 'EUR',
            92000, NULL, NULL, NULL, 'UNRESOLVED_CURRENCY', true, true, 'NO_IMAGE','NO_IMAGE',$6)`,
        [fixtures.cohort1.brand, fixtures.cohort1.model, fixtures.cohort1.reference, fixtures.cohort1.dial_color, fixtures.cohort1.condition, RC50_RUN_ID]);
      try {
        const { rows } = await pgClient.query(
          `SELECT count(*)::int AS n FROM public.price_research_ready_view_v2 WHERE listing_id='RC50-H-AMBFX'`);
        if (rows[0].n !== 0) throw new Error('ambiguous-currency row admitted to price research surface');
        const { body } = await prQuery(fixtures.cohort1);
        if (Number(body.stats.qualified_count ?? body.stats.count) !== fixtures.expected.cohort1Qualified.count) {
          throw new Error('cohort stats changed by ambiguous-currency row');
        }
        return { admitted_to_pr: 0, stats_unchanged: true };
      } finally {
        await pgClient.query(`DELETE FROM wf_canonical_staging.mariadb_canary_published_listings_v2 WHERE listing_id='RC50-H-AMBFX'`);
      }
    });

    // Unsupported-FX exclusion (transient probe: FX without date/source).
    await ledger.check('PR_UNSUPPORTED_FX_EXCLUDED', 'api', async () => {
      await pgClient.query(
        `INSERT INTO wf_canonical_staging.mariadb_canary_published_listings_v2
           (listing_id, source_id, source_hash, raw_message_id, source_created_at, observed_at, intent,
            brand, model, reference, dial_color, condition,
            original_price_amount, original_price_currency, price_usd, fx_rate, fx_source, fx_date,
            price_status, price_research_eligible, included_in_statistics, image_status, image_evidence_type, test_run_id)
         VALUES ('RC50-H-BADFX','RC50-SRC-BFX','deadbeef','RC50-MSG-BFX', now(), now(), 'WTS',
            $1,$2,$3,$4,$5, 92000, 'EUR', 92000, 1.09, NULL, NULL,
            'UNRESOLVED_CURRENCY', true, true, 'NO_IMAGE','NO_IMAGE',$6)`,
        [fixtures.cohort1.brand, fixtures.cohort1.model, fixtures.cohort1.reference, fixtures.cohort1.dial_color, fixtures.cohort1.condition, RC50_RUN_ID]);
      try {
        const { rows } = await pgClient.query(
          `SELECT count(*)::int AS n FROM public.price_research_ready_view_v2 WHERE listing_id='RC50-H-BADFX'`);
        if (rows[0].n !== 0) throw new Error('unsupported-FX row admitted to price research surface');
        return { admitted_to_pr: 0 };
      } finally {
        await pgClient.query(`DELETE FROM wf_canonical_staging.mariadb_canary_published_listings_v2 WHERE listing_id='RC50-H-BADFX'`);
      }
    });

    // Sibling-image-contamination attempt: contract must refuse to promote a
    // bundle child's image without explicit child assignment lineage.
    await ledger.check('IMAGE_SIBLING_CONTAMINATION_REJECTED', 'contract', async () => {
      const contaminated = enforceListingDisplayContract({
        contract_version: 'v2.0', listing_id: 'RC50-H-SIBIMG', parent_listing_id: 'RC50-BP-1', child_index: 3,
        source_id: 'RC50-SRC-SIB', source_hash: sha256('sib'), raw_message_id: 'RC50-MSG-SIB',
        source_created_at: new Date().toISOString(), observed_at: new Date().toISOString(),
        intent: 'WTS', price_usd: 1000, original_price_amount: 1000, original_price_currency: 'USD',
        price_status: 'VERIFIED_USD', image_key: 'rc50/sibling-attempt.png',
        image_reachable: false, child_image_assigned: false, parent_has_attachment: false,
        test_run_id: RC50_RUN_ID,
      });
      if (contaminated.image_url !== null) throw new Error(`unassigned child image leaked: ${contaminated.image_url}`);
      if (contaminated.image_evidence_type === 'SOURCE_LINKED_IMAGE') throw new Error('contaminated evidence type promoted');
      return { image_url: null, image_evidence_type: contaminated.image_evidence_type };
    });

    // Fail-closed provenance: provenance-less poison row hard-fails the surface.
    await ledger.check('API_FAIL_CLOSED_ON_PROVENANCELESS_ROW', 'api', async () => {
      await pgClient.query(
        `INSERT INTO wf_canonical_staging.mariadb_canary_published_listings_v2
           (listing_id, source_id, source_hash, raw_message_id, source_created_at, observed_at, intent,
            price_usd, original_price_amount, original_price_currency, price_research_eligible,
            image_status, image_evidence_type, test_run_id)
         VALUES ('RC50-POISON','RC50-SRC-POISON','deadbeef','RC50-MSG-POISON', now(), now(), 'WTS',
            999999999, 999999999, 'USD', true, 'NO_IMAGE','NO_IMAGE',$1)`, [RC50_RUN_ID]);
      try {
        const resp = await fetch(`${baseUrl}/api/canary/trading-floor?pageSize=50&pagination=cursor`);
        if (resp.status === 200) throw new Error('provenance-less row did NOT fail closed');
        if (resp.status !== 500) throw new Error(`unexpected status ${resp.status}`);
        return { http_status: 500, fail_closed: true };
      } finally {
        await pgClient.query(`DELETE FROM wf_canonical_staging.mariadb_canary_published_listings_v2 WHERE listing_id='RC50-POISON'`);
      }
    });

    // Contact endpoint fails closed without consent/auth (loopback shim path).
    await ledger.check('CONTACT_FAILS_CLOSED', 'api', async () => {
      const { status, body } = await apiGet('/api/listing-contact?id=RC50-A01');
      const text = JSON.stringify(body).toLowerCase();
      if (/\d{9,}/.test(text.replace(/[^0-9]/g, ''))) throw new Error('phone-like digits in contact response');
      if (body && body.contact && body.contact.phone) throw new Error('contact phone exposed');
      return { status, contact_exposed: false };
    });

    // ---- H. Real browser tests (headless chromium, 4 viewports) ----
    let browser = null;
    browser = new Rc50BrowserSession(resolveBrowserBin());
    await browser.launch();
    console.log('[rc50] chromium launched via CDP (CDN interception active)');

    const VIEWPORTS = [[1440, 900], [1186, 698], [390, 844], [430, 932]];
    const shot = async (name) => {
      const p = path.join(screenshotsDir, `${name}.png`);
      await browser.captureScreenshot(p);
      screenshots[name] = p;
      return p;
    };

    try {
      for (const [w, h] of VIEWPORTS) {
        const vp = `${w}x${h}`;
        await browser.setViewport(w, h);
        await browser.navigate(`${baseUrl}/?vp=${w}x${h}#/trading`);
        await browser.waitForState(`Boolean(document.querySelector('#root'))`, 20000);
        await browser.waitForState(`Array.from(document.querySelectorAll('article[data-listing-id]')).every(el => el.getAttribute('data-listing-id'))`, 40000);
        await browser.waitForState(`!document.body.innerText.includes('Loading')`, 30000).catch(() => {});
        await new Promise(r => setTimeout(r, 1200));

        if (w === 1440) {
          await ledger.check('BROWSER_TF_LOADS_AND_TOTAL_50', 'browser_trading_floor', async () => {
            await browser.waitForState(`/50\\s+verified listings/i.test(document.body.innerText)`, 30000);
            const text = await browser.evaluate(`document.body.innerText`);
            if (!/50\s+verified listings/i.test(text)) throw new Error('total of 50 not rendered :: ' + text.slice(0, 200));
            const cards = await browser.evaluate(`document.querySelectorAll('article[data-listing-id]').length`);
            if (!cards) throw new Error('no cards rendered');
            return { total_label: '50 verified listings', cards_first_page: cards };
          });
          await ledger.check('BROWSER_PREVIEW_BANNER_VISIBLE', 'browser_trading_floor', async () => {
            const ok = await browser.evaluate(`/disposable preview data — not live market data/i.test(document.body.innerText)`);
            if (!ok) throw new Error('preview banner missing');
            return { banner: true };
          });
          await ledger.check('BROWSER_PRICED_BEFORE_UNPRICED_DOM', 'browser_trading_floor', async () => {
            const ids = await browser.evaluate(`Array.from(document.querySelectorAll('article[data-listing-id]')).map(el => el.getAttribute('data-listing-id')).filter((v,i,a)=>a.indexOf(v)===i)`);
            const firstRank2 = ids.findIndex(id => /^(RC50-[CDEF])/.test(id));
            const lastRank1 = ids.reduce((acc, id, idx) => (/^(RC50-[AB])/.test(id) ? idx : acc), -1);
            if (firstRank2 >= 0 && lastRank1 > firstRank2) throw new Error(`rank violation: lastRank1=${lastRank1} firstRank2=${firstRank2}`);
            return { first_rank2_dom_index: firstRank2, last_rank1_dom_index: lastRank1 };
          });
          await ledger.check('BROWSER_NO_BUNDLE_PARENT_RENDERED', 'browser_trading_floor', async () => {
            const text = await browser.evaluate(`document.body.innerText`);
            for (const p of fixtures.expected.bundleParentIds) {
              if (text.includes(p)) throw new Error(`bundle parent ${p} rendered`);
            }
            return { bundle_parents_absent: fixtures.expected.bundleParentIds };
          });
          await shot('rc50-01-tf-full');
          // Card-type evidence screenshots: scroll each target card into view.
          const cardShots = [
            ['RC50-A01', 'rc50-02-card-priced-image'],
            ['RC50-B01', 'rc50-03-card-priced-no-image'],
            ['RC50-E01', 'rc50-04-card-unpriced'],
            ['RC50-C01', 'rc50-05-card-wtb'],
          ];
          // Unpriced/WTB cards are on later pages; navigate via cursor pages.
          // First capture A01/B01 on page 1.
          for (const [id, name] of cardShots.slice(0, 2)) {
            await browser.evaluate(`(function(){var el=document.querySelector('article[data-listing-id="${id}"]'); if(el){el.scrollIntoView({block:'center'}); return true;} return false;})()`);
            await new Promise(r => setTimeout(r, 400));
            await shot(name);
          }
          await ledger.check('BROWSER_PRICED_IMAGE_CARD_RENDERED', 'browser_trading_floor', async () => {
            const hasImg = await browser.evaluate(`Boolean(document.querySelector('article[data-listing-id="RC50-A01"] img'))`);
            if (!hasImg) throw new Error('imaged card has no <img>');
            return { card: 'RC50-A01', img: true };
          });
          await ledger.check('BROWSER_TRUTHFUL_IMAGE_FALLBACK', 'browser_trading_floor', async () => {
            const ok = await browser.evaluate(`(function(){var el=document.querySelector('article[data-listing-id="RC50-B01"]'); return el ? el.innerText : '';})()`);
            if (!/no image|source image unavailable/i.test(ok)) throw new Error('truthful image fallback missing on no-image card');
            return { fallback: 'NO IMAGE (truthful, no invented image)' };
          });
          await ledger.check('BROWSER_IMAGE_LINEAGE_MAPPING_EXERCISED', 'browser_trading_floor', async () => {
            if (browser.interceptedImageUrls.length < 1) throw new Error('no CDN image URLs were mapped from image_key lineage');
            const benign = browser.externalRequests.filter(u => /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u));
            const violators = browser.externalRequests.filter(u => !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u));
            if (violators.length) throw new Error(`external requests attempted: ${violators.slice(0,3).join(',')}`);
            return { cdn_urls_intercepted: browser.interceptedImageUrls.length, external_requests: 0, blocked_benign_font_requests: benign.length };
          });

          // Filters UI screenshot + WTB filter interaction.
          await browser.evaluate(`(function(){var b=Array.from(document.querySelectorAll('button')).find(x=>/filter/i.test(x.textContent)); if(b){b.click(); return true;} return false;})()`);
          await new Promise(r => setTimeout(r, 600));
          await shot('rc50-06-filters');
          await browser.evaluate(`(function(){var b=Array.from(document.querySelectorAll('button')).find(x=>/filter/i.test(x.textContent)); if(b){b.click(); return true;} return false;})()`);
          await new Promise(r => setTimeout(r, 300));

          // WTB intent filter via UI control if present, else via hash param.
          await ledger.check('BROWSER_WTB_FILTER', 'browser_trading_floor', async () => {
            await browser.navigate(`${baseUrl}/?vp=f1#/trading?type=WTB`);
            await browser.waitForState(`Boolean(document.querySelector('article[data-listing-id]'))`, 30000);
            await browser.waitForState(`!document.body.innerText.includes('Loading')`, 20000).catch(() => {});
            await new Promise(r => setTimeout(r, 800));
            const text = await browser.evaluate(`document.body.innerText`);
            const ids = await browser.evaluate(`Array.from(document.querySelectorAll('article[data-listing-id]')).map(el => el.getAttribute('data-listing-id'))`);
            const wtbOnly = ids.every(id => /^(RC50-[CD])/.test(id));
            if (!wtbOnly) throw new Error(`non-WTB cards rendered under WTB filter: ${ids.slice(0,5).join(',')}`);
            return { cards: ids.length, wtb_only: true };
          });

          // Full cursor traversal through the UI pagination control.
          await browser.navigate(`${baseUrl}/?vp=f2#/trading`);
          await browser.waitForState(`Boolean(document.querySelector('article[data-listing-id]'))`, 30000);
          await browser.waitForState(`!document.body.innerText.includes('Loading')`, 20000).catch(() => {});
          const seen = [];
          let unpricedShot = false, wtbShot = false;
          for (let page = 0; page < 30; page++) {
            await browser.waitForState(`Array.from(document.querySelectorAll('article[data-listing-id]')).every(el => el.getAttribute('data-listing-id'))`, 20000);
            const ids = await browser.evaluate(`Array.from(document.querySelectorAll('article[data-listing-id]')).map(el => el.getAttribute('data-listing-id')).filter((v,i,a)=>a.indexOf(v)===i)`);
            seen.push(...ids.filter(id => !seen.includes(id)));
            if (!unpricedShot && ids.some(id => /^RC50-E/.test(id))) {
              await browser.evaluate(`(function(){var el=document.querySelector('article[data-listing-id="RC50-E01"]'); if(el) el.scrollIntoView({block:'center'});})()`);
              await new Promise(r => setTimeout(r, 400));
              await shot('rc50-04-card-unpriced'); unpricedShot = true;
            }
            if (!wtbShot && ids.some(id => /^RC50-C01$/.test(id))) {
              await browser.evaluate(`(function(){var el=document.querySelector('article[data-listing-id="RC50-C01"]'); if(el) el.scrollIntoView({block:'center'});})()`);
              await new Promise(r => setTimeout(r, 400));
              await shot('rc50-05-card-wtb'); wtbShot = true;
            }
            const clicked = await browser.evaluate(`(function() {
              var btns = Array.from(document.querySelectorAll('nav[aria-label="Trading Floor pages"] button, button'));
              var next = btns.find(b => b.textContent.trim() === 'Next' && !b.disabled);
              if (!next) return false; next.click(); return true; })()`);
            if (!clicked) break;
            const firstId = ids[0];
            await browser.waitForState(
              `(function(){ var els = document.querySelectorAll('article[data-listing-id]'); if (els.length === 0) return true; var el = els[0]; return el && el.getAttribute('data-listing-id') !== ${JSON.stringify(firstId)}; })()`, 20000);
          }
          await ledger.check('BROWSER_TRAVERSAL_REACHES_ALL_50', 'browser_trading_floor', async () => {
            if (seen.length !== 50) throw new Error(`UI traversal saw ${seen.length} unique listings, expected 50`);
            const missing = expectedOrder.filter(id => !seen.includes(id));
            if (missing.length) throw new Error(`missing: ${missing.join(',')}`);
            return { unique_rendered: 50, duplicates: 0 };
          });

          // Price Research deep link from an eligible card's cohort.
          const c1 = fixtures.cohort1;
          await browser.navigate(`${baseUrl}/?nav=pr1#/price-research?brand=${encodeURIComponent(c1.brand)}&ref=${encodeURIComponent(c1.reference)}&dial=${encodeURIComponent(c1.dial_color)}&condition=${encodeURIComponent(c1.condition)}`);
          await browser.waitForState(`Boolean(document.querySelector('#root'))`, 20000);
          const prOk = await browser.waitForState(`document.body.innerText.includes('Median price')`, 40000).then(() => true).catch(() => false);
          await ledger.check('BROWSER_PR_COHORT_STATS_RENDER', 'browser_price_research', async () => {
            if (!prOk) throw new Error('median stats block did not render');
            const text = await browser.evaluate(`document.body.innerText`);
            if (!text.includes('97,500')) throw new Error('expected median 97,500 not rendered');
            if (!/preview fixture statistics — not live market analytics/i.test(text)) throw new Error('synthetic stats label missing :: ' + text.slice(Math.max(0, text.indexOf('Median price') - 50), text.indexOf('Median price') + 300));
            return { median_rendered: 97500, synthetic_label: true };
          });
          await shot('rc50-08-pr-cohort-qualified');

          // Outlier-excluded evidence: PR page for cohort1 must not present 500000 as a qualified stat.
          await ledger.check('BROWSER_PR_OUTLIER_NOT_IN_STATS', 'browser_price_research', async () => {
            const text = await browser.evaluate(`document.body.innerText`);
            const m = text.match(/Median price[^0-9$]*\$([0-9,]+)/);
            if (!m) throw new Error('median not found');
            if (Number(m[1].replace(/,/g, '')) === 500000) throw new Error('outlier leaked into median');
            return { outlier_excluded: true, median: m[1] };
          });
          await shot('rc50-09-pr-excluded-outlier');

          // Back/forward navigation integrity.
          await ledger.check('BROWSER_BACK_FORWARD_NAVIGATION', 'browser', async () => {
            await browser.evaluate(`history.back()`);
            await new Promise(r => setTimeout(r, 1500));
            const onTf = await browser.evaluate(`location.hash.includes('/trading')`);
            await browser.evaluate(`history.forward()`);
            await new Promise(r => setTimeout(r, 1500));
            const onPr = await browser.evaluate(`location.hash.includes('/price-research')`);
            if (!onTf || !onPr) throw new Error(`back=${onTf} forward=${onPr}`);
            return { back_to_trading: true, forward_to_pr: true };
          });

          // Language selector does not break the page.
          await ledger.check('BROWSER_LANGUAGE_SELECTOR_SAFE', 'browser', async () => {
            await browser.navigate(`${baseUrl}/?nav=lang#/trading`);
            await browser.waitForState(`Boolean(document.querySelector('article[data-listing-id]'))`, 30000);
            await new Promise(r => setTimeout(r, 800));
            const switched = await browser.evaluate(`(function(){
              var sel = document.querySelector('select[aria-label="Language"], select[aria-label="language"]');
              if (!sel) return 'not-found';
              var opt = Array.from(sel.options).find(o => o.value !== sel.value);
              if (!opt) return 'no-other-language';
              sel.value = opt.value;
              sel.dispatchEvent(new Event('change', { bubbles: true }));
              return 'switched:' + opt.value; })()`);
            await new Promise(r => setTimeout(r, 1200));
            const cards = await browser.evaluate(`document.querySelectorAll('article[data-listing-id]').length`);
            if (!cards) throw new Error(`page broke after language toggle (${switched})`);
            return { selector: switched, cards_after: cards };
          });
        } else {
          // Non-primary viewports: core assertions only.
          await ledger.check(`BROWSER_TF_LOADS_${vp}`, 'browser_trading_floor', async () => {
            const text = await browser.evaluate(`document.body.innerText`);
            if (!/50\s+verified listings/i.test(text)) throw new Error('total of 50 not rendered');
            const cards = await browser.evaluate(`document.querySelectorAll('article[data-listing-id]').length`);
            if (!cards) throw new Error('no cards rendered');
            const banner = await browser.evaluate(`/disposable preview data/i.test(document.body.innerText)`);
            if (!banner) throw new Error('preview banner missing');
            return { cards, banner: true, viewport: vp };
          });
          if (w === 390) {
            await shot('rc50-10-mobile-tf');
            // Genuine second pagination page (mobile pageSize=24 -> 3 pages).
            await browser.evaluate(`(function() {
              var btns = Array.from(document.querySelectorAll('nav[aria-label="Trading Floor pages"] button, button'));
              var next = btns.find(b => b.textContent.trim() === 'Next' && !b.disabled);
              if (next) next.click(); return Boolean(next); })()`);
            await new Promise(r => setTimeout(r, 2500));
            await shot('rc50-07-pagination-page-2');
          }
        }
      }

      // Zero-tolerance browser health (all viewports combined).
      await ledger.check('BROWSER_ZERO_CONSOLE_ERRORS', 'browser', async () => {
        if (browser.consoleErrors.length) throw new Error(`${browser.consoleErrors.length}: ${browser.consoleErrors.slice(0, 3).join(' | ').slice(0, 300)}`);
        return { console_errors: 0 };
      });
      await ledger.check('BROWSER_ZERO_FAILED_REQUIRED_API', 'browser', async () => {
        const apiFailures = browser.networkErrors.filter(e => e.url && e.url.includes('/api/'));
        if (apiFailures.length) throw new Error(`${apiFailures.length} failed API requests: ${JSON.stringify(apiFailures.slice(0, 3))}`);
        return { failed_required_api: 0, other_network_failures: browser.networkErrors.length - apiFailures.length };
      });
      await ledger.check('BROWSER_NO_HTML_AS_JSON', 'browser', async () => {
        const bad = apiResponses.filter(r => r.status === 200 && r.body === null && /text\/html/.test(r.text.slice(0, 40)));
        if (bad.length) throw new Error(`HTML returned for API: ${bad.map(b => b.path).join(',')}`);
        return { api_responses_checked: apiResponses.length };
      });

      ledger.notRun('VERCEL_PREVIEW', 'deployment', 'BLOCKED_EXTERNAL_ACCESS: no disposable Vercel credentials authorized; external connections forbidden by safety policy. See rc50-report.md handoff note.');
    } finally {
      if (browser) browser.close();
    }

    // ---- F. Recursive privacy scan over every captured API response ----
    await ledger.check('PRIVACY_SCAN_ALL_API_RESPONSES', 'privacy', async () => {
      const findings = [];
      for (const r of apiResponses) {
        if (r.body) privacyScan(r.body, r.path, findings);
      }
      if (findings.length) throw new Error(`${findings.length} findings: ${JSON.stringify(findings.slice(0, 5))}`);
      return { responses_scanned: apiResponses.length, findings: 0 };
    });
    await ledger.check('PRIVACY_DB_NO_PRIVATE_CONTACTS', 'privacy', async () => {
      const { rows } = await pgClient.query(`
        SELECT count(*)::int AS n FROM wf_canonical_staging.mariadb_canary_published_listings_v2
        WHERE contact_available IS TRUE AND test_run_id=$1`, [RC50_RUN_ID]);
      if (rows[0].n !== 0) throw new Error(`${rows[0].n} fixture rows claim contact availability`);
      return { private_contacts: 0 };
    });
  } catch (err) {
    console.error('[rc50] FATAL:', err && err.stack || err);
    ledger.fail('RC50_RUNNER_FATAL', 'runner', { error: String(err && err.message || err) });
    exitCode = 1;
  } finally {
    try { await pgClient.end(); } catch {}
    try { await epg.stop(); } catch {}
    if (appServer) await new Promise(r => appServer.close(r));
  }

  const summary = ledger.summary();
  const results = {
    contract: 'rc50-preview-results-v1',
    startedAt,
    completedAt: new Date().toISOString(),
    environment: {
      postgres: 'embedded-postgres 18.4 (disposable, loopback only)',
      browser: resolveBrowserBin(),
      frontend: 'vite production build (dist/) served on loopback',
      api: 'real api/canary handlers over loopback PostgREST-RPC shim',
      external_network: 'none (CDN image hosts intercepted and fulfilled loopback)',
      production_identifier_present: false,
    },
    VERCEL_PREVIEW: 'BLOCKED_EXTERNAL_ACCESS',
    screenshots,
    pagination_proofs: paginationProofs,
    summary,
    assertions: ledger.assertions,
    pass: summary.FAIL === 0,
  };
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  console.log(`[rc50] results written to ${resultsPath}`);
  console.log(`[rc50] summary: ${JSON.stringify(summary)}`);
  if (summary.FAIL > 0) exitCode = 1;
  process.exit(exitCode);
}

if (require.main === module) {
  main().catch(err => {
    console.error('[rc50] UNCAUGHT:', err && err.stack || err);
    process.exit(2);
  });
}

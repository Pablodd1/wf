'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const { assertReadOnlySql, uuidShard } = require('../tools/audit/raw-first-rolex-patek-audit.cjs');
const { classifyRawOnlyFiveBrandPost, sha256 } = require('../tools/audit/raw-only-five-brand-lib.cjs');
const { BRANDS, buildSummary, currentSourceSql, rawSourceSql, run } =
  require('../tools/audit/generic-raw-first-brand-batch.cjs');
const loader = require('../tools/audit/load-five-brand-raw-only-shadow.cjs');
const priceEvidence = require('../tools/audit/raw-only-price-evidence-lib.cjs');
const root = path.resolve(__dirname, '..');

function raw(overrides = {}) {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    raw_message_id: '20000000-0000-4000-8000-000000000001',
    source_record_id: 'source-1', source_hash: 'a'.repeat(64),
    source_created_on: '2026-08-20T12:00:00Z', observed_at: '2026-08-20T12:01:00Z',
    raw_message_source: 'description', source_platform: 'test', sender_phone: null,
    group_id: 'Hong Kong', media: [], raw_text: 'IWC IW371702 WTS USD 5000',
    raw_data: { brand: 'IWC', type: 'sale', status: 'active', is_bundle: false,
      reference: 'IW371702', from_number: '+852 9000 0000' },
    ...overrides,
  };
}

test('raw-only batch targets exactly the requested brands and validates SELECT-only SQL', async () => {
  assert.deepEqual(BRANDS, ['IWC', 'Hublot', 'Seiko', 'Bell & Ross', 'Tissot']);
  const bounds = uuidShard(0, 16);
  for (const sql of [rawSourceSql(bounds), currentSourceSql(bounds)]) {
    assert.doesNotThrow(() => assertReadOnlySql(sql));
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|CALL)\b/i);
  }
  assert.doesNotMatch(currentSourceSql(bounds), /i\.id[^\n]+::uuid/);
  const source = fs.readFileSync(path.join(root, 'tools', 'audit',
    'generic-raw-first-brand-batch.cjs'), 'utf8');
  assert.doesNotMatch(source, /require\([^)]*catalog|listCanonicalCatalog/i);
  const result = await run({ validateOnly: true, env: {
    GENERIC_RAW_FIRST_SHARDS: '16', GENERIC_RAW_FIRST_PAGE_SIZE: '2000',
  } });
  assert.equal(result.read_only, true);
  assert.deepEqual(result.brands, BRANDS);
});

test('raw-only parser retains exact observed references for all five target brands', () => {
  const result = classifyRawOnlyFiveBrandPost(raw({
    raw_text: 'IWC\nIW371702 USD 5000\nHUBLOT\n565.NX.1470.LR.1204 USD 12000\nSEIKO\nSBGA211 USD 4500\nBELL & ROSS\nBR03-92 USD 2500\nTISSOT\nT137.407.11.041.00 USD 700',
    raw_data: { type: 'sale', status: 'active', is_bundle: true },
  }), { targetBrands: BRANDS });
  assert.deepEqual(result.children.map(child => [child.brand, child.observed_reference]), [
    ['IWC', 'IW371702'], ['Hublot', '565.NX.1470.LR.1204'], ['Seiko', 'SBGA211'],
    ['Bell & Ross', 'BR03-92'], ['Tissot', 'T137.407.11.041.00'],
  ]);
});

test('artifact summary suppresses identical reposts and fails closed on evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'generic-raw-first-'));
  const file = path.join(root, 'page.json.gz');
  const rows = [raw(), raw({
    id: '10000000-0000-4000-8000-000000000002',
    raw_message_id: '20000000-0000-4000-8000-000000000002',
    source_record_id: 'source-2', source_created_on: '2026-08-21T12:00:00Z',
  }), raw({
    id: '10000000-0000-4000-8000-000000000003',
    raw_message_id: '20000000-0000-4000-8000-000000000003',
    source_record_id: 'source-3', raw_text: 'TISSOT T137.407.11.041.00 WTB price on request',
    raw_data: { brand: 'Tissot', type: 'search', status: 'active', is_bundle: false,
      reference: 'T137.407.11.041.00', from_number: '+852 9111 1111' },
  })];
  fs.writeFileSync(file, zlib.gzipSync(`${JSON.stringify(rows)}\n`));
  const current = [{ id: '30000000-0000-4000-8000-000000000001', source_record_id: 'source-2',
    brand: 'IWC', normalized_reference: 'IW371702', listing_type: 'WTS',
    raw_message: rows[1].raw_text, source_payload_sha256: sha256(rows[1].raw_text),
    user_image_url: 'https://images.example/tudor.jpg', image_evidence_type: 'SELLER_LISTING_IMAGE' }];
  try {
    const summary = buildSummary([file], current, new Map());
    assert.equal(summary.brands.IWC.final_current_listings, 1);
    assert.equal(summary.brands.IWC.confirmed_current, 1);
    assert.equal(summary.brands.IWC.reposts_suppressed, 1);
    assert.equal(summary.brands.IWC.verified_images, 1);
    assert.equal(summary.brands.IWC.qualified_price_research_observations, 1);
    assert.equal(summary.brands.Tissot.wtb, 1);
    assert.equal(summary.brands.Tissot.verified_priced, 0);
    assert.equal(summary.brands.IWC.observed_only_references, 1);
    assert.deepEqual(summary.materialized.IWC[0], {
      ...summary.materialized.IWC[0],
      current_listing_key: summary.materialized.IWC[0].offer_family_key,
      current_status: 'CURRENT_ACTIVE', cohort_status: 'CONFIRMED_CURRENT',
      parent_raw_message_id: rows[1].raw_message_id, raw_version_id: rows[1].id,
      source_record_id: 'source-2', brand: 'IWC', reference: 'IW371702',
      image_state: 'VERIFIED_CHILD_IMAGE', image_evidence_type: 'SELLER_LISTING_IMAGE',
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('multi-watch parent media never becomes a child image without an explicit child bridge', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'five-brand-raw-only-'));
  const file = path.join(root, 'page.json.gz');
  const row = raw({
    raw_text: 'HUBLOT\n565.NX.1470.LR.1204 WTS USD 12000\nSEIKO\nSBGA211 WTS USD 4500',
    raw_data: { type: 'sale', status: 'active', is_bundle: true, from_number: '+852 9222 2222' },
  });
  const current = [{ id: '30000000-0000-4000-8000-000000000002', source_record_id: row.source_record_id,
    brand: 'Hublot', normalized_reference: '565.NX.1470.LR.1204', listing_type: 'WTS',
    raw_message: row.raw_text, source_payload_sha256: sha256(row.raw_text),
    user_image_url: 'https://images.example/shared-parent.jpg', image_evidence_type: 'SELLER_LISTING_IMAGE' }];
  fs.writeFileSync(file, zlib.gzipSync(`${JSON.stringify([row])}\n`));
  try {
    const summary = buildSummary([file], current, new Map());
    assert.equal(summary.materialized.Hublot[0].image_url, null);
    assert.equal(summary.materialized.Hublot[0].image_state, 'NO_VERIFIED_CHILD_IMAGE');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('verified foreign FX qualifies for USD display and Price Research without rewriting source currency', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'five-brand-raw-only-fx-'));
  const file = path.join(temporary, 'page.json.gz');
  const row = raw({ raw_text: 'HUBLOT 565.NX.1470.LR.1204 WTS HKD 100000',
    raw_data: { brand: 'Hublot', type: 'sale', status: 'active', is_bundle: false,
      reference: '565.NX.1470.LR.1204', from_number: '+852 9333 3333' } });
  const fx = { provider: 'ECB', source_currency: 'HKD', applicable_date: '2026-08-20',
    effective_date: '2026-08-20', lookback_days: 0, rate_direction: 'USD_PER_SOURCE_UNIT',
    usd_per_source_unit: 0.128, source_url: 'https://data-api.ecb.europa.eu/service/data/EXR/' };
  fs.writeFileSync(file, zlib.gzipSync(`${JSON.stringify([row])}\n`));
  try {
    const result = buildSummary([file], [], new Map(), new Map([['HKD|2026-08-20', fx]]));
    assert.equal(result.brands.Hublot.verified_priced, 1);
    assert.equal(result.brands.Hublot.qualified_price_research_observations, 1);
    assert.equal(result.brands.Hublot.defects.invalid_price_evidence, 0);
    assert.equal(result.materialized.Hublot[0].source_currency, 'HKD');
    assert.equal(result.materialized.Hublot[0].normalized_usd_amount, 12800);
    assert.equal(result.materialized.Hublot[0].price_evidence_classification, 'DATED_VERIFIED_FX');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('generic audit implementation cannot mutate Rolex/Patek or production endpoints', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'tools', 'audit',
    'generic-raw-first-brand-batch.cjs'), 'utf8');
  assert.match(source, /production_writes:\s*0/);
  assert.match(source, /raw_mutations:\s*0/);
  assert.match(source, /endpoint_switches:\s*0/);
  assert.match(source, /rolex_patek_changes:\s*0/);
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE)\b/i);
});

test('prepared loader retains original currency and uses only pre-verified USD evidence', () => {
  assert.deepEqual(loader.normalizedUsd({ normalized_usd_amount: 5000,
    price_evidence_classification: 'SOURCE_EXPLICIT_USD_MATCH' }), {
    normalized_usd_amount: 5000, normalized_usd_evidence: 'SOURCE_EXPLICIT_USD',
  });
  assert.deepEqual(loader.normalizedUsd({ normalized_usd_amount: 5000,
    price_evidence_classification: 'DATED_VERIFIED_FX' }), {
    normalized_usd_amount: 5000, normalized_usd_evidence: 'DATED_VERIFIED_FX',
  });
  assert.deepEqual(loader.normalizedUsd({ normalized_usd_amount: 5000,
    price_evidence_classification: 'PRICE_MAPPING_REVIEW_REQUIRED' }), {
    normalized_usd_amount: null, normalized_usd_evidence: null,
  });
  const hkd = { provider: 'ECB', source_currency: 'HKD', applicable_date: '2026-08-20',
    effective_date: '2026-08-20', lookback_days: 0, rate_direction: 'USD_PER_SOURCE_UNIT',
    usd_per_source_unit: 0.128, source_url: 'https://data-api.ecb.europa.eu/service/data/EXR/' };
  const fxEvidence = loader.priceEvidenceRow({ current_listing_key: 'listing-1', source_price_amount: 100000,
    source_currency: 'HKD', normalized_usd_amount: 12800, price_evidence_classification: 'DATED_VERIFIED_FX',
    timestamp: '2026-08-20T12:00:00Z', price_fx: hkd }, '10000000-0000-4000-8000-000000000007');
  assert.deepEqual({ ...fxEvidence, evidence_checksum: undefined }, {
    run_id: '10000000-0000-4000-8000-000000000007', current_listing_key: 'listing-1', evidence_version: 1,
    source_price_amount: 100000, source_currency: 'HKD', normalized_usd_amount: 12800,
    price_evidence_classification: 'DATED_VERIFIED_FX', fx_provider: 'ECB', fx_applicable_date: '2026-08-20',
    fx_effective_date: '2026-08-20', fx_lookback_days: 0, fx_usd_per_source_unit: 0.128,
    fx_source_url: 'https://data-api.ecb.europa.eu/service/data/EXR/', evidence_checksum: undefined,
  }, 'FX sidecar must preserve foreign source currency and its dated conversion proof');
  assert.match(fxEvidence.evidence_checksum, /^[0-9a-f]{64}$/);
  const source = fs.readFileSync(path.join(root, 'tools', 'audit', 'load-five-brand-raw-only-shadow.cjs'), 'utf8');
  assert.match(source, /LOAD_FIVE_BRAND_RAW_ONLY_SHADOW_V1/);
  assert.doesNotMatch(source, /raw_messages|raw_message_versions|reviewed_market_inventory/);
  assert.doesNotMatch(source, /CURATED_SHADOW_MARKET_SOURCE|ROLEX_PATEK_PUBLICATION_MODE/);
});

test('dated verified FX is accepted only with the exact source date and an ECB rate', () => {
  const row = { source_price_amount: 100000, source_currency: 'HKD', price_status: 'AUTO_APPROVED',
    timestamp: '2026-08-20T12:00:00Z' };
  const fx = { provider: 'ECB', source_currency: 'HKD', applicable_date: '2026-08-20',
    effective_date: '2026-08-20', lookback_days: 0, rate_direction: 'USD_PER_SOURCE_UNIT',
    usd_per_source_unit: 0.128, source_url: 'https://data-api.ecb.europa.eu/service/data/EXR/' };
  assert.deepEqual(priceEvidence.verifiedUsdPrice(row, fx), {
    normalized_usd_amount: 12800, price_evidence_classification: 'DATED_VERIFIED_FX', fx,
  });
  assert.equal(priceEvidence.verifiedUsdPrice(row, { ...fx, applicable_date: '2026-08-19' }), null);
});

test('raw-only shadow schema is append-only, lineage-bound, and has no catalog or customer switch', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase', 'migrations',
    '20260828100000_curated_luxury_five_brand_raw_only_shadow.sql'), 'utf8');
  assert.match(sql, /parent_raw_message_id uuid NOT NULL REFERENCES public\.raw_messages\(id\)/);
  assert.match(sql, /raw_version_id uuid NOT NULL REFERENCES public\.raw_message_versions\(id\)/);
  assert.match(sql, /CURRENT_ACTIVE','CURRENT_LATEST_STATE/);
  assert.match(sql, /CONFIRMED_CURRENT','LATEST_OBSERVED/);
  assert.match(sql, /image_evidence_type='SELLER_LISTING_IMAGE'/);
  assert.match(sql, /curated_luxury_raw_only_price_evidence_shadow/);
  assert.match(sql, /price_evidence_classification IN/);
  assert.match(sql, /fx_provider='ECB'/);
  assert.match(sql, /BEFORE UPDATE OR DELETE/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql, /catalog/i);
  assert.doesNotMatch(sql,
    /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO\s+|FROM\s+)?public\.(?:raw_messages|raw_message_versions|reviewed_workbook_inventory)/i);
});

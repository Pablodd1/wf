'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const { assertReadOnlySql, uuidShard } = require('../tools/audit/raw-first-rolex-patek-audit.cjs');
const { classifyRawPostGeneric, sha256 } = require('../tools/audit/raw-first-rolex-patek-lib.cjs');
const { BRANDS, buildSummary, currentSourceSql, rawSourceSql, run } =
  require('../tools/audit/generic-raw-first-brand-batch.cjs');

function raw(overrides = {}) {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    raw_message_id: '20000000-0000-4000-8000-000000000001',
    source_record_id: 'source-1', source_hash: 'a'.repeat(64),
    source_created_on: '2026-08-20T12:00:00Z', observed_at: '2026-08-20T12:01:00Z',
    raw_message_source: 'description', source_platform: 'test', sender_phone: null,
    group_id: 'Hong Kong', media: [], raw_text: 'TUDOR M79360N-0001 WTS USD 5000',
    raw_data: { brand: 'Tudor', type: 'sale', status: 'active', is_bundle: false,
      reference: 'M79360N-0001', from_number: '+852 9000 0000' },
    ...overrides,
  };
}

test('generic batch targets exactly the requested brands and validates SELECT-only SQL', async () => {
  assert.deepEqual(BRANDS, ['Tudor', 'Zenith', 'Cartier', 'TAG Heuer']);
  const bounds = uuidShard(0, 16);
  for (const sql of [rawSourceSql(bounds), currentSourceSql(bounds)]) {
    assert.doesNotThrow(() => assertReadOnlySql(sql));
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|CALL)\b/i);
  }
  assert.doesNotMatch(currentSourceSql(bounds), /i\.id[^\n]+::uuid/);
  const result = await run({ validateOnly: true, env: {
    GENERIC_RAW_FIRST_SHARDS: '16', GENERIC_RAW_FIRST_PAGE_SIZE: '2000',
  } });
  assert.equal(result.read_only, true);
  assert.deepEqual(result.brands, BRANDS);
});

test('shared generic boundaries preserve Zenith and TAG Heuer exact references', () => {
  const result = classifyRawPostGeneric(raw({
    raw_text: 'ROLEX\n116500LN USD 25000\nZENITH\n03.3100.3600/69.M3100 USD 9000\nTAG HEUER\nCBN2A1A.BA0643 USD 4500',
    raw_data: { type: 'sale', status: 'active', is_bundle: true },
  }), { targetBrands: BRANDS });
  assert.deepEqual(result.children.map(child => [child.brand, child.observed_reference]), [
    ['Zenith', '03.3100.3600/69.M3100'], ['TAG Heuer', 'CBN2A1A.BA0643'],
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
    source_record_id: 'source-3', raw_text: 'CARTIER WSSA0018 WTB price on request',
    raw_data: { brand: 'Cartier', type: 'search', status: 'active', is_bundle: false,
      reference: 'WSSA0018', from_number: '+852 9111 1111' },
  })];
  fs.writeFileSync(file, zlib.gzipSync(`${JSON.stringify(rows)}\n`));
  const current = [{ id: '30000000-0000-4000-8000-000000000001', source_record_id: 'source-2',
    brand: 'Tudor', normalized_reference: 'M79360N-0001', listing_type: 'WTS',
    raw_message: rows[1].raw_text, source_payload_sha256: sha256(rows[1].raw_text),
    user_image_url: 'https://images.example/tudor.jpg', image_evidence_type: 'SELLER_LISTING_IMAGE' }];
  try {
    const summary = buildSummary([file], current, new Map(), new Map(BRANDS.map(brand => [brand, new Set()])));
    assert.equal(summary.brands.Tudor.final_current_listings, 1);
    assert.equal(summary.brands.Tudor.confirmed_current, 1);
    assert.equal(summary.brands.Tudor.reposts_suppressed, 1);
    assert.equal(summary.brands.Tudor.verified_images, 1);
    assert.equal(summary.brands.Tudor.qualified_price_research_observations, 1);
    assert.equal(summary.brands.Cartier.wtb, 1);
    assert.equal(summary.brands.Cartier.verified_priced, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
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

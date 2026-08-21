'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildManifest,
  crawlBrand,
  proposalsForRecord,
} = require('../tools/audit/generate-tudor-omega-missing-field-manifest.cjs');

function row(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    source_record_id: 'source-1',
    brand: 'Omega',
    model: 'Omega',
    reference: '220.10.41.21.01.002',
    dial_color: null,
    condition: null,
    listing_type: 'WTS',
    price_raw: null,
    price_usd: null,
    raw_message: 'Omega Seamaster 220.10.41.21.01.002 black dial BNIB USD 5,100',
    ...overrides,
  };
}

test('proposes only currently missing fields with exact raw evidence and hashes', () => {
  const { proposals } = proposalsForRecord(row());
  assert.deepEqual(proposals.map(item => [item.field, item.proposed_value]), [
    ['model', 'Seamaster'],
    ['dial_color', 'Black'],
    ['condition', 'New'],
    ['price_usd', 5100],
  ]);
  assert.ok(proposals.every(item => item.current_value === null));
  assert.ok(proposals.every(item => /^[0-9a-f]{64}$/.test(item.raw_message_sha256)));
  assert.ok(proposals.every(item => item.evidence_quote.length > 0));
});

test('never overwrites a confirmed field', () => {
  const { proposals } = proposalsForRecord(row({
    model: 'Speedmaster', dial_color: 'Blue', condition: 'Used', price_usd: 7000,
  }));
  assert.deepEqual(proposals, []);
});

test('recovers one exact Omega reference only when the current reference is blank', () => {
  const { proposals } = proposalsForRecord(row({
    reference: null,
    raw_message: 'Omega Seamaster Professional Ref. 2221.80.00 blue dial',
  }));
  assert.equal(proposals.find(item => item.field === 'reference').proposed_value, '2221.80.00');
});

test('blocks the known explicit USD shape when another Omega reference conflicts with identity', () => {
  const { proposals, blocked } = proposalsForRecord(row({
    reference: '87351',
    raw_message: 'Omega 3210.50.00 Speedmaster, USD 2,050 (#87351)',
  }));
  assert.equal(proposals.some(item => item.field === 'price_usd'), false);
  assert.equal(blocked.some(item => item.reason === 'REFERENCE_IDENTITY_CONFLICT'), true);
});

test('owner-assumed USD requires one dollar amount without foreign currency or retail context', () => {
  const clean = proposalsForRecord(row({ raw_message: 'Omega Seamaster 220.10.41.21.01.002 $5,100' }));
  const proposedPrice = clean.proposals.find(item => item.field === 'price_usd');
  assert.equal(proposedPrice.rule, 'OWNER_ASSUMED_USD_SINGLE_DOLLAR_V1');
  assert.equal(proposedPrice.price_evidence_status, 'OWNER_ASSUMED_USD');
  assert.equal(proposedPrice.analytics_admission, 'TRACKED_ONLY_NOT_INDEPENDENTLY_QUALIFIED');

  for (const raw_message of [
    'Omega Seamaster $5,100 MSRP $7,000',
    'Omega Seamaster $5,100 HKD 40,000',
    'Omega Seamaster MSRP 7,000, now $5,100',
  ]) {
    const result = proposalsForRecord(row({ raw_message }));
    assert.equal(result.proposals.some(item => item.field === 'price_usd'), false);
  }
});

test('multiple model families and repeated offer amounts remain blocked', () => {
  const result = proposalsForRecord(row({
    model: 'Omega',
    raw_message: 'Omega Seamaster and Speedmaster comparison USD 5,100 / USD 5,100',
  }));
  assert.equal(result.proposals.some(item => item.field === 'model'), false);
  assert.equal(result.proposals.some(item => item.field === 'price_usd'), false);
  assert.ok(result.blocked.some(item => item.reason === 'MULTIPLE_MODEL_FAMILIES_IN_RAW'));
  assert.ok(result.blocked.some(item => item.reason === 'MULTIPLE_EXPLICIT_USD_AMOUNTS'));
});

test('used accessory text does not create a used-watch condition', () => {
  const result = proposalsForRecord(row({
    condition: null,
    raw_message: 'Omega Seamaster 220.10.41.21.01.002 used strap USD 5,100',
  }));
  assert.equal(result.proposals.some(item => item.field === 'condition'), false);
});

test('Tudor proposals are missing-only and do not invent media or dealers', () => {
  const { proposals } = proposalsForRecord(row({
    brand: 'Tudor',
    model: 'Reference-only listings',
    reference: '79310N',
    raw_message: 'Tudor Black Bay Chronograph 79310N Yellow dial BNIB $9,950',
  }));
  assert.deepEqual(proposals.map(item => item.field), ['model', 'dial_color', 'condition', 'price_usd']);
  assert.equal(proposals.some(item => /image|dealer/i.test(item.field)), false);
});

test('manifest reconciles unique IDs and rejects duplicate input rows', () => {
  const first = row();
  const second = row({ id: '22222222-2222-4222-8222-222222222222', brand: 'Tudor',
    model: 'Black Bay', raw_message: 'Tudor Black Bay 79310N', reference: '79310N' });
  const manifest = buildManifest([first, second]);
  assert.equal(manifest.input_unique_listings, 2);
  assert.equal(manifest.writes, 0);
  assert.throws(() => buildManifest([first, first]), /Duplicate listing ID/);
});

test('public crawl is paginated and reconciles the exact endpoint total', async () => {
  const pages = [
    { total: 2, records: [row()], hasMore: true, nextCursor: 'cursor-2' },
    { total: 2, records: [row({ id: '22222222-2222-4222-8222-222222222222' })], hasMore: false },
  ];
  const seen = [];
  const records = await crawlBrand('https://example.test', 'Omega', async url => {
    seen.push(String(url));
    return { ok: true, json: async () => pages.shift() };
  });
  assert.equal(records.length, 2);
  assert.match(seen[0], /brand=Omega/);
  assert.match(seen[0], /pagination=cursor/);
  assert.match(seen[1], /cursor=cursor-2/);
});

test('public crawl retries transient server failures without advancing the cursor', async () => {
  let attempts = 0;
  const records = await crawlBrand('https://example.test', 'Omega', async () => {
    attempts += 1;
    if (attempts === 1) return { ok: false, status: 503 };
    return { ok: true, status: 200, json: async () => ({ total: 1, records: [row()], hasMore: false }) };
  });
  assert.equal(attempts, 2);
  assert.equal(records.length, 1);
});

test('public crawl reconciles by terminal cursor when the effective total is withheld', async () => {
  const pages = [
    { total: null, records: [row()], hasMore: true, nextCursor: 'cursor-2' },
    { total: null, records: [row({ id: '22222222-2222-4222-8222-222222222222' })], hasMore: false },
  ];
  const records = await crawlBrand('https://example.test', 'Omega', async () => ({
    ok: true,
    status: 200,
    json: async () => pages.shift(),
  }));
  assert.equal(records.length, 2);
});

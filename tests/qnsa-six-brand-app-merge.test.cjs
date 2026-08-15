'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const inventory = require('../api/reviewed-market-inventory.js');
const source = fs.readFileSync(path.join(__dirname, '..', 'api',
  'reviewed-market-inventory.js'), 'utf8');

const BRANDS = [
  'Rolex', 'Patek Philippe', 'Audemars Piguet',
  'Richard Mille', 'Cartier', 'Zenith',
];

function id(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function row(n, hour, { priced = true } = {}) {
  return {
    id: id(n),
    posting_date: `2026-08-15T${String(hour).padStart(2, '0')}:00:00.000Z`,
    source_price_amount: priced ? 10_000 + n : null,
  };
}

function cursorFor(value) {
  const cursor = inventory.sixBrandRowKeyset(value);
  return {
    has_price: cursor.hasPrice,
    created_at: cursor.createdAt,
    id: cursor.id,
  };
}

function entry(brand, rows, { hasMore = false, next = rows.at(-1) } = {}) {
  return {
    brand,
    envelope: {
      rows,
      has_more: hasMore,
      next_cursor: next ? cursorFor(next) : null,
    },
  };
}

test('six streams merge into one deterministic page without losing an unconsumed tail', () => {
  const rolexNewest = row(100, 23);
  const rolexTail = row(70, 19);
  const patekNewest = row(90, 22);
  const patekSecond = row(80, 21);
  const merged = inventory.mergeSixBrandEnvelopes([
    entry('Rolex', [rolexNewest, rolexTail], { hasMore: true, next: rolexTail }),
    entry('Patek Philippe', [patekNewest, patekSecond]),
    ...BRANDS.slice(2).map(brand => entry(brand, [], { next: null })),
  ], 3);

  assert.deepEqual(merged.rows.map(item => item.id), [
    rolexNewest.id, patekNewest.id, patekSecond.id,
  ]);
  assert.deepEqual(merged.nextBrandKeysets.Rolex,
    inventory.sixBrandRowKeyset(rolexNewest), 'Rolex tail must remain for page two');
  assert.deepEqual(merged.nextBrandKeysets['Patek Philippe'],
    inventory.sixBrandRowKeyset(patekSecond), 'fully consumed Patek stream may use its scan cursor');
  assert.equal(merged.hasMore, true);
});

test('an empty sparse brand window advances only that brand scan boundary', () => {
  const rolex = row(100, 23);
  const sparseBoundary = row(60, 18);
  const merged = inventory.mergeSixBrandEnvelopes([
    entry('Rolex', [rolex]),
    entry('Patek Philippe', [], { hasMore: true, next: sparseBoundary }),
    ...BRANDS.slice(2).map(brand => entry(brand, [], { next: null })),
  ], 1, { 'Patek Philippe': inventory.sixBrandRowKeyset(row(200, 23)) });

  assert.deepEqual(merged.nextBrandKeysets['Patek Philippe'],
    inventory.sixBrandRowKeyset(sparseBoundary));
  assert.deepEqual(merged.nextBrandKeysets.Rolex,
    inventory.sixBrandRowKeyset(rolex));
});

test('per-brand page-two resumes return every interleaved row exactly once', () => {
  const a1 = row(100, 23);
  const a2 = row(80, 21);
  const b1 = row(90, 22);
  const b2 = row(70, 20);
  const pageOne = inventory.mergeSixBrandEnvelopes([
    entry('Rolex', [a1, a2], { hasMore: true, next: a2 }),
    entry('Patek Philippe', [b1, b2], { hasMore: true, next: b2 }),
    ...BRANDS.slice(2).map(brand => entry(brand, [], { next: null })),
  ], 2);
  assert.deepEqual(pageOne.rows.map(item => item.id), [a1.id, b1.id]);
  assert.equal(pageOne.nextBrandKeysets.Rolex.id, a1.id);
  assert.equal(pageOne.nextBrandKeysets['Patek Philippe'].id, b1.id);

  const pageTwo = inventory.mergeSixBrandEnvelopes([
    entry('Rolex', [a2]), entry('Patek Philippe', [b2]),
    ...BRANDS.slice(2).map(brand => entry(brand, [], { next: null })),
  ], 2, pageOne.nextBrandKeysets);
  const ids = [...pageOne.rows, ...pageTwo.rows].map(item => item.id);
  assert.deepEqual(ids, [a1.id, b1.id, a2.id, b2.id]);
  assert.equal(new Set(ids).size, ids.length);
});

test('priced, timestamp, and UUID-desc tie breaks match the database keyset order', () => {
  const unpricedNew = row(4, 23, { priced: false });
  const pricedLowId = row(1, 20);
  const pricedHighId = row(2, 20);
  const sorted = [unpricedNew, pricedLowId, pricedHighId]
    .sort(inventory.compareSixBrandRows);
  assert.deepEqual(sorted.map(item => item.id), [
    pricedHighId.id, pricedLowId.id, unpricedNew.id,
  ]);
});

test('versioned six-brand cursor round trips exact per-brand keysets', () => {
  const brandKeysets = Object.fromEntries(BRANDS.map((brand, index) => [
    brand, inventory.sixBrandRowKeyset(row(index + 1, 23 - index)),
  ]));
  const token = inventory.encodeInventoryCursor({
    lane: 'images', offset: 0, page: 4, brandKeysets,
  });
  assert.ok(token.length < 2048);
  const decoded = inventory.parseInventoryCursor(token, 50);
  assert.equal(decoded.lane, 'images');
  assert.equal(decoded.page, 4);
  assert.deepEqual(decoded.brandKeysets, brandKeysets);
});

test('composite cursor rejects unknown brand codes and malformed UUIDs', () => {
  const unknown = Buffer.from(JSON.stringify({
    v: 2, l: 'i', o: 0, p: 2,
    b: { BAD: { h: true, c: '2026-08-15T20:00:00.000Z', i: id(1) } },
  })).toString('base64url');
  const malformed = Buffer.from(JSON.stringify({
    v: 2, l: 'i', o: 0, p: 2,
    b: { r: { h: true, c: '2026-08-15T20:00:00.000Z', i: '------------------------------------' } },
  })).toString('base64url');
  const unknownField = Buffer.from(JSON.stringify({
    v: 2, l: 'i', o: 0, p: 2, b: {}, extra: true,
  })).toString('base64url');
  assert.equal(inventory.parseInventoryCursor(unknown, 50), null);
  assert.equal(inventory.parseInventoryCursor(malformed, 50), null);
  assert.equal(inventory.parseInventoryCursor(unknownField, 50), null);
});

test('cursor parser rejects unknown schema versions rather than silently restarting streams', () => {
  const token = Buffer.from(JSON.stringify({
    v: 99, l: 'i', o: 0, p: 3,
  })).toString('base64url');
  assert.equal(inventory.parseInventoryCursor(token, 50), null);
});

test('broad six-brand requests fan out in parallel with bounded scans and fail closed', () => {
  const start = source.indexOf('if (sixBrandBroadScope)');
  const end = source.indexOf('} else {', start);
  const block = source.slice(start, end);
  assert.match(block, /Promise\.all\(requestedBrands\.map/);
  assert.match(block, /p_brand: brandName/);
  assert.match(block, /p_scan_limit: 100/);
  assert.match(block, /if \(!response\.ok\)[\s\S]*throw new Error/);
  assert.match(block, /if \(!envelope\) throw new Error/);
  assert.match(source, /!brand \|\| SIX_REVIEWED_WATCH_BRANDS\.includes\(brand\)/);
});

test('six-brand media lanes do not use REST boundary fill', () => {
  assert.match(source, /if \(!sixBrandBroadScope && !qnsaUnpartitionedMedia/);
  assert.match(source,
    /if \(sixBrandBroadScope && !imagesOnly && requestedLane === 'images' && !hasMore\)/);
  assert.match(source, /nextLane = 'no-images'[\s\S]*nextBrandKeysets = \{\}[\s\S]*hasMore = true/);
});

test('malformed or non-progressing envelopes fail closed', () => {
  assert.equal(inventory.parseSixBrandEnvelope({ rows: [], has_more: false })?.has_more, false);
  assert.equal(inventory.parseSixBrandEnvelope({ rows: [], has_more: true }), null);
  assert.equal(inventory.parseSixBrandEnvelope({ rows: 'not-an-array', has_more: false }), null);
});

test('stream validation rejects equal or newer cursors and unordered rows', () => {
  const prior = inventory.sixBrandRowKeyset(row(50, 20));
  const equal = { has_price: prior.hasPrice, created_at: prior.createdAt, id: prior.id };
  const newer = cursorFor(row(60, 21));
  const older = cursorFor(row(40, 19));
  assert.equal(inventory.validateSixBrandStreamEnvelope({
    rows: [], has_more: true, next_cursor: equal,
  }, prior), false);
  assert.equal(inventory.validateSixBrandStreamEnvelope({
    rows: [], has_more: true, next_cursor: newer,
  }, prior), false);
  assert.equal(inventory.validateSixBrandStreamEnvelope({
    rows: [], has_more: true, next_cursor: older,
  }, prior), true);
  assert.equal(inventory.validateSixBrandStreamEnvelope({
    rows: [row(30, 18), row(40, 19)], has_more: false, next_cursor: null,
  }, prior), false);
});

test('six-brand route excludes the non-paginated direct-submission overlay', () => {
  assert.match(source, /if \(firstPageOfLane && !sixBrandBroadScope\)[\s\S]*dealer_listing_submissions/);
  assert.match(source,
    /Six-brand pages use only the canonical immutable\/staging release[\s\S]*unp[\s\S]*seventh stream/);
});

test('bounded refill crosses initial sparse windows and populates the same customer page', async () => {
  const boundaries = [row(300, 23), row(200, 22)];
  const eligible = { ...row(100, 21), brand_scope: 'Rolex' };
  const replies = [
    { rows: [], has_more: true, next_cursor: cursorFor(boundaries[0]), scanned_count: 100 },
    { rows: [], has_more: true, next_cursor: cursorFor(boundaries[1]), scanned_count: 100 },
    { rows: [eligible], has_more: false, next_cursor: cursorFor(eligible), scanned_count: 40 },
  ];
  let calls = 0;
  const result = await inventory.refillSixBrandStream({
    brand: 'Rolex', pageSize: 50,
    fetchWindow: async () => replies[calls++],
  });
  assert.equal(calls, 3);
  assert.equal(result.windows, 3);
  assert.deepEqual(result.envelope.rows.map(value => value.id), [eligible.id]);
  assert.equal(result.envelope.scanned_count, 240);
});

test('bounded refill never scans more than five windows per brand', async () => {
  let calls = 0;
  const result = await inventory.refillSixBrandStream({
    brand: 'Rolex', pageSize: 50, maxWindows: 5,
    fetchWindow: async () => {
      calls += 1;
      const boundary = row(600 - calls, 24 - calls);
      return { rows: [], has_more: true, next_cursor: cursorFor(boundary), scanned_count: 100 };
    },
  });
  assert.equal(calls, 5);
  assert.equal(result.windows, 5);
  assert.equal(result.envelope.has_more, true);
  assert.equal(result.envelope.scanned_count, 500);
});

test('bounded refill rejects a non-progressing internal sparse cursor', async () => {
  const boundary = row(300, 23);
  let calls = 0;
  await assert.rejects(() => inventory.refillSixBrandStream({
    brand: 'Rolex', pageSize: 50,
    fetchWindow: async () => {
      calls += 1;
      return { rows: [], has_more: true, next_cursor: cursorFor(boundary), scanned_count: 100 };
    },
  }), /non-progressing envelope/);
  assert.equal(calls, 2);
});

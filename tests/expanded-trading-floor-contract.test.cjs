'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { enforceListingDisplayContract } = require('../shared/listing-display-contract.cjs');
const { assertSourceImageOrder } = require('../api/_lib/canary-source-image-order.cjs');
const { decodeCursorEnvelope } = require('../api/_lib/canary-keyset.cjs');

const calls = [];
let respond;
const dependency = require.resolve('../api/_lib/supabase.js');
require.cache[dependency] = { id: dependency, filename: dependency, loaded: true,
  exports: { getClient: () => ({ rpc: async (name, params) => { calls.push({ name, params }); return respond(name, params); } }) } };
const trading = require('../api/canary/trading-floor.js');
const evidence = require('../api/canary/source-evidence.js');
const snapshot = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const hash = 'a1'.repeat(32);
const filters = { sort: 'source_images', brand: null, model: null, intent: null, query: null, category: null, country: null, region: null, imagesOnly: false, pricedOnly: false };
const base = () => ({ listing_id: 'SYNTHETIC-SINGLE', source_id: 'SYNTHETIC-SOURCE', source_hash: hash,
  source_created_at: '2026-09-08T00:00:00.123456Z', raw_message_text: '[SYNTHETIC FIXTURE] WTB Cartier 1234',
  brand: 'Cartier', reference: '1234', intent: 'WTB', is_bundle: false });
const row = (id, lane, time = '2026-09-08T00:00:00.123456Z') => ({
  k_priced_rank: 2, k_image_rank: lane === 1 ? 1 : 2, k_price_usd: null,
  k_source_created_at: time, k_listing_id: id, k_source_lane: lane, payload: { ...base(), listing_id: id },
});
async function invoke(handler, query, method = 'GET') {
  const result = { status: 200, body: null, headers: {} };
  await handler({ method, query }, { status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; }, setHeader(key, value) { result.headers[key] = value; } });
  return result;
}
function reply(rows, total = rows.length) {
  respond = async name => {
    if (name === 'open_trading_floor_keyset_snapshot') return { data: snapshot };
    if (name === 'get_trading_floor_snapshot_count') return { data: total };
    if (name === 'get_trading_floor_source_images_keyset_v1') return { data: rows };
    assert.fail('Unexpected RPC ' + name);
  };
}
test.beforeEach(() => { calls.length = 0; respond = async name => assert.fail('Unexpected RPC ' + name); });

test('every child remains text-only even with stale assigned parent images; source input stays unchanged', () => {
  for (const child_image_assigned of [false, true]) {
    const input = { ...base(), parent_listing_id: 'SYNTHETIC-PARENT', child_index: 0, source_context_text: 'WTB Cartier 1234',
      raw_message_text: null, image_key: 'listings/parent-group.jpg', image_url: 'https://example.invalid/parent.jpg',
      thumbnail_url: 'https://example.invalid/thumb.jpg', image_urls: ['https://example.invalid/gallery.jpg'], images: ['https://example.invalid/other.jpg'],
      image_reachable: true, parent_has_attachment: true, child_image_assigned };
    const before = structuredClone(input), result = enforceListingDisplayContract(input);
    for (const field of ['image_key', 'image_url', 'thumbnail_url', 'imageUrl', 'primary_image_key', 'primary_image_url', 'thumbnail']) assert.equal(result[field], null, field);
    assert.equal(result.image_status, 'NO_IMAGE');
    assert.deepEqual(result.image_urls, []); assert.deepEqual(result.images, []); assert.deepEqual(result.gallery, []);
    assert.equal(result.source_context_text, input.source_context_text);
    assert.equal(result.raw_message_text, null);
    assert.equal(result.parent_listing_id, 'SYNTHETIC-PARENT'); assert.equal(result.child_index, 0);
    assert.equal(result.bundle_status, 'BUNDLE_CHILD'); assert.equal(result.source_hash, hash);
    assert.deepEqual(input, before);
  }
});

test('single original image and unknown optional fields survive the expanded contract', () => {
  const input = { ...base(), image_key: 'listings/full/single.jpg', image_reachable: true, source_listing_status: 'ended', source_deleted: false };
  const result = enforceListingDisplayContract(input);
  assert.equal(result.image_url, 'https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full/single.jpg');
  assert.equal(result.thumbnail_url, result.image_url); assert.equal(result.image_key, input.image_key);
  assert.equal(result.source_listing_status, 'ended'); assert.equal(result.source_deleted, false);
  for (const field of ['dial_color', 'year', 'condition', 'original_price_currency', 'original_price_amount', 'seller_review_count']) assert.equal(result[field], null, field);
  assert.equal(result.price_research_eligible, false);
});

test('explicit source wall-clock text and budget role survive without timezone or sale-price inference', () => {
  const input = { ...base(), source_created_at: null, source_created_at_text: '2026-09-01 17:30:00',
    original_price_role: 'WTB_BUDGET', original_price_amount: 5000, original_price_currency: 'USD' };
  const result = enforceListingDisplayContract(input);
  assert.equal(result.source_created_at_text, input.source_created_at_text);
  assert.equal(result.source_created_at, null);
  assert.equal(result.original_price_role, 'WTB_BUDGET');
  assert.equal(enforceListingDisplayContract({ ...input, original_price_role: 'WTS_ASK' }).original_price_role, 'WTS_ASK');
  assert.equal(enforceListingDisplayContract({ ...input, original_price_role: 'ASKING_PRICE' }).original_price_role, 'ASKING_PRICE');
  assert.equal(result.price_research_eligible, false);
  assert.equal(enforceListingDisplayContract({ ...input, original_price_role: 'GUESSED_ASK' }).original_price_role, null);
});

test('source order uses three frozen lanes then exact microsecond date and UTF8 ID order', () => {
  const rows = [row('older-photo', 1, '2020-01-01T00:00:00Z'), row('z', 2, '2026-09-08T00:00:00.123457Z'), row('a', 2), row('new-child', 3, '2027-01-01T00:00:00Z')];
  assert.doesNotThrow(() => assertSourceImageOrder(rows));
  assert.throws(() => assertSourceImageOrder([rows[1], rows[0]]), /invalid source-image order/);
  assert.throws(() => assertSourceImageOrder([rows[2], rows[1]]), /invalid source-image order/);
  assert.throws(() => assertSourceImageOrder([rows[0], rows[0]]), /invalid source-image order/);
  assert.throws(() => assertSourceImageOrder([{ ...rows[0], k_source_lane: 0 }]), /Invalid frozen/);
});

test('omitted default uses source_images and freezes its scope while explicit prior orders remain separate', async () => {
  reply([row('first-photo', 1)], 2);
  const result = await invoke(trading, { pageSize: '1' });
  assert.equal(result.status, 200); assert.equal(result.body.sort, 'source_images');
  const cursor = decodeCursorEnvelope(result.body.nextCursor, { surface: 'trading_floor', filters });
  assert.equal(cursor.snapshot, snapshot); assert.equal(cursor.key.createdAt, '2026-09-08T00:00:00.123456Z');
  calls.length = 0; reply([row('next-single', 2)], 2);
  const next = await invoke(trading, { pageSize: '1', cursor: result.body.nextCursor });
  assert.equal(next.status, 200); assert.equal(calls.some(call => call.name.startsWith('open_')), false);
  for (const sort of ['newest', 'discovery']) {
    calls.length = 0;
    const changed = await invoke(trading, { pageSize: '1', sort, cursor: result.body.nextCursor });
    assert.equal(changed.status, 400); assert.deepEqual(calls, []);
  }
});

test('country and region arrays preserve separate scopes and comma-containing source labels', async () => {
  const countries = JSON.stringify([' Switzerland ', 'Japan', 'Japan']), region = JSON.stringify(['New York, NY', 'Geneva']);
  reply([row('one', 1)], 2);
  const result = await invoke(trading, { pageSize: '1', countries, regions: region });
  assert.equal(result.status, 200);
  for (const call of calls.filter(call => call.params.p_country !== undefined)) {
    assert.equal(call.params.p_country, '["Japan","Switzerland"]');
    assert.equal(call.params.p_region, '["Geneva","New York, NY"]');
  }
  decodeCursorEnvelope(result.body.nextCursor, { surface: 'trading_floor', filters: { ...filters, country: '["Japan","Switzerland"]', region: '["Geneva","New York, NY"]' } });
  calls.length = 0;
  const changed = await invoke(trading, { pageSize: '1', countries: '["Japan"]', regions: region, cursor: result.body.nextCursor });
  assert.equal(changed.status, 400); assert.deepEqual(calls, []);
});

test('invalid country arrays fail before database access', async () => {
  for (const countries of ['{}', 'null', '[null]', '[""]', '[1]', 'not json', JSON.stringify(Array(51).fill('Japan')), ['Japan']]) {
    assert.equal((await invoke(trading, { countries })).status, 400);
  }
  assert.equal((await invoke(trading, { country: 'Japan', countries: '["Japan"]' })).status, 400);
  assert.deepEqual(calls, []);
});

test('parent source endpoint binds both identities, redacts public text, and omits private raw UUID', async () => {
  respond = async (name, args) => {
    assert.equal(name, 'get_expanded_listing_source_v3');
    assert.deepEqual(args, { p_listing_id: 'SYNTHETIC-CHILD', p_source_hash: hash });
    return { data: { listing_id: args.p_listing_id, source_hash: hash, raw_message_id: 'private-raw-uuid', raw_message_text: '[SYNTHETIC] WTB Cartier1234 Contact +1 202 555 0144', source_context_text: 'WTB Cartier1234', source_listing_status: 'ended', source_deleted: false } };
  };
  const result = await invoke(evidence, { listing_id: 'SYNTHETIC-CHILD', source_hash: hash });
  assert.equal(result.status, 200); assert.equal(result.body.source_context_text, 'WTB Cartier1234');
  assert.equal(result.body.source_listing_status, 'ended'); assert.equal(result.body.source_deleted, false);
  assert.equal('raw_message_id' in result.body, false); assert.doesNotMatch(result.body.raw_message_text, /202 555 0144/);
  assert.equal(result.headers['Cache-Control'], 'private, no-store');
});

test('missing, stale, or malformed source evidence never returns an unrelated parent', async () => {
  assert.equal((await invoke(evidence, { listing_id: 'x', source_hash: 'bad' })).status, 400);
  assert.deepEqual(calls, []);
  respond = async () => ({ data: null });
  assert.equal((await invoke(evidence, { listing_id: 'x', source_hash: hash })).status, 404);
  respond = async () => ({ data: { listing_id: 'other', source_hash: hash, raw_message_text: 'unrelated' } });
  const result = await invoke(evidence, { listing_id: 'x', source_hash: hash });
  assert.equal(result.status, 500); assert.equal(result.body.raw_message_text, undefined);
});

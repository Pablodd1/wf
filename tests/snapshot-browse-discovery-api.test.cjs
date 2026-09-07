"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

// All database access is replaced before loading either handler. These tests
// exercise real HTTP-handler validation, ordering and cursor behavior offline.
const dependency = require.resolve("../api/_lib/supabase.js");
const calls = [];
let respond;
require.cache[dependency] = {
  id: dependency, filename: dependency, loaded: true,
  exports: { getClient: () => ({ rpc: async (name, params) => {
    calls.push({ name, params });
    return respond(name, params);
  } }) },
};
const browse = require("../api/canary/browse.js");
const trading = require("../api/canary/trading-floor.js");
const { computeCursorScope, decodeCursorEnvelope } = require("../api/_lib/canary-keyset.cjs");

const SNAPSHOT = "abcdef12-abcd-4abc-8def-123456abcdef";
const FILTERS = { brand: null, model: null, intent: null, query: null, category: null,
  country: null, region: null, imagesOnly: false, pricedOnly: false };
const TF_DEFAULT = "get_trading_floor_canary_keyset_v4";
const TF_DISCOVERY = "get_trading_floor_discovery_keyset_v1";

async function invoke(handler, query = {}, method = "GET") {
  const result = { status: 200, body: null, headers: {} };
  await handler({ method, query }, {
    status(value) { result.status = value; return this; },
    json(value) { result.body = value; return this; },
    setHeader(key, value) { result.headers[key] = value; },
  });
  return result;
}

function row(id, price, overrides = {}) {
  return {
    k_priced_rank: 1, k_image_rank: 2, k_price_usd: price,
    k_source_created_at: "2026-09-01T00:00:00.123456Z", k_listing_id: id,
    payload: {
      listing_id: id, source_id: "synthetic-" + id, source_hash: "a1b2c3d4".repeat(8),
      source_created_at: "2026-09-01T00:00:00.123456Z", intent: "WTS",
      brand: "Synthetic Watch Brand", model: null, reference: "SOURCE-" + id,
      original_price_currency: "USD", original_price_amount: price,
      price_usd: price, price_research_eligible: true, priced_rank: 1, image_rank: 2,
      is_bundle: false, raw_message_text: "[SYNTHETIC FIXTURE] Single watch " + id,
    },
    ...overrides,
  };
}

function tradingReply(defaultRows, discoveryRows = defaultRows, total = defaultRows.length) {
  respond = async name => {
    if (name === "open_trading_floor_keyset_snapshot") return { data: SNAPSHOT, error: null };
    if (name === "get_trading_floor_snapshot_count") return { data: total, error: null };
    if (name === TF_DEFAULT) return { data: defaultRows, error: null };
    if (name === TF_DISCOVERY) return { data: discoveryRows, error: null };
    assert.fail("Unexpected RPC: " + name);
  };
}

function metadata(snapshot = SNAPSHOT) {
  return {
    success: true, snapshot_id: snapshot, surface: "trading_floor", total: 3,
    brands: [{ brand: "Synthetic Watch Brand", listing_count: 3 }],
    models: [{ model: "Reference-only listings", listing_count: 3 }],
    references: [{ reference: "SOURCE-A", model: null, listing_count: 3 }],
  };
}

test.beforeEach(() => {
  calls.length = 0;
  respond = async name => assert.fail("Unexpected database access: " + name);
});

test("omitted and explicit default ordering keep the five-field RPC and legacy cursor scope", async () => {
  const rows = [row("b", 30000), row("c", 20000), row("a", 10000)];
  tradingReply(rows);
  const implicit = await invoke(trading, { pageSize: "3" });
  const explicit = await invoke(trading, { pageSize: "3", sort: "newest" });
  for (const result of [implicit, explicit]) {
    assert.equal(result.status, 200);
    assert.equal(result.body.sort, "newest");
    assert.equal(result.body.total, 3);
    assert.deepEqual(result.body.records.map(item => item.listing_id), ["b", "c", "a"]);
    const envelope = JSON.parse(Buffer.from(result.body.nextCursor, "base64url"));
    assert.equal(envelope.scope, computeCursorScope("trading_floor", FILTERS));
  }
  assert.equal(implicit.body.nextCursor, explicit.body.nextCursor);
  assert.equal(calls.filter(call => call.name === TF_DEFAULT).length, 2);
  assert.equal(calls.filter(call => call.name === TF_DISCOVERY).length, 0);
});

test("Discovery changes ordering while preserving frozen counts, membership and source payload", async () => {
  const a = row("a", 10000), b = row("b", 30000), c = row("c", 20000);
  // Fixed IDs have MD5 order a, c, b, which differs from descending price.
  const original = structuredClone([a, c, b]);
  tradingReply([b, c, a], [a, c, b], "3");
  const result = await invoke(trading, { sort: " DISCOVERY ", pageSize: "3" });
  assert.equal(result.status, 200);
  assert.equal(result.body.sort, "discovery");
  assert.equal(result.body.total, 3);
  assert.equal(result.body.snapshot_total, 3);
  assert.equal(result.body.snapshot, SNAPSHOT);
  assert.deepEqual(result.body.records.map(item => item.listing_id), ["a", "c", "b"]);
  assert.deepEqual([a, c, b], original, "handling a request must not alter source payloads");
  assert.ok(result.body.records.every(item => item.model === null && item.image_url === null));
  assert.equal(calls.filter(call => call.name === TF_DEFAULT).length, 0);
  const key = decodeCursorEnvelope(result.body.nextCursor, {
    surface: "trading_floor", filters: { ...FILTERS, sort: "discovery" },
  });
  assert.equal(key.key.listingId, "b");
  assert.equal(key.key.createdAt, "2026-09-01T00:00:00.123456Z");
});

test("Discovery pagination reuses the frozen snapshot and exact cursor key without reopening", async () => {
  const first = row("a", 10000, { k_price_usd: "10000.000000" });
  tradingReply([first], [first], 2);
  const page = await invoke(trading, { sort: "discovery", pageSize: "1", brand: " Synthetic Watch Brand " });
  assert.equal(page.status, 200);
  assert.equal(page.body.total, 2);
  calls.length = 0;
  const next = row("c", 20000);
  tradingReply([], [next], 2);
  const result = await invoke(trading, { sort: "discovery", pageSize: "2", brand: "Synthetic Watch Brand", cursor: page.body.nextCursor });
  assert.equal(result.status, 200);
  assert.equal(result.body.snapshot, SNAPSHOT);
  assert.equal(result.body.total, 2);
  assert.equal(result.body.total, page.body.total);
  assert.equal(result.body.nextCursor, null);
  assert.equal(calls.filter(call => call.name.startsWith("open_")).length, 0);
  const params = calls.find(call => call.name === TF_DISCOVERY).params;
  assert.equal(params.p_snapshot_id, SNAPSHOT);
  assert.equal(params.p_cursor_listing_id, "a");
  assert.equal(params.p_cursor_price_usd, "10000.000000");
  assert.equal(params.p_cursor_created_at, "2026-09-01T00:00:00.123456Z");
  assert.equal(params.p_brand, "Synthetic Watch Brand");
});

test("switching either cursor ordering direction is refused before database access", async () => {
  tradingReply([row("a", 10000)]);
  for (const [from, to] of [["newest", "discovery"], ["discovery", "newest"]]) {
    const first = await invoke(trading, { sort: from, pageSize: "1" });
    assert.equal(first.status, 200);
    calls.length = 0;
    const changed = await invoke(trading, { sort: to, pageSize: "1", cursor: first.body.nextCursor });
    assert.equal(changed.status, 400);
    assert.match(changed.body.error, /scope mismatch/i);
    assert.deepEqual(calls, []);
  }
});

test("invalid sort values are rejected without opening a snapshot", async () => {
  for (const sort of ["", "random", "price", "newest,discovery", ["discovery"], { value: "newest" }]) {
    const result = await invoke(trading, { sort });
    assert.equal(result.status, 400, "Invalid sort: " + JSON.stringify(sort));
    assert.deepEqual(calls, []);
  }
});

test("multiple locations preserve comma-containing labels and bind a canonical selection to the cursor", async () => {
  tradingReply([row("a", 10000)]);
  const regions = JSON.stringify([" New York, NY ", "Geneva", "Geneva", 'A "quoted", place']);
  const canonical = JSON.stringify(['A "quoted", place', "Geneva", "New York, NY"]);
  const first = await invoke(trading, { sort: "discovery", regions, pageSize: "1" });
  assert.equal(first.status, 200);
  for (const call of calls.filter(call => ["get_trading_floor_snapshot_count", TF_DISCOVERY].includes(call.name))) {
    assert.equal(call.params.p_region, canonical);
  }
  const envelope = decodeCursorEnvelope(first.body.nextCursor, {
    surface: "trading_floor", filters: { ...FILTERS, sort: "discovery", region: canonical },
  });
  assert.equal(envelope.snapshot, SNAPSHOT);
  calls.length = 0;
  const reordered = await invoke(trading, { sort: "discovery", pageSize: "1", cursor: first.body.nextCursor,
    regions: JSON.stringify(["Geneva", 'A "quoted", place', "New York, NY"]),
  });
  assert.equal(reordered.status, 200, "equivalent selection order must keep the same cursor scope");
  assert.equal(calls.some(call => call.name.startsWith("open_")), false);
  calls.length = 0;
  const changed = await invoke(trading, { sort: "discovery", pageSize: "1", cursor: first.body.nextCursor,
    regions: JSON.stringify(["New York", "NY", "Geneva"]),
  });
  assert.equal(changed.status, 400, "splitting a label is a different selection");
  assert.match(changed.body.error, /scope mismatch/i);
  assert.deepEqual(calls, []);
});

test("an empty location selection preserves the default scope and scalar labels remain intact", async () => {
  tradingReply([row("a", 10000)]);
  const empty = await invoke(trading, { regions: "[]", pageSize: "1" });
  assert.equal(empty.status, 200);
  assert.equal(JSON.parse(Buffer.from(empty.body.nextCursor, "base64url")).scope, computeCursorScope("trading_floor", FILTERS));
  assert.ok(calls.filter(call => !call.name.startsWith("open_")).every(call => call.params.p_region === null));
  calls.length = 0;
  const scalar = await invoke(trading, { region: " New York, NY " });
  assert.equal(scalar.status, 200);
  for (const call of calls.filter(call => !call.name.startsWith("open_"))) {
    assert.deepEqual(JSON.parse(call.params.p_region), ["New York, NY"]);
  }
});

test("malformed, excessive or conflicting location selections are rejected before DB access", async () => {
  const invalid = [
    { regions: "not-json" }, { regions: "null" }, { regions: '{}' }, { regions: '"Geneva"' },
    { regions: '[1]' }, { regions: '[null]' }, { regions: '[""]' }, { regions: '["   "]' },
    { regions: '[[]]' }, { regions: '[{}]' }, { regions: ["Geneva"] }, { regions: null },
    { regions: JSON.stringify(["x".repeat(201)]) }, { regions: JSON.stringify(Array(51).fill("Geneva")) },
    { regions: '["Geneva"]', region: "Geneva" }, { regions: "[]", region: "" },
  ];
  for (const query of invalid) {
    const result = await invoke(trading, query);
    assert.equal(result.status, 400, JSON.stringify(query));
    assert.match(result.body.error, /Invalid regions parameter/);
    assert.deepEqual(calls, []);
  }
  tradingReply([]);
  const maximum = await invoke(trading, { regions: JSON.stringify(Array.from({ length: 50 }, (_, index) => String(index).padEnd(200, "x"))) });
  assert.equal(maximum.status, 200, "documented size limits remain inclusive");
});

test("Discovery rejects duplicate, hash-reversed and rank-reversed database pages", async () => {
  const a = row("a", 10000), b = row("b", 30000);
  const imageFirst = row("b", 30000, { k_image_rank: 1 });
  const unpriced = row("a", null, { k_priced_rank: 2 });
  for (const rows of [[a, a], [b, a], [a, imageFirst], [unpriced, b]]) {
    tradingReply([], rows);
    const result = await invoke(trading, { sort: "discovery" });
    assert.equal(result.status, 500);
    assert.deepEqual(result.body.records, []);
    assert.equal(result.body.message, "Unable to load listings");
  }
});

test("Discovery retains priced/image lane precedence before applying its mix", async () => {
  const rows = [row("b", 30000, { k_image_rank: 1 }), row("a", 10000),
    row("c", null, { k_priced_rank: 2, k_image_rank: 1 }), row("a-unpriced", null, { k_priced_rank: 2 })];
  tradingReply([], rows, 4);
  const result = await invoke(trading, { sort: "discovery" });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.records.map(item => item.listing_id), ["b", "a", "c", "a-unpriced"]);
});

test("Discovery RPC expiry and transport errors fail closed without leaking upstream details", async () => {
  for (const [error, expectedStatus] of [
    [{ code: "22023", message: "snapshot_expired: internal-private-detail" }, 400],
    [{ code: "XX000", message: "internal-private-detail" }, 500],
  ]) {
    tradingReply([]);
    const fallback = respond;
    respond = async (name, params) => name === TF_DISCOVERY ? { data: null, error } : fallback(name, params);
    const result = await invoke(trading, { sort: "discovery" });
    assert.equal(result.status, expectedStatus);
    assert.doesNotMatch(JSON.stringify(result.body), /internal-private-detail/);
  }
});

test("browse normalizes supplied UUID and returns only frozen metadata without catalog guesses", async () => {
  const frozen = metadata();
  const original = structuredClone(frozen);
  respond = async name => {
    assert.equal(name, "get_canary_snapshot_browse_v1");
    return { data: frozen, error: null };
  };
  const result = await invoke(browse, { snapshot: SNAPSHOT.toUpperCase(), brand: " Synthetic Watch Brand ", model: " Reference-only listings " });
  assert.equal(result.status, 200);
  assert.equal(result.headers["Cache-Control"], "private, no-store");
  assert.deepEqual(result.body, original);
  assert.deepEqual(frozen, original);
  assert.equal(result.body.references[0].model, null);
  assert.deepEqual(calls, [{ name: "get_canary_snapshot_browse_v1", params: {
    p_snapshot_id: SNAPSHOT, p_surface: "trading_floor", p_brand: "Synthetic Watch Brand", p_model: "Reference-only listings",
  } }]);
});

test("browse opens the selected surface once and preserves a truthful empty population", async () => {
  for (const surface of ["trading_floor", "price_research"]) {
    calls.length = 0;
    const empty = { success: true, snapshot_id: SNAPSHOT, surface, total: 0, brands: [], models: [], references: [] };
    respond = async name => name.startsWith("open_") ? { data: SNAPSHOT, error: null } : { data: empty, error: null };
    const result = await invoke(browse, { surface });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, empty);
    assert.deepEqual(calls.map(call => call.name), ["open_" + surface + "_keyset_snapshot", "get_canary_snapshot_browse_v1"]);
    assert.equal(calls[1].params.p_surface, surface);
    assert.equal(calls[1].params.p_brand, null);
    assert.equal(calls[1].params.p_model, null);
  }
});

test("browse rejects unsupported methods, parameters, repeated values and malformed identities before DB access", async () => {
  assert.equal((await invoke(browse, {}, "POST")).status, 405);
  const invalid = [{ unknown: "x" }, { surface: "all" }, { surface: "PRICE_RESEARCH" },
    { snapshot: "not-a-uuid" }, { snapshot: SNAPSHOT + "extra" }, { snapshot: " " + SNAPSHOT },
    ...["surface", "snapshot", "brand", "model"].map(key => ({ [key]: ["repeated"] })),
    { brand: { nested: "Rolex" } }, { model: { nested: "Submariner" } }];
  for (const query of invalid) {
    const result = await invoke(browse, query);
    assert.equal(result.status, 400, JSON.stringify(query));
    assert.deepEqual(calls, [], "invalid browse requests must not query any data");
  }
});

test("browse fails closed on missing, unsuccessful or wrong-snapshot metadata", async () => {
  for (const data of [null, [], {}, { ...metadata(), success: false }, { ...metadata(), snapshot_id: "11111111-2222-4333-8444-555555555555" }]) {
    respond = async () => ({ data, error: null });
    const result = await invoke(browse, { snapshot: SNAPSHOT });
    assert.equal(result.status, 500);
    assert.deepEqual(result.body, { success: false, error: "Unable to load browse options" });
  }
});

test("browse maps expired snapshots to restart guidance and withholds unexpected database details", async () => {
  for (const [error, status] of [
    [{ code: "22023", message: "snapshot_expired: private-schema-detail" }, 400],
    [{ code: "XX000", message: "private-schema-detail" }, 500],
  ]) {
    respond = async () => ({ data: null, error });
    const result = await invoke(browse, { snapshot: SNAPSHOT });
    assert.equal(result.status, status);
    assert.equal(result.body.success, false);
    assert.doesNotMatch(result.body.error, /private-schema-detail/);
    if (status === 400) assert.match(result.body.error, /restart pagination/i);
  }
});

test("browse never requests metadata after the snapshot constructor fails or returns no identity", async () => {
  for (const opened of [{ data: null, error: { code: "XX000", message: "private" } }, { data: null, error: null }, { data: "", error: null }]) {
    calls.length = 0;
    respond = async () => opened;
    const result = await invoke(browse);
    assert.equal(result.status, 500);
    assert.deepEqual(calls.map(call => call.name), ["open_trading_floor_keyset_snapshot"]);
  }
});

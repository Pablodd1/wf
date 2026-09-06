"use strict";

/**
 * PHASE 5: snapshot cursor envelope + snapshot-pinned keyset pagination (API side).
 *
 * Proves:
 * - Envelope {version:'v2', snapshot, scope, key:[5]} round-trip and ordered
 *   fail-closed validation: malformed base64/JSON, legacy bare tuple, missing
 *   fields, unknown extra keys, bad snapshot id, bad scope, scope mismatch on
 *   filter change, tampered key values — every failure is HTTP 400 with a
 *   stable message and NEVER a silent page-1 restart.
 * - Handlers adopt the v3 snapshot RPCs: first page opens a snapshot, subsequent
 *   pages reuse the snapshot id from the cursor, snapshot_expired RPC failures
 *   map to HTTP 400 with re-open guidance.
 * - OFFSET is gone from V2 hot paths: TF/PR WTS are keyset-only and the WTB
 *   demand lane rejects traversal (demandPage > 1) with an explicit 400.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Mock Supabase module before requiring handlers
const supabasePath = path.resolve(__dirname, "../api/_lib/supabase.js");
let mockRpcHandler = () => Promise.resolve({ data: [], error: null });
const rpcCalls = [];

require.cache[supabasePath] = {
  id: supabasePath,
  filename: supabasePath,
  loaded: true,
  exports: {
    getClient: () => ({
      rpc: (name, params) => {
        rpcCalls.push({ name, params });
        return mockRpcHandler(name, params);
      },
    })
  }
};

const tradingFloorHandler = require("../api/canary/trading-floor");
const priceResearchHandler = require("../api/canary/price-research");
const {
  computeCursorScope,
  decodeCursorEnvelope,
  encodeCursorEnvelope,
  mapSnapshotRpcError,
  CURSOR_MESSAGES,
} = require("../api/_lib/canary-keyset.cjs");

const SNAPSHOT_ID = "11111111-2222-4333-8444-555555555555";
const DEMAND_SNAPSHOT_ID = "99999999-8888-4777-8666-555555555555";
const HASH = "a1b2c3d4".repeat(8);

const TF_FILTERS = {
  brand: null, model: null, intent: null, query: null, category: null,
  country: null, region: null, imagesOnly: false, pricedOnly: false,
};
// PR scope filters for reference-only queries (as normalized by the handler)
const PR_FILTERS = {
  brand: null, reference: "116500LN", model: null,
  dialSupplied: false, dial: null, conditionSupplied: false, condition: null,
};

function createMockReqRes(query = {}) {
  const req = { method: "GET", query };
  let statusCode = 200;
  let jsonBody = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(data) { jsonBody = data; return this; },
    getStatusCode: () => statusCode,
    getBody: () => jsonBody
  };
  return { req, res };
}

function provenanceRow(overrides = {}) {
  return {
    listing_id: "row_1",
    source_id: "src_1",
    source_hash: HASH,
    source_created_at: "2026-08-30T00:00:00.000Z",
    intent: "WTS",
    brand: "Rolex",
    reference: "116500LN",
    price_usd: 32000,
    original_price_amount: 32000,
    original_price_currency: "USD",
    price_research_eligible: true,
    priced_rank: 1,
    image_rank: 2,
    is_bundle: false,
    ...overrides,
  };
}

// Phase 5.1: v4 keyset RPCs return frozen membership columns (k_*) + live payload
function v4Row(payload, keyOverrides = {}) {
  return {
    k_priced_rank: payload.priced_rank ?? 1,
    k_image_rank: payload.image_rank ?? 2,
    k_price_usd: payload.price_usd ?? null,
    k_source_created_at: payload.source_created_at,
    k_listing_id: payload.listing_id,
    payload,
    ...keyOverrides,
  };
}

function tfMock(rows, total = rows.length) {
  mockRpcHandler = async (name, params = {}) => {
    if (name === "open_trading_floor_keyset_snapshot") return { data: SNAPSHOT_ID, error: null };
    if (name === "get_trading_floor_snapshot_count") return { data: total, error: null };
    if (name === "get_trading_floor_canary_keyset_v4") return { data: rows, error: null };
    return { data: [], error: null };
  };
}

function prMock({ rows = [], statsRow = null } = {}) {
  mockRpcHandler = async (name, params = {}) => {
    if (name === "open_price_research_keyset_snapshot") return { data: SNAPSHOT_ID, error: null };
    if (name === "open_trading_floor_keyset_snapshot") return { data: DEMAND_SNAPSHOT_ID, error: null };
    if (name === "get_price_research_canary_keyset_v4") return { data: rows, error: null };
    if (name === "get_price_research_scoped_stats_v2") return { data: statsRow ? [statsRow] : [], error: null };
    if (name === "get_price_research_cohort_breakdown_v2") return { data: [], error: null };
    if (name === "get_price_research_condition_facets_v2") return { data: [], error: null };
    if (name === "get_price_research_snapshot_count" && !params.p_demand) return { data: rows.length, error: null };
    if (name === "get_price_research_snapshot_count" && params.p_demand) return { data: 0, error: null };
    if (name === "get_price_research_wtb_demand_v2") return { data: [], error: null };
    return { data: [], error: null };
  };
}

function makeEnvelope(overrides = {}) {
  const scope = computeCursorScope("trading_floor", TF_FILTERS);
  const envelope = {
    version: "v2",
    snapshot: SNAPSHOT_ID,
    scope,
    key: [1, 2, 32000, "2026-08-30T00:00:00.000Z", "row_1"],
    ...overrides,
  };
  return Buffer.from(JSON.stringify(envelope), "utf-8").toString("base64url");
}

test("Phase 5: snapshot cursor envelope and v3 RPC adoption", async (t) => {

  await t.test("1. Envelope round-trip preserves snapshot, scope and key (frozen k_* fields only)", () => {
    const scope = computeCursorScope("trading_floor", TF_FILTERS);
    const cursor = encodeCursorEnvelope({
      snapshot: SNAPSHOT_ID,
      scope,
      frozenKey: {
        k_priced_rank: 1,
        k_image_rank: 2,
        k_price_usd: 32000,
        k_source_created_at: "2026-08-30T00:00:00.000Z",
        k_listing_id: "row_1",
      },
    });
    const decoded = decodeCursorEnvelope(cursor, { surface: "trading_floor", filters: TF_FILTERS });
    assert.equal(decoded.snapshot, SNAPSHOT_ID);
    assert.equal(decoded.scope, scope);
    assert.deepEqual(decoded.key, {
      pricedRank: 1,
      imageRank: 2,
      priceUsd: 32000,
      createdAt: "2026-08-30T00:00:00.000Z",
      listingId: "row_1",
    });
  });

  await t.test("1b. Cursor encoding uses frozen keys even when payload diverges; missing frozen keys fail closed", () => {
    const scope = computeCursorScope("trading_floor", TF_FILTERS);
    // Payload/frozen divergence: cursor must follow the FROZEN membership values
    const cursor = encodeCursorEnvelope({
      snapshot: SNAPSHOT_ID,
      scope,
      frozenKey: {
        k_priced_rank: 1,
        k_image_rank: 2,
        k_price_usd: 31000, // diverged from display price 32000
        k_source_created_at: "2026-08-30T00:00:00.000Z",
        k_listing_id: "row_1",
      },
    });
    const decoded = decodeCursorEnvelope(cursor, { surface: "trading_floor", filters: TF_FILTERS });
    assert.equal(decoded.key.priceUsd, 31000, "cursor must carry the frozen membership price, not the payload price");

    // Missing frozen key columns must never fall back to payload fields
    assert.throws(() => encodeCursorEnvelope({ snapshot: SNAPSHOT_ID, scope }),
      /without frozen snapshot key columns/);
    assert.throws(() => encodeCursorEnvelope({
      snapshot: SNAPSHOT_ID,
      scope,
      frozenKey: { k_priced_rank: 1, k_image_rank: 2, k_price_usd: 32000, k_source_created_at: "2026-08-30T00:00:00.000Z" },
    }), /frozen listing ID/);
  });

  await t.test("1c. F4: microsecond-precision frozen keys survive encode→decode BYTE-IDENTICAL (opaque passthrough)", () => {
    const scope = computeCursorScope("trading_floor", TF_FILTERS);
    // PostgREST serializes timestamptz preserving microseconds; membership
    // binding (IS DISTINCT FROM) compares at full precision.
    const microTs = "2026-09-05T12:34:56.123456+00:00";
    const numericStringPrice = "32000.00"; // Postgres numeric serialization
    const cursor = encodeCursorEnvelope({
      snapshot: SNAPSHOT_ID,
      scope,
      frozenKey: {
        k_priced_rank: 1,
        k_image_rank: 2,
        k_price_usd: numericStringPrice,
        k_source_created_at: microTs,
        k_listing_id: "row_1",
      },
    });
    // The wire form must contain the exact JSON values, never reformatted
    const wireJson = Buffer.from(cursor, "base64url").toString("utf-8");
    assert.ok(wireJson.includes('"2026-09-05T12:34:56.123456+00:00"'), "microsecond timestamp must appear verbatim in the wire payload");
    assert.ok(wireJson.includes('"32000.00"'), "numeric-string price must appear verbatim in the wire payload");

    const decoded = decodeCursorEnvelope(cursor, { surface: "trading_floor", filters: TF_FILTERS });
    assert.equal(decoded.key.createdAt, microTs, "timestamp must be byte-identical after round-trip");
    assert.equal(decoded.key.priceUsd, numericStringPrice, "numeric-string price must be byte-identical after round-trip");

    // Malformed opaque values still fail closed
    assert.throws(() => encodeCursorEnvelope({
      snapshot: SNAPSHOT_ID, scope,
      frozenKey: { k_priced_rank: 1, k_image_rank: 2, k_price_usd: 1, k_source_created_at: "not-a-timestamp", k_listing_id: "row_1" },
    }), /valid frozen timestamp/);
    assert.throws(() => decodeCursorEnvelope(makeEnvelope({ key: [1, 2, "abc", microTs, "row_1"] }), { surface: "trading_floor", filters: TF_FILTERS }),
      (err) => err.statusCode === 400 && err.message === CURSOR_MESSAGES.INVALID_KEY);
  });

  await t.test("2. Malformed base64/JSON is rejected fail-closed", () => {
    assert.throws(() => decodeCursorEnvelope("!!!not-base64-json!!!", { surface: "trading_floor", filters: TF_FILTERS }),
      (err) => err.statusCode === 400 && err.message === CURSOR_MESSAGES.MALFORMED);
  });

  await t.test("3. Legacy bare-tuple v2 cursor gets explicit 400 with migration guidance", () => {
    const legacy = Buffer.from(JSON.stringify(["v2", 1, 2, 32000, "2026-08-30T00:00:00.000Z", "row_1"]), "utf-8").toString("base64url");
    assert.throws(() => decodeCursorEnvelope(legacy, { surface: "trading_floor", filters: TF_FILTERS }),
      (err) => err.statusCode === 400 && /upgraded to the v2 snapshot envelope; restart pagination/.test(err.message));
  });

  await t.test("4. Missing fields and unknown extra fields are rejected", () => {
    const scope = computeCursorScope("trading_floor", TF_FILTERS);
    const missing = Buffer.from(JSON.stringify({ version: "v2", snapshot: SNAPSHOT_ID, scope }), "utf-8").toString("base64url");
    assert.throws(() => decodeCursorEnvelope(missing, { surface: "trading_floor", filters: TF_FILTERS }),
      (err) => err.statusCode === 400 && err.message === CURSOR_MESSAGES.MISSING_FIELDS);

    const extra = makeEnvelope({ injected: true });
    assert.throws(() => decodeCursorEnvelope(extra, { surface: "trading_floor", filters: TF_FILTERS }),
      (err) => err.statusCode === 400 && err.message === CURSOR_MESSAGES.UNKNOWN_FIELDS);
  });

  await t.test("5. Wrong version, bad snapshot id, bad scope fingerprint are rejected", () => {
    assert.throws(() => decodeCursorEnvelope(makeEnvelope({ version: "v1" }), { surface: "trading_floor", filters: TF_FILTERS }),
      (err) => err.statusCode === 400 && /Unsupported cursor version/.test(err.message));
    assert.throws(() => decodeCursorEnvelope(makeEnvelope({ snapshot: "not-a-uuid" }), { surface: "trading_floor", filters: TF_FILTERS }),
      (err) => err.statusCode === 400 && err.message === CURSOR_MESSAGES.BAD_SNAPSHOT);
    assert.throws(() => decodeCursorEnvelope(makeEnvelope({ scope: "sha256:zzz" }), { surface: "trading_floor", filters: TF_FILTERS }),
      (err) => err.statusCode === 400 && err.message === CURSOR_MESSAGES.BAD_SCOPE);
  });

  await t.test("6. Filter change after issuance yields scope mismatch", () => {
    const cursor = makeEnvelope();
    const changedFilters = { ...TF_FILTERS, brand: "Rolex" };
    assert.throws(() => decodeCursorEnvelope(cursor, { surface: "trading_floor", filters: changedFilters }),
      (err) => err.statusCode === 400 && err.message === CURSOR_MESSAGES.SCOPE_MISMATCH);
    // Cross-surface replay is also a scope mismatch
    assert.throws(() => decodeCursorEnvelope(cursor, {
      surface: "price_research",
      filters: { brand: null, reference: null, model: null, dialSupplied: false, dial: null, conditionSupplied: false, condition: null },
    }), (err) => err.statusCode === 400 && err.message === CURSOR_MESSAGES.SCOPE_MISMATCH);
  });

  await t.test("7. Tampered key values are rejected", () => {
    assert.throws(() => decodeCursorEnvelope(makeEnvelope({ key: [3, 2, 32000, "2026-08-30T00:00:00.000Z", "row_1"] }), { surface: "trading_floor", filters: TF_FILTERS }),
      (err) => err.statusCode === 400 && err.message === CURSOR_MESSAGES.INVALID_KEY);
    assert.throws(() => decodeCursorEnvelope(makeEnvelope({ key: [1, 2, null, "2026-08-30T00:00:00.000Z", "row_1"] }), { surface: "trading_floor", filters: TF_FILTERS }),
      (err) => err.statusCode === 400 && /Priced cursor is missing USD price/.test(err.message));
    assert.throws(() => decodeCursorEnvelope(makeEnvelope({ key: [1, 2, 32000, "not-a-date", "row_1"] }), { surface: "trading_floor", filters: TF_FILTERS }),
      (err) => err.statusCode === 400 && err.message === CURSOR_MESSAGES.INVALID_KEY);
  });

  await t.test("8. TF first page opens a snapshot and returns an envelope cursor; replay reuses snapshot", async () => {
    rpcCalls.length = 0;
    // pageSize == row count triggers nextCursor emission
    tfMock([v4Row(provenanceRow())], 50);
    const { req, res } = createMockReqRes({ pageSize: "1" });
    await tradingFloorHandler(req, res);
    assert.equal(res.getStatusCode(), 200);
    const body = res.getBody();
    assert.equal(body.snapshot, SNAPSHOT_ID);
    assert.equal(body.hasMore, true);
    assert.ok(body.nextCursor, "envelope cursor must be emitted");

    const openCalls = rpcCalls.filter((c) => c.name === "open_trading_floor_keyset_snapshot");
    assert.equal(openCalls.length, 1, "first page must open exactly one snapshot");
    const pageCalls = rpcCalls.filter((c) => c.name === "get_trading_floor_canary_keyset_v4");
    assert.equal(pageCalls.length, 1);
    assert.equal(pageCalls[0].params.p_snapshot_id, SNAPSHOT_ID);
    assert.equal(pageCalls[0].params.p_cursor_listing_id, null);
    assert.ok(!rpcCalls.some((c) => c.name === "get_trading_floor_canary_keyset"), "legacy v2 keyset RPC must not be used");

    // Replay: same cursor + same filters reuses the snapshot, opens no new one
    rpcCalls.length = 0;
    const { req: req2, res: res2 } = createMockReqRes({ pageSize: "1", cursor: body.nextCursor });
    await tradingFloorHandler(req2, res2);
    assert.equal(res2.getStatusCode(), 200);
    assert.equal(rpcCalls.filter((c) => c.name === "open_trading_floor_keyset_snapshot").length, 0);
    const page2 = rpcCalls.find((c) => c.name === "get_trading_floor_canary_keyset_v4");
    assert.equal(page2.params.p_snapshot_id, SNAPSHOT_ID);
    assert.equal(page2.params.p_cursor_listing_id, "row_1");
    assert.equal(page2.params.p_cursor_priced_rank, 1);
  });

  await t.test("8b. TF cursor is built from frozen k_* fields under payload divergence; display payload untouched", async () => {
    rpcCalls.length = 0;
    // Frozen membership price diverges from live payload price (concurrent update)
    tfMock([v4Row(provenanceRow(), { k_price_usd: 31000 })], 50);
    const { req, res } = createMockReqRes({ pageSize: "1" });
    await tradingFloorHandler(req, res);
    assert.equal(res.getStatusCode(), 200);
    const body = res.getBody();
    // Display payload is NOT overwritten by frozen values (truthful divergence)
    assert.equal(body.records[0].price_usd, 32000);
    // Cursor carries the FROZEN membership key
    const decoded = decodeCursorEnvelope(body.nextCursor, { surface: "trading_floor", filters: TF_FILTERS });
    assert.equal(decoded.key.priceUsd, 31000);
    assert.equal(decoded.key.listingId, "row_1");
  });

  await t.test("8c. TF fails closed (never payload-fallback) when frozen key columns are absent", async () => {
    rpcCalls.length = 0;
    const row = v4Row(provenanceRow());
    delete row.k_priced_rank; delete row.k_image_rank; delete row.k_price_usd;
    delete row.k_source_created_at; delete row.k_listing_id;
    tfMock([row], 50);
    const { req, res } = createMockReqRes({ pageSize: "1" });
    await tradingFloorHandler(req, res);
    assert.equal(res.getStatusCode(), 500, "missing frozen keys must fail closed, not emit a payload-derived cursor");
  });

  await t.test("9. TF rejects filter-changed cursor replay with HTTP 400 scope mismatch", async () => {
    rpcCalls.length = 0;
    tfMock([v4Row(provenanceRow())], 50);
    const { req, res } = createMockReqRes({ pageSize: "1" });
    await tradingFloorHandler(req, res);
    const cursor = res.getBody().nextCursor;
    rpcCalls.length = 0;

    const { req: req2, res: res2 } = createMockReqRes({ pageSize: "1", cursor, brand: "Rolex" });
    await tradingFloorHandler(req2, res2);
    assert.equal(res2.getStatusCode(), 400);
    assert.match(res2.getBody().error, /Cursor scope mismatch/);
    assert.equal(rpcCalls.length, 0, "no RPC may fire on a scope-mismatched cursor");
  });

  await t.test("10. TF maps snapshot_expired RPC failure to HTTP 400 with re-open guidance", async () => {
    rpcCalls.length = 0;
    mockRpcHandler = async (name, params = {}) => {
      if (name === "open_trading_floor_keyset_snapshot") return { data: SNAPSHOT_ID, error: null };
      if (name === "get_trading_floor_snapshot_count") return { data: 1, error: null };
      if (name === "get_trading_floor_canary_keyset_v4") {
        return { data: null, error: { code: "22023", message: "snapshot_expired: unknown, wrong-surface, or expired snapshot" } };
      }
      return { data: [], error: null };
    };
    const { req, res } = createMockReqRes({ pageSize: "10" });
    await tradingFloorHandler(req, res);
    assert.equal(res.getStatusCode(), 400);
    assert.match(res.getBody().error, /snapshot expired or unknown/i);
    assert.match(res.getBody().error, /Restart pagination without a cursor/);
  });

  await t.test("10b. TF maps invalid_cursor membership-binding mismatch to HTTP 400", async () => {
    rpcCalls.length = 0;
    tfMock([v4Row(provenanceRow())], 50);
    const { req, res } = createMockReqRes({ pageSize: "1" });
    await tradingFloorHandler(req, res);
    const cursor = res.getBody().nextCursor;

    // Phase 5.1 membership binding: fabricated/mismatched cursor keys rejected DB-side
    mockRpcHandler = async (name, params = {}) => {
      if (name === "open_trading_floor_keyset_snapshot") return { data: SNAPSHOT_ID, error: null };
      if (name === "get_trading_floor_snapshot_count") return { data: 50, error: null };
      if (name === "get_trading_floor_canary_keyset_v4") {
        return { data: null, error: { code: "22023", message: "invalid_cursor: cursor key does not match frozen snapshot member key" } };
      }
      return { data: [], error: null };
    };
    const { req: req2, res: res2 } = createMockReqRes({ pageSize: "1", cursor });
    await tradingFloorHandler(req2, res2);
    assert.equal(res2.getStatusCode(), 400);
    assert.match(res2.getBody().error, /Invalid cursor tuple values/);
  });

  await t.test("11. TF malformed/legacy cursors are HTTP 400, never a silent restart", async () => {
    rpcCalls.length = 0;
    tfMock([], 0);
    const { req, res } = createMockReqRes({ cursor: "%%%garbage%%%" });
    await tradingFloorHandler(req, res);
    assert.equal(res.getStatusCode(), 400);
    assert.match(res.getBody().error, /Malformed cursor/);
    assert.equal(rpcCalls.length, 0);

    const legacy = Buffer.from(JSON.stringify(["v2", 1, 2, 32000, "2026-08-30T00:00:00.000Z", "row_1"]), "utf-8").toString("base64url");
    const { req: req2, res: res2 } = createMockReqRes({ cursor: legacy });
    await tradingFloorHandler(req2, res2);
    assert.equal(res2.getStatusCode(), 400);
    assert.match(res2.getBody().error, /upgraded to the v2 snapshot envelope/);
    assert.equal(rpcCalls.length, 0);
  });

  await t.test("12. PR adopts v3 snapshot RPC and emits envelope cursor", async () => {
    rpcCalls.length = 0;
    prMock({ rows: [v4Row(provenanceRow())] });
    const { req, res } = createMockReqRes({ reference: "116500LN", pageSize: "1" });
    await priceResearchHandler(req, res);
    assert.equal(res.getStatusCode(), 200);
    const body = res.getBody();
    assert.equal(body.success, true);
    assert.equal(body.snapshot, SNAPSHOT_ID);
    assert.ok(body.next_cursor, "PR must emit an envelope cursor when the page is full");
    assert.ok(!rpcCalls.some((c) => c.name === "get_price_research_canary_keyset_v2"), "legacy v2 keyset RPC must not be used");
    const pageCall = rpcCalls.find((c) => c.name === "get_price_research_canary_keyset_v4");
    assert.equal(pageCall.params.p_snapshot_id, SNAPSHOT_ID);

    // Replay with unchanged filters reuses the snapshot
    rpcCalls.length = 0;
    const { req: req2, res: res2 } = createMockReqRes({ reference: "116500LN", pageSize: "1", cursor: body.next_cursor });
    await priceResearchHandler(req2, res2);
    assert.equal(res2.getStatusCode(), 200);
    assert.equal(rpcCalls.filter((c) => c.name === "open_price_research_keyset_snapshot").length, 0);
  });

  await t.test("13. PR maps snapshot_expired to HTTP 400 and rejects WTB demand traversal", async () => {
    mockRpcHandler = async (name, params = {}) => {
      if (name === "open_trading_floor_keyset_snapshot") return { data: DEMAND_SNAPSHOT_ID, error: null };
      if (name === "open_price_research_keyset_snapshot") return { data: SNAPSHOT_ID, error: null };
      if (name === "get_price_research_canary_keyset_v4") {
        return { data: null, error: { code: "22023", message: "snapshot_expired: unknown, wrong-surface, or expired snapshot" } };
      }
      if (name === "get_price_research_snapshot_count" && !params.p_demand) return { data: 0, error: null };
      if (name === "get_price_research_snapshot_count" && params.p_demand) return { data: 0, error: null };
      return { data: [], error: null };
    };
    const { req, res } = createMockReqRes({ reference: "116500LN" });
    await priceResearchHandler(req, res);
    assert.equal(res.getStatusCode(), 400);
    assert.equal(res.getBody().success, false);
    assert.match(res.getBody().error, /snapshot expired or unknown/i);

    // Demand lane is snapshot-keyset paginated (Phase 5.2): legacy OFFSET param
    // demandPage is a hard 400 with migration guidance
    prMock({});
    const { req: req2, res: res2 } = createMockReqRes({ reference: "116500LN", demandPage: "2" });
    await priceResearchHandler(req2, res2);
    assert.equal(res2.getStatusCode(), 400);
    assert.match(res2.getBody().error, /Offset pagination \(demandPage\) is not supported/);

    // Demand page 1 (no cursor) works via the demand keyset RPC
    const { req: req3, res: res3 } = createMockReqRes({ reference: "116500LN", demandPageSize: "20" });
    await priceResearchHandler(req3, res3);
    assert.equal(res3.getStatusCode(), 200);
  });

  await t.test("13b. Demand lane: snapshot-keyset traversal across pages with ties", async () => {
    rpcCalls.length = 0;
    // Demand ordering: k_source_created_at DESC, k_listing_id ASC — rows with TIED
    // timestamps must still paginate deterministically by listing_id.
    const tieTs = "2026-09-05T12:34:56.123456+00:00";
    const demandRowA = v4Row(provenanceRow({ listing_id: "dmd_a", source_id: "src_da", intent: "WTB", source_created_at: tieTs }), { k_source_created_at: tieTs, k_listing_id: "dmd_a" });
    const demandRowB = v4Row(provenanceRow({ listing_id: "dmd_b", source_id: "src_db", intent: "WTB", source_created_at: tieTs }), { k_source_created_at: tieTs, k_listing_id: "dmd_b" });

    // Page 1: full page (size 1) → demand next cursor emitted
    mockRpcHandler = async (name, params = {}) => {
      if (name === "open_price_research_keyset_snapshot") return { data: SNAPSHOT_ID, error: null };
      if (name === "open_trading_floor_keyset_snapshot") return { data: DEMAND_SNAPSHOT_ID, error: null };
      if (name === "get_price_research_wtb_demand_v3") return { data: [demandRowA], error: null };
      if (name === "get_price_research_canary_keyset_v4") return { data: [], error: null };
      if (name === "get_price_research_snapshot_count" && !params.p_demand) return { data: 0, error: null };
      if (name === "get_price_research_snapshot_count" && params.p_demand) return { data: 2, error: null };
      return { data: [], error: null };
    };
    const { req, res } = createMockReqRes({ reference: "116500LN", demandPageSize: "1" });
    await priceResearchHandler(req, res);
    assert.equal(res.getStatusCode(), 200);
    const body = res.getBody();
    assert.equal(body.demand_evidence.snapshot, DEMAND_SNAPSHOT_ID);
    assert.equal(body.demand_evidence.has_more, true);
    const demandCursor = body.demand_evidence.next_cursor;
    assert.ok(demandCursor, "demand lane must emit its own envelope cursor");

    // The demand cursor carries the FROZEN tuple (microsecond timestamp intact)
    const decoded = decodeCursorEnvelope(demandCursor, { surface: "pr_wtb_demand", filters: PR_FILTERS });
    assert.equal(decoded.snapshot, DEMAND_SNAPSHOT_ID);
    assert.equal(decoded.key.createdAt, tieTs);
    assert.equal(decoded.key.listingId, "dmd_a");

    // Page 2 with the tied cursor: full frozen tuple forwarded, no new snapshot opened
    rpcCalls.length = 0;
    mockRpcHandler = async (name, params = {}) => {
      if (name === "open_price_research_keyset_snapshot") return { data: SNAPSHOT_ID, error: null };
      if (name === "get_price_research_wtb_demand_v3") return { data: [demandRowB], error: null };
      if (name === "get_price_research_canary_keyset_v4") return { data: [], error: null };
      if (name === "get_price_research_snapshot_count" && !params.p_demand) return { data: 0, error: null };
      if (name === "get_price_research_snapshot_count" && params.p_demand) return { data: 2, error: null };
      if (name === "get_price_research_scoped_stats_v2") return { data: [], error: null };
      return { data: [], error: null };
    };
    const { req: req2, res: res2 } = createMockReqRes({ reference: "116500LN", demandPageSize: "1", demandCursor });
    await priceResearchHandler(req2, res2);
    assert.equal(res2.getStatusCode(), 200);
    assert.equal(rpcCalls.filter((c) => c.name === "open_trading_floor_keyset_snapshot").length, 0, "demand replay reuses the cursor snapshot");
    const demandCall = rpcCalls.find((c) => c.name === "get_price_research_wtb_demand_v3");
    assert.equal(demandCall.params.p_snapshot_id, DEMAND_SNAPSHOT_ID);
    assert.equal(demandCall.params.p_cursor_created_at, tieTs, "frozen microsecond timestamp forwarded verbatim");
    assert.equal(demandCall.params.p_cursor_listing_id, "dmd_a");
    assert.equal(demandCall.params.p_cursor_priced_rank, 1);
    assert.equal(res2.getBody().demand_rows[0].listing_id, "dmd_b");
  });

  await t.test("13c. Cross-lane cursor rejection: demand cursor on WTS lane and WTS cursor on demand lane", async () => {
    rpcCalls.length = 0;
    // Issue both cursors from one request
    mockRpcHandler = async (name, params = {}) => {
      if (name === "open_price_research_keyset_snapshot") return { data: SNAPSHOT_ID, error: null };
      if (name === "open_trading_floor_keyset_snapshot") return { data: DEMAND_SNAPSHOT_ID, error: null };
      if (name === "get_price_research_canary_keyset_v4") return { data: [v4Row(provenanceRow())], error: null };
      if (name === "get_price_research_wtb_demand_v3") return { data: [v4Row(provenanceRow({ listing_id: "dmd_a", source_id: "src_da", intent: "WTB" }), { k_listing_id: "dmd_a" })], error: null };
      if (name === "get_price_research_snapshot_count" && !params.p_demand) return { data: 1, error: null };
      if (name === "get_price_research_snapshot_count" && params.p_demand) return { data: 1, error: null };
      return { data: [], error: null };
    };
    const { req, res } = createMockReqRes({ reference: "116500LN", pageSize: "1", demandPageSize: "1" });
    await priceResearchHandler(req, res);
    const wtsCursor = res.getBody().next_cursor;
    const demandCursor = res.getBody().demand_evidence.next_cursor;
    assert.ok(wtsCursor && demandCursor && wtsCursor !== demandCursor);

    // WTS cursor replayed on the demand lane → scope mismatch 400, zero RPCs
    rpcCalls.length = 0;
    const { req: req2, res: res2 } = createMockReqRes({ reference: "116500LN", demandCursor: wtsCursor });
    await priceResearchHandler(req2, res2);
    assert.equal(res2.getStatusCode(), 400);
    assert.match(res2.getBody().error, /Invalid demand cursor: Cursor scope mismatch/);
    assert.equal(rpcCalls.length, 0);

    // Demand cursor replayed on the WTS lane → scope mismatch 400, zero RPCs
    const { req: req3, res: res3 } = createMockReqRes({ reference: "116500LN", cursor: demandCursor });
    await priceResearchHandler(req3, res3);
    assert.equal(res3.getStatusCode(), 400);
    assert.match(res3.getBody().error, /Cursor scope mismatch/);
    assert.equal(rpcCalls.length, 0);

    // Wrong-surface SNAPSHOT (demand/TF snapshot id on the WTS lane) with a
    // correctly-scoped cursor → DB rejects with snapshot_expired → HTTP 400
    const wrongSurfaceCursor = encodeCursorEnvelope({
      snapshot: DEMAND_SNAPSHOT_ID, // trading_floor snapshot, not price_research
      scope: computeCursorScope("price_research", PR_FILTERS),
      frozenKey: { k_priced_rank: 1, k_image_rank: 2, k_price_usd: 32000, k_source_created_at: "2026-08-30T00:00:00.000Z", k_listing_id: "row_1" },
    });
    mockRpcHandler = async (name, params = {}) => {
      if (name === "get_price_research_canary_keyset_v4") {
        return { data: null, error: { code: "22023", message: "snapshot_expired: unknown, wrong-surface, or expired snapshot" } };
      }
      if (name === "open_trading_floor_keyset_snapshot") return { data: DEMAND_SNAPSHOT_ID, error: null };
      if (name === "get_price_research_wtb_demand_v3") return { data: [], error: null };
      if (name === "get_price_research_snapshot_count" && !params.p_demand) return { data: 0, error: null };
      if (name === "get_price_research_snapshot_count" && params.p_demand) return { data: 0, error: null };
      return { data: [], error: null };
    };
    const { req: req4, res: res4 } = createMockReqRes({ reference: "116500LN", cursor: wrongSurfaceCursor });
    await priceResearchHandler(req4, res4);
    assert.equal(res4.getStatusCode(), 400);
    assert.match(res4.getBody().error, /snapshot expired or unknown/i);
  });

  await t.test("14. Static scan: V2 handlers contain no OFFSET traversal and no legacy keyset RPC", () => {
    const tfSrc = fs.readFileSync(path.resolve(__dirname, "../api/canary/trading-floor.js"), "utf8");
    const prSrc = fs.readFileSync(path.resolve(__dirname, "../api/canary/price-research.js"), "utf8");

    // v4 snapshot RPCs adopted (v3 was dropped by the 5.1 migration)
    assert.match(tfSrc, /open_trading_floor_keyset_snapshot/);
    assert.match(tfSrc, /get_trading_floor_canary_keyset_v4/);
    assert.match(prSrc, /open_price_research_keyset_snapshot/);
    assert.match(prSrc, /get_price_research_canary_keyset_v4/);

    // Phase 5.2: demand lane is snapshot-keyset via its own trading_floor snapshot
    assert.match(prSrc, /open_trading_floor_keyset_snapshot/);
    assert.match(prSrc, /get_price_research_wtb_demand_v3/);
    assert.match(prSrc, /computeCursorScope\("pr_wtb_demand"/);
    assert.match(prSrc, /assertDemandKeysetOrder/);

    // Legacy keyset/OFFSET RPCs (v2 tuple RPCs, dropped v3, OFFSET demand v2)
    // are no longer referenced
    assert.doesNotMatch(tfSrc, /get_trading_floor_canary_keyset\(/);
    assert.doesNotMatch(tfSrc, /get_trading_floor_canary_keyset_v3/);
    assert.doesNotMatch(prSrc, /get_price_research_canary_keyset_v2\(/);
    assert.doesNotMatch(prSrc, /get_price_research_canary_keyset_v3/);
    assert.doesNotMatch(prSrc, /get_price_research_wtb_demand_v2/);

    // No OFFSET anywhere on the V2 hot paths (demand lane included)
    assert.doesNotMatch(tfSrc, /p_offset/);
    assert.doesNotMatch(prSrc, /p_offset/);

    // Phase 5.1: cursors are built only from frozen k_* membership columns;
    // display records come from the live payload — never the reverse.
    assert.match(tfSrc, /encodeCursorEnvelope\(\{ snapshot: snapshotId, scope: cursorScope, frozenKey: data\[data\.length - 1\] \}\)/);
    assert.match(prSrc, /encodeCursorEnvelope\(\{ snapshot: snapshotId, scope: cursorScope, frozenKey: wtsData\[wtsData\.length - 1\] \}\)/);
    assert.match(tfSrc, /enforceListingDisplayContract\(\(row && row\.payload\) \|\| \{\}\)/);
    assert.match(prSrc, /enforceListingDisplayContract\(\(row && row\.payload\) \|\| \{\}\)/);

    // Offset pagination parameters are hard rejections, not silent fallbacks
    assert.match(tfSrc, /Unsupported pagination mode/);
    assert.match(prSrc, /Offset pagination \(evidencePage\/page\) is not supported/);
    assert.match(prSrc, /Offset pagination \(demandPage\) is not supported/);
  });

  await t.test("15. mapSnapshotRpcError maps only 22023-gated markers (F-B: SQLSTATE required)", () => {
    assert.equal(mapSnapshotRpcError({ code: "22023", message: "snapshot_expired: x" }).statusCode, 400);
    assert.equal(mapSnapshotRpcError({ code: "22023", message: "invalid_cursor: x" }).statusCode, 400);
    assert.equal(mapSnapshotRpcError({ code: "22023", message: "invalid_limit: x" }).statusCode, 400);
    assert.equal(mapSnapshotRpcError({ code: "22023", message: "invalid_ttl: x" }).statusCode, 400);
    assert.equal(mapSnapshotRpcError({ code: "22023", message: "some other database error" }), null);
    // F-B probe: marker text with a non-22023 SQLSTATE must NOT map to 400
    assert.equal(mapSnapshotRpcError({ code: "42501", message: "invalid_cursor: permission denied" }), null);
    assert.equal(mapSnapshotRpcError({ code: "XX000", message: "snapshot_expired: internal" }), null);
    assert.equal(mapSnapshotRpcError({ message: "snapshot_expired: no code at all" }), null);
    assert.equal(mapSnapshotRpcError(new Error("boom")), null);
  });

  await t.test("16. F-A: rank-2 member WITH a price encodes a valid cursor (rank and price are independent)", () => {
    const scope = computeCursorScope("trading_floor", TF_FILTERS);
    // priced_rank=2 occurs legitimately with a price (ineligible but priced row)
    const cursor = encodeCursorEnvelope({
      snapshot: SNAPSHOT_ID,
      scope,
      frozenKey: {
        k_priced_rank: 2,
        k_image_rank: 2,
        k_price_usd: 8000,
        k_source_created_at: "2026-09-05T12:34:56.123456+00:00",
        k_listing_id: "row_rank2_priced",
      },
    });
    const decoded = decodeCursorEnvelope(cursor, { surface: "trading_floor", filters: TF_FILTERS });
    assert.equal(decoded.key.pricedRank, 2);
    assert.equal(decoded.key.priceUsd, 8000);

    // Defensive: rank 1 (priced) without a price is still impossible
    assert.throws(() => encodeCursorEnvelope({
      snapshot: SNAPSHOT_ID, scope,
      frozenKey: { k_priced_rank: 1, k_image_rank: 2, k_price_usd: null, k_source_created_at: "2026-08-30T00:00:00.000Z", k_listing_id: "row_x" },
    }), /Cannot encode priced cursor without frozen USD price/);
    assert.throws(() => decodeCursorEnvelope(makeEnvelope({ key: [1, 2, null, "2026-08-30T00:00:00.000Z", "row_1"] }), { surface: "trading_floor", filters: TF_FILTERS }),
      (err) => err.statusCode === 400 && /Priced cursor is missing USD price/.test(err.message));
  });

  await t.test("17. F-A: rank-2-with-price row as last-on-page emits nextCursor on BOTH surfaces; next page 200 OK", async () => {
    // TF surface
    rpcCalls.length = 0;
    const rank2Priced = v4Row(
      provenanceRow({ listing_id: "row_r2", source_id: "src_r2", price_research_eligible: false, price_usd: 8000 }),
      { k_priced_rank: 2, k_image_rank: 2, k_price_usd: 8000, k_listing_id: "row_r2" },
    );
    tfMock([rank2Priced], 50);
    const { req, res } = createMockReqRes({ pageSize: "1" });
    await tradingFloorHandler(req, res);
    assert.equal(res.getStatusCode(), 200, "TF must not die encoding a rank-2 priced cursor");
    const tfCursor = res.getBody().nextCursor;
    assert.ok(tfCursor, "nextCursor must be emitted for rank-2 priced last row");
    const tfDecoded = decodeCursorEnvelope(tfCursor, { surface: "trading_floor", filters: TF_FILTERS });
    assert.equal(tfDecoded.key.pricedRank, 2);
    assert.equal(tfDecoded.key.priceUsd, 8000);

    rpcCalls.length = 0;
    tfMock([], 50);
    const { req: req2, res: res2 } = createMockReqRes({ pageSize: "1", cursor: tfCursor });
    await tradingFloorHandler(req2, res2);
    assert.equal(res2.getStatusCode(), 200, "TF next page from rank-2 priced cursor must succeed");

    // PR surface (WTS evidence lane)
    prMock({ rows: [v4Row(provenanceRow({ listing_id: "row_r2", source_id: "src_r2" }), { k_priced_rank: 2, k_image_rank: 2, k_price_usd: 8000, k_listing_id: "row_r2" })] });
    const { req: req3, res: res3 } = createMockReqRes({ reference: "116500LN", pageSize: "1" });
    await priceResearchHandler(req3, res3);
    assert.equal(res3.getStatusCode(), 200, "PR must not die encoding a rank-2 priced cursor");
    const prCursor = res3.getBody().next_cursor;
    assert.ok(prCursor);
    const prDecoded = decodeCursorEnvelope(prCursor, { surface: "price_research", filters: PR_FILTERS });
    assert.equal(prDecoded.key.pricedRank, 2);
    assert.equal(prDecoded.key.priceUsd, 8000);

    prMock({ rows: [] });
    const { req: req4, res: res4 } = createMockReqRes({ reference: "116500LN", pageSize: "1", cursor: prCursor });
    await priceResearchHandler(req4, res4);
    assert.equal(res4.getStatusCode(), 200, "PR next page from rank-2 priced cursor must succeed");
  });
});

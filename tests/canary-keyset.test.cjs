"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertKeysetOrder,
  compareKeysetTuple,
  decodeKeysetCursor,
  encodeKeysetCursor,
  isAfterCursor
} = require("../api/_lib/canary-keyset.cjs");
const tradingFloorHandler = require("../api/canary/trading-floor");
const priceResearchHandler = require("../api/canary/price-research");

function listing(id, price, imageRank, createdAt) {
  return {
    listing_id: id,
    priced_rank: price == null ? 2 : 1,
    image_rank: imageRank,
    price_usd: price,
    source_created_at: createdAt
  };
}

test("cursor round-trips all five ordering values", () => {
  const item = listing("listing-7", 12345, 1, "2026-09-02T12:00:00.000Z");
  assert.deepEqual(decodeKeysetCursor(encodeKeysetCursor(item)), {
    pricedRank: 1,
    imageRank: 1,
    priceUsd: 12345,
    createdAt: "2026-09-02T12:00:00.000Z",
    listingId: "listing-7"
  });
});

test("invalid cursors fail closed instead of restarting", () => {
  const invalid = [
    "v1:0",
    "not-base64-json",
    Buffer.from(JSON.stringify(["v2", 1, 1, null, "2026-09-02T12:00:00Z", "x"])).toString("base64url"),
    Buffer.from(JSON.stringify(["v2", 2, 1, 10, "2026-09-02T12:00:00Z", "x"])).toString("base64url"),
    Buffer.from(JSON.stringify(["v2", 1, 1, 10, "not-a-date", "x"])).toString("base64url")
  ];
  for (const cursor of invalid) {
    assert.throws(() => decodeKeysetCursor(cursor), TypeError);
  }
});

test("both HTTP handlers return 400 before making a database request", async () => {
  for (const handler of [tradingFloorHandler, priceResearchHandler]) {
    const result = await new Promise((resolve, reject) => {
      const req = { method: "GET", query: { cursor: "v1:0" } };
      const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(body) { resolve({ statusCode: this.statusCode, body }); }
      };
      handler(req, res).catch(reject);
    });
    assert.equal(result.statusCode, 400);
    assert.match(result.body.error, /Invalid cursor/);
  }
});

test("composite keyset stays stable when rows are inserted or updated concurrently", () => {
  const original = [
    listing("a", 30000, 1, "2026-09-02T12:00:00Z"),
    listing("b", 25000, 1, "2026-09-02T11:00:00Z"),
    listing("c", 25000, 2, "2026-09-02T10:00:00Z"),
    listing("d", 10000, 2, "2026-09-02T09:00:00Z"),
    listing("e", null, 1, "2026-09-02T08:00:00Z"),
    listing("f", null, 2, "2026-09-02T07:00:00Z")
  ].sort(compareKeysetTuple);

  const firstPage = original.slice(0, 3);
  const cursor = decodeKeysetCursor(encodeKeysetCursor(firstPage.at(-1)));

  const insertedBeforeCursor = listing("new-high", 40000, 1, "2026-09-02T13:00:00Z");
  const insertedAfterCursor = listing("new-low", 5000, 2, "2026-09-02T06:00:00Z");
  const updatedAfterCursor = { ...original[4], source_created_at: "2026-09-02T07:30:00Z" };
  const changed = original
    .filter((row) => row.listing_id !== updatedAfterCursor.listing_id)
    .concat(insertedBeforeCursor, insertedAfterCursor, updatedAfterCursor)
    .sort(compareKeysetTuple);

  const secondPage = changed.filter((row) => isAfterCursor(row, cursor));
  const firstIds = new Set(firstPage.map((row) => row.listing_id));
  assert.ok(secondPage.every((row) => !firstIds.has(row.listing_id)), "next page has no prior-page duplicates");
  assert.ok(!secondPage.some((row) => row.listing_id === "new-high"), "new row before cursor is not repeated");
  assert.ok(secondPage.some((row) => row.listing_id === "new-low"), "new row after cursor remains discoverable");
  assert.deepEqual(
    original.slice(3).map((row) => row.listing_id).sort(),
    secondPage.filter((row) => row.listing_id !== "new-low").map((row) => row.listing_id).sort(),
    "all original rows after the cursor remain reachable"
  );
});

test("API order validation fails closed when an RPC returns an out-of-order page", () => {
  const ordered = [
    listing("a", 200, 1, "2026-01-02T00:00:00Z"),
    listing("b", 100, 1, "2026-01-01T00:00:00Z")
  ];
  assert.doesNotThrow(() => assertKeysetOrder(ordered));
  assert.throws(() => assertKeysetOrder([...ordered].reverse()), /outside the required keyset order/);
});

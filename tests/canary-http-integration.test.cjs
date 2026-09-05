"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const url = require("node:url");
const tradingFloorHandler = require("../api/canary/trading-floor");
const priceResearchHandler = require("../api/canary/price-research");

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
      req.query = Object.fromEntries(parsedUrl.searchParams);

      res.status = function(code) {
        this.statusCode = code;
        return this;
      };
      res.json = function(data) {
        this.setHeader("Content-Type", "application/json");
        this.end(JSON.stringify(data));
      };

      if (parsedUrl.pathname.includes("trading-floor")) {
        tradingFloorHandler(req, res);
      } else if (parsedUrl.pathname.includes("price-research")) {
        priceResearchHandler(req, res);
      } else {
        res.status(404).json({ error: "Not found" });
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((resolve) => {
    if (server) {
      server.close(resolve);
    } else {
      resolve();
    }
  });
});

test("Committed Real HTTP Integration & Keyset Pagination Traversal Test", {
  skip: !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY
    ? "requires an explicitly provisioned read-only canary environment"
    : false
}, async (t) => {

  await t.test("1. Trading Floor API - Genuine 5-tuple keyset cursor pagination (0 duplicates, 0 omissions)", async () => {
    let cursor = null;
    let pageCount = 0;
    const allListingIds = [];
    let totalExpected = null;

    do {
      pageCount++;
      const reqUrl = `${baseUrl}/api/canary/trading-floor?pageSize=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const response = await fetch(reqUrl);
      assert.equal(response.status, 200, "HTTP status must be 200 OK");

      const body = await response.json();
      assert.equal(body.status, "ok", "Response status must be 'ok'");
      assert.ok(Array.isArray(body.records), "Records must be an array");
      if (body.records.length === 0) {
        break;
      }

      if (totalExpected === null) {
        totalExpected = body.total;
        assert.equal(totalExpected, 500, "Validated database total must equal 500");
      }

      for (const rec of body.records) {
        assert.ok(rec.listing_id, "Listing ID must be present");
        assert.equal(rec.confidence, null, "Fabricated confidence must be null");
        assert.equal(rec.hasBox, null, "Fabricated hasBox must be null");
        assert.equal(rec.hasPapers, null, "Fabricated hasPapers must be null");
        allListingIds.push(rec.listing_id);
      }

      cursor = body.nextCursor;
      if (cursor) {
        // Assert versioned 5-tuple format: v2
        const decoded = Buffer.from(cursor, "base64url").toString("utf-8");
        const parsed = JSON.parse(decoded);
        assert.equal(parsed[0], "v2", `Cursor must start with v2 (got ${parsed[0]})`);
        assert.equal(parsed.length, 6, "Cursor must contain all 5 tuple fields plus version");
      }
    } while (cursor !== null && pageCount < 20);

    assert.equal(allListingIds.length, 500, "Must fetch all 500 records across pages");
    const uniqueIds = new Set(allListingIds);
    assert.equal(uniqueIds.size, 500, "Must have zero duplicate listing IDs across keyset pagination traversal");
  });

  await t.test("2. Invalid keyset cursor returns HTTP 400 Bad Request", async () => {
    const invalidCursors = [
      "invalid_cursor",
      "v1:offset_not_supported",
      "v2:invalid:tuple:elements"
    ];

    for (const badCursor of invalidCursors) {
      const reqUrl = `${baseUrl}/api/canary/trading-floor?cursor=${encodeURIComponent(badCursor)}`;
      const response = await fetch(reqUrl);
      assert.equal(response.status, 400, `Invalid cursor '${badCursor}' must return HTTP 400`);
      const body = await response.json();
      assert.ok(body.error && body.error.includes("Invalid cursor"), "Error body must explain invalid cursor");
    }
  });

  await t.test("3. Price Research API - Scoped cohort database statistics RPC via HTTP", async () => {
    // 3a. Resolved cohort: Rolex 116506
    const reqUrlScoped = `${baseUrl}/api/canary/price-research?brand=Rolex&reference=116506&dial=&condition=`;
    const resScoped = await fetch(reqUrlScoped);
    assert.equal(resScoped.status, 200, "HTTP status must be 200 OK");
    const bodyScoped = await resScoped.json();
    assert.equal(bodyScoped.success, true);
    assert.ok(bodyScoped.stats, "Stats must exist for resolved cohort");
    assert.equal(bodyScoped.stats.qualified_count, 3);
    assert.equal(bodyScoped.stats.median, 134000);
    assert.equal(bodyScoped.stats.iqr_multiplier, 3.0);

    // 3b. Unresolved cohort returns stats = null
    const reqUrlUnresolved = `${baseUrl}/api/canary/price-research`;
    const resUnresolved = await fetch(reqUrlUnresolved);
    assert.equal(resUnresolved.status, 200);
    const bodyUnresolved = await resUnresolved.json();
    assert.equal(bodyUnresolved.stats, null, "Unresolved cohort must return stats=null");
  });

  await t.test("4. Consecutive live pages do not overlap", async () => {
    // Fetch first page
    const page1Res = await fetch(`${baseUrl}/api/canary/trading-floor?pageSize=20`);
    const page1 = await page1Res.json();
    assert.equal(page1.records.length, 20);
    const page1Ids = new Set(page1.records.map(r => r.listing_id));

    // Fetch next page using keyset cursor
    const page2Res = await fetch(`${baseUrl}/api/canary/trading-floor?pageSize=20&cursor=${encodeURIComponent(page1.nextCursor)}`);
    const page2 = await page2Res.json();
    assert.equal(page2.records.length, 20);

    // Assert zero overlap between consecutive pages
    for (const rec of page2.records) {
      assert.ok(!page1Ids.has(rec.listing_id), `Listing ID ${rec.listing_id} must not appear on both page 1 and page 2`);
    }
  });
});

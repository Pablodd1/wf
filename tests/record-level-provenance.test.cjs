"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execSync } = require("node:child_process");
const tradingFloorHandler = require("../api/canary/trading-floor");

const FIXED_SOURCE_IDS = [
  {
    sourceId: "2ccf95e8-78f6-4dab-9429-187e43bba662",
    expectedHash: "24f5da305949a06bd75626c855475f2d11aa7d811bfcab1d382edf12b7fd1935",
    expectedBrand: "Patek Philippe",
    expectedRef: "7128/1G",
    expectedPrice: 123000,
    expectedIntent: "WTS"
  },
  {
    sourceId: "a16ef456-d523-40a9-9d23-719320a8f2d9",
    expectedHash: "6f5f50b2d1d6729edb30610caf87abf65a001e0735d065fd1060a10bd407ae85",
    expectedBrand: "Patek Philippe",
    expectedRef: "7118/1200R",
    expectedPrice: 153000,
    expectedIntent: "WTS"
  },
  {
    sourceId: "6301d429-796d-4161-9b0c-d565eb94d549",
    expectedHash: "4df2d71a78d68f474ded49571c8d20aa5e1a225212ced2cc1ecad116f84661de",
    expectedBrand: "Richard Mille",
    expectedRef: "RM35-03",
    expectedPrice: 538000,
    expectedIntent: "WTS"
  }
];

async function callTradingFloorApi() {
  const records = [];
  let cursor = null;
  do {
    const page = await new Promise((resolve, reject) => {
      const req = { method: "GET", query: { pageSize: "100", ...(cursor ? { cursor } : {}) } };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; },
      json(data) { resolve(data); }
    };
      tradingFloorHandler(req, res).catch(reject);
    });
    assert.equal(page.status, "ok");
    records.push(...page.records);
    cursor = page.nextCursor;
  } while (cursor);
  return records;
}

function fetchDatabaseProvenance(sourceIds) {
  const cmd = `python tools/mariadb-live/fetch_provenance_batch.py ${sourceIds.join(" ")}`;
  const stdout = execSync(cmd, { encoding: "utf-8" });
  return JSON.parse(stdout.trim());
}

test("Fixed Source ID Record-Level Provenance & Lineage Verification", {
  skip: !process.env.DATABASE_URL || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY
    ? "requires explicitly provisioned read-only database/API credentials"
    : false
}, async (t) => {
  const sourceIds = FIXED_SOURCE_IDS.map(x => x.sourceId);
  const dbRows = fetchDatabaseProvenance(sourceIds);
  assert.equal(dbRows.length, 3, "Database query must return all 3 fixed source records");

  const apiRecords = await callTradingFloorApi();

  for (const item of FIXED_SOURCE_IDS) {
    await t.test(`Trace fixed ID ${item.sourceId.slice(0, 8)} (${item.expectedBrand} ${item.expectedRef})`, async () => {
      const dbRecord = dbRows.find(r => r.source_id === item.sourceId);
      assert.ok(dbRecord, `Database record for ${item.sourceId} must exist`);

      // 1. Immutable Raw / Hash & Proposal Lineage
      assert.equal(dbRecord.raw_source_hash, item.expectedHash, "immutable raw hash must match fixed evidence");
      assert.equal(dbRecord.proposal_source_hash, dbRecord.raw_source_hash);
      assert.equal(dbRecord.canary_source_hash, dbRecord.raw_source_hash);
      assert.equal(dbRecord.view_source_hash, dbRecord.raw_source_hash);
      assert.equal(dbRecord.proposal_brand, item.expectedBrand);
      assert.equal(dbRecord.proposal_reference, item.expectedRef);
      assert.equal(dbRecord.proposal_price_usd, item.expectedPrice);
      assert.equal(dbRecord.proposal_intent, item.expectedIntent);

      // 2. Canonical V2 View Equality
      for (const field of ["brand", "model", "reference", "intent", "price_usd", "condition"]) {
        assert.equal(dbRecord[`canary_${field}`], dbRecord[`proposal_${field}`], `${field}: proposal -> canary`);
        assert.equal(dbRecord[`view_${field}`], dbRecord[`canary_${field}`], `${field}: canary -> view`);
      }
      assert.equal(dbRecord.view_listing_id, dbRecord.canary_listing_id);
      assert.equal(dbRecord.view_dial_color, dbRecord.canary_dial_color);
      assert.equal(dbRecord.view_image_key, dbRecord.canary_image_key);
      assert.equal(dbRecord.view_price_status, dbRecord.canary_price_status);
      assert.equal(dbRecord.view_contact_available, dbRecord.canary_contact_available);

      // 3. API Output Verification
      const apiRecord = apiRecords.find(r => r.source_id === item.sourceId);
      assert.ok(apiRecord, `API output must include listing with source_id ${item.sourceId}`);

      assert.equal(apiRecord.source_hash, dbRecord.view_source_hash);
      assert.equal(apiRecord.brand, dbRecord.view_brand);
      assert.equal(apiRecord.model, dbRecord.view_model);
      assert.equal(apiRecord.reference, dbRecord.view_reference);
      assert.equal(apiRecord.price, dbRecord.view_price_usd);
      assert.equal(apiRecord.intent, dbRecord.view_intent);
      assert.equal(apiRecord.condition, dbRecord.view_condition);
      assert.equal(apiRecord.dial_color, dbRecord.view_dial_color);
      assert.equal(apiRecord.image_key, dbRecord.view_image_key);
      assert.equal(apiRecord.price_status, dbRecord.view_price_status);
      assert.equal(apiRecord.confidence, null, "Fabricated confidence must be null");
      assert.equal(apiRecord.hasBox, null, "Fabricated hasBox must be null");
      assert.equal(apiRecord.hasPapers, null, "Fabricated hasPapers must be null");
      assert.equal(apiRecord.contact_available, dbRecord.view_contact_available);
    });
  }
});

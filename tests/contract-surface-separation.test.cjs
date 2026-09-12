"use strict";

/**
 * PHASE 6: Trading Floor vs Price Research contract surface separation.
 *
 * Proves:
 * - ONE shared ListingDisplayContract; both canary surfaces emit all 52 keys with
 *   truthful nulls (never omitted keys, never invented fallback strings).
 * - Trading Floor admits unpriced WTS, WTB, unknown-intent, and no-image records
 *   truthfully; surface admission is independent of Price Research eligibility.
 * - Price Research is qualified WTS only: WTB / unpriced / unresolved-currency
 *   records can never carry price_research_eligible=true; unresolved cohorts
 *   yield stats=null with an explicit explanation.
 * - Bundle parents are suppressed from the TF surface once accepted children
 *   exist (forward migration), and the PR ready view hard-filters intent='WTS'.
 */

const test = require("node:test");
const { emptyBreakdown } = require("./helpers/snapshot-breakdown-fixture.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Mock Supabase module before requiring handlers (same pattern as canary-api-contracts)
const supabasePath = path.resolve(__dirname, "../api/_lib/supabase.js");
let mockRpcHandler = () => Promise.resolve({ data: [], error: null });

require.cache[supabasePath] = {
  id: supabasePath,
  filename: supabasePath,
  loaded: true,
  exports: {
    getClient: () => ({
      rpc: (name, params) => name === 'get_price_research_snapshot_membership'
        ? Promise.resolve({ data: params.p_listing_ids.map(listing_id => ({ listing_id, exclusion_reason: null })), error: null })
        : mockRpcHandler(name, params),
    })
  }
};

const tradingFloorHandler = require("../api/canary/trading-floor");
const priceResearchHandler = require("../api/canary/price-research");
const {
  CANONICAL_CONTRACT_KEYS,
  enforceListingDisplayContract,
} = require("../shared/listing-display-contract.cjs");

const HASH_A = "a1b2c3d4".repeat(8);
const HASH_B = "b2c3d4e5".repeat(8);
const HASH_C = "c3d4e5f6".repeat(8);
const HASH_D = "d4e5f6a7".repeat(8);

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

let rowCounter = 0;
function provenanceRow(overrides = {}) {
  rowCounter += 1;
  return {
    listing_id: `tf_row_${rowCounter}`,
    source_id: `src_${rowCounter}`,
    source_hash: HASH_A,
    source_created_at: "2026-08-30T00:00:00.000Z",
    observed_at: "2026-08-30T01:00:00.000Z",
    category: null,
    brand: null,
    model: null,
    reference: null,
    dial_color: null,
    condition: null,
    intent: null,
    title: null,
    description: null,
    original_price_text: null,
    original_price_amount: null,
    original_price_currency: null,
    price_usd: null,
    fx_rate: null,
    fx_source: null,
    fx_date: null,
    image_key: null,
    seller_display_name: null,
    location_country: null,
    is_bundle: false,
    ...overrides,
  };
}

const UNPRICED_WTS = provenanceRow({
  intent: "WTS",
  brand: "Rolex",
  reference: "116500LN",
  priced_rank: 2,
  image_rank: 2,
});

const WTB_ROW = provenanceRow({
  intent: "WTB",
  brand: "Rolex",
  reference: "126610LN",
  // Even if the staged row wrongly claims eligibility, the contract must strip it.
  price_research_eligible: true,
  original_price_text: "budget 30000",
  original_price_amount: 30000,
  original_price_currency: "USD",
  price_usd: 30000,
  priced_rank: 2,
  image_rank: 2,
});

const UNKNOWN_INTENT_ROW = provenanceRow({
  brand: "Omega",
  priced_rank: 2,
  image_rank: 2,
});

const NO_IMAGE_PRICED_WTS = provenanceRow({
  intent: "WTS",
  brand: "Rolex",
  reference: "116500LN",
  original_price_text: "USD 32,000",
  original_price_amount: 32000,
  original_price_currency: "USD",
  price_usd: 32000,
  price_research_eligible: true,
  priced_rank: 1,
  image_rank: 2,
});

// Rows must already satisfy the five-field keyset order:
// priced_rank ASC, image_rank ASC, price_usd DESC NULLS LAST, source_created_at DESC, listing_id ASC
const TF_ROWS = [
  NO_IMAGE_PRICED_WTS, // priced_rank 1
  { ...WTB_ROW },      // priced_rank 2 with a price sorts before null-price rows
  { ...UNPRICED_WTS }, // priced_rank 2, null price, listing_id asc
  { ...UNKNOWN_INTENT_ROW },
];

function mockTradingFloorRpc(rows) {
  mockRpcHandler = async (name, params = {}) => {
    // Phase 5/5.1: snapshot opener + v4 keyset rows (frozen k_* + live payload).
    if (name === "open_trading_floor_keyset_snapshot") return { data: "00000000-0000-4000-8000-000000000001", error: null };
    if (name === "get_trading_floor_snapshot_count") return { data: rows.length, error: null };
    if (name === "get_trading_floor_canary_keyset_v4") return {
      data: rows.map((r) => ({
        k_priced_rank: r.priced_rank ?? 2,
        k_image_rank: r.image_rank ?? 2,
        k_price_usd: r.price_usd ?? null,
        k_source_created_at: r.source_created_at,
        k_listing_id: r.listing_id,
        payload: r,
      })),
      error: null,
    };
    return { data: [], error: null };
  };
}

function mockPriceResearchRpc({ wtsRows = [], statsRow = null, wtbRows = [] } = {}) {
  mockRpcHandler = async (name, params = {}) => {
    if (name === "get_price_research_snapshot_count" && !params.p_demand) return { data: wtsRows.length, error: null };
    if (name === "get_price_research_snapshot_count" && params.p_demand) return { data: wtbRows.length, error: null };
    if (name === "get_price_research_snapshot_facets") return { data: [], error: null };
    if (name === "get_price_research_snapshot_breakdown") {
      return {
        data: [{
          ...emptyBreakdown(),
          source_observations: wtsRows.length + wtbRows.length,
          wts_count: wtsRows.length,
          wtb_count: wtbRows.length,
          unique_qualified_offers: wtsRows.length,
          included_count: wtsRows.length,
          retained_audit_evidence_count: wtbRows.length,
          iqr_outliers_count: 0,
          excluded_not_wts: wtbRows.length,
          excluded_unresolved_currency: 0,
          excluded_ineligible_flag: 0,
          excluded_duplicate_repost: 0,
        }],
        error: null,
      };
    }
    if (name === "get_price_research_snapshot_stats") {
      return { data: statsRow ? [statsRow] : [], error: null };
    }
    if (name === "open_price_research_keyset_snapshot") return { data: "00000000-0000-4000-8000-000000000002", error: null };
    if (name === "get_price_research_demand_snapshot") return { data: "00000000-0000-4000-8000-000000000003", error: null };
    const keysetWrap = (r) => ({
      k_priced_rank: r.priced_rank ?? 2,
      k_image_rank: r.image_rank ?? 2,
      k_price_usd: r.price_usd ?? null,
      k_source_created_at: r.source_created_at,
      k_listing_id: r.listing_id,
      payload: r,
    });
    if (name === "get_price_research_canary_keyset_v4") return { data: wtsRows.map(keysetWrap), error: null };
    if (name === "get_price_research_wtb_demand_v3") return { data: wtbRows.map(keysetWrap), error: null };
    return { data: [], error: null };
  };
}

test("Phase 6: Trading Floor vs Price Research surface separation", async (t) => {

  await t.test("1. TF admits unpriced WTS, WTB, unknown-intent and no-image records with truthful nulls", async () => {
    mockTradingFloorRpc(TF_ROWS);
    const { req, res } = createMockReqRes({ pageSize: "50" });
    await tradingFloorHandler(req, res);
    assert.equal(res.getStatusCode(), 200);
    const records = res.getBody().records;
    assert.equal(records.length, 4);

    const byId = Object.fromEntries(records.map((r) => [r.listing_id, r]));

    // Unpriced WTS is shown truthfully
    const unpriced = byId[UNPRICED_WTS.listing_id];
    assert.equal(unpriced.intent, "WTS");
    assert.equal(unpriced.price_usd, null);
    assert.equal(unpriced.price_status, "PRICE_NOT_SUPPLIED");
    assert.equal(unpriced.price_research_eligible, false);

    // WTB is admitted to TF but never PR-eligible (even if the row claimed it)
    const wtb = byId[WTB_ROW.listing_id];
    assert.equal(wtb.intent, "WTB");
    assert.equal(wtb.price_research_eligible, false);
    assert.equal(wtb.included_in_statistics, false);

    // Unknown intent admitted with fail-closed review flags, never fabricated
    const unknown = byId[UNKNOWN_INTENT_ROW.listing_id];
    assert.equal(unknown.intent, null);
    assert.equal(unknown.review_status, "REVIEW_REQUIRED");
    assert.ok(unknown.review_reasons.includes("UNKNOWN_OR_UNRESOLVED_INTENT"));
    assert.equal(unknown.included_in_statistics, false);
    assert.equal(unknown.price_research_eligible, false);

    // No-image record: truthful nulls, NO_IMAGE evidence
    const noImage = byId[NO_IMAGE_PRICED_WTS.listing_id];
    assert.equal(noImage.image_url, null);
    assert.equal(noImage.image_key, null);
    assert.equal(noImage.image_evidence_type, "NO_IMAGE");
  });

  await t.test("2. TF payloads carry every canonical contract key with explicit nulls (never omitted)", async () => {
    mockTradingFloorRpc(TF_ROWS);
    const { req, res } = createMockReqRes({ pageSize: "50" });
    await tradingFloorHandler(req, res);
    assert.equal(res.getStatusCode(), 200);
    assert.equal(CANONICAL_CONTRACT_KEYS.length, 52);
    for (const rec of res.getBody().records) {
      for (const key of CANONICAL_CONTRACT_KEYS) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(rec, key),
          `TF record ${rec.listing_id} missing canonical key "${key}"`,
        );
      }
    }
  });

  await t.test("3. PR rejects exactly the records TF lawfully shows", () => {
    // WTB with a price claim can never be PR-eligible or in statistics
    const wtb = enforceListingDisplayContract({
      source_id: "src_wtb",
      source_hash: HASH_B,
      intent: "WTB",
      original_price_amount: 30000,
      original_price_currency: "USD",
      price_usd: 30000,
      price_research_eligible: true,
      included_in_statistics: true,
    });
    assert.equal(wtb.price_research_eligible, false);
    assert.equal(wtb.included_in_statistics, false);

    // Unpriced WTS: TF-valid, PR-ineligible
    const unpriced = enforceListingDisplayContract({
      source_id: "src_unpriced",
      source_hash: HASH_B,
      intent: "WTS",
    });
    assert.equal(unpriced.price_status, "PRICE_NOT_SUPPLIED");
    assert.equal(unpriced.price_research_eligible, false);
    assert.equal(unpriced.included_in_statistics, false);

    // Unresolved-currency WTS: TF-valid with review flag, PR-ineligible
    const bareDollar = enforceListingDisplayContract({
      source_id: "src_bare",
      source_hash: HASH_B,
      intent: "WTS",
      original_price_text: "$32,000",
      original_price_amount: 32000,
      price_usd: 32000,
      price_research_eligible: true,
    });
    assert.equal(bareDollar.price_status, "UNRESOLVED_CURRENCY");
    assert.equal(bareDollar.price_research_eligible, false);
    assert.equal(bareDollar.included_in_statistics, false);
  });

  await t.test("4. PR admits qualified priced WTS and computes 3.0xIQR cohort stats", async () => {
    const qualifiedRow = provenanceRow({
      intent: "WTS",
      brand: "Rolex",
      model: "Daytona",
      reference: "116500LN",
      dial_color: "Black",
      condition: "Unworn",
      original_price_text: "USD 32,000",
      original_price_amount: 32000,
      original_price_currency: "USD",
      price_usd: 32000,
      price_research_eligible: true,
      included_in_statistics: true,
      priced_rank: 1,
      image_rank: 2,
    });
    const statsRow = {
      qualified_count: 5,
      avg_price: 31000,
      min_price: 29000,
      max_price: 34000,
      median_price: 31000,
      q1_price: 30000,
      q3_price: 32000,
      iqr: 2000,
      lower_fence: Math.max(0, 30000 - 3.0 * 2000),
      upper_fence: 32000 + 3.0 * 2000,
      iqr_multiplier: 3.0,
    };
    mockPriceResearchRpc({ wtsRows: [qualifiedRow], statsRow });

    const { req, res } = createMockReqRes({
      brand: "Rolex",
      reference: "116500LN",
      dial: "Black",
      condition: "Unworn",
      pageSize: "10",
    });
    await priceResearchHandler(req, res);
    assert.equal(res.getStatusCode(), 200);
    const body = res.getBody();
    assert.equal(body.success, true);
    assert.ok(body.stats, "qualified exact cohort must produce stats");
    assert.equal(body.stats.iqr_multiplier, 3.0);
    assert.equal(body.stats.lower_fence, 24000);
    assert.equal(body.stats.upper_fence, 38000);
    assert.equal(body.evidence.items.length, 1);
    const item = body.evidence.items[0];
    assert.equal(item.intent, "WTS");
    assert.equal(item.price_research_eligible, true);
    assert.equal(item.included_in_statistics, true);
    for (const key of CANONICAL_CONTRACT_KEYS) {
      assert.ok(Object.prototype.hasOwnProperty.call(item, key), `PR evidence item missing key "${key}"`);
    }
  });

  await t.test("5. Unresolved cohort yields stats=null with explicit explanation", async () => {
    mockPriceResearchRpc({ wtsRows: [], statsRow: null });
    const { req, res } = createMockReqRes({ reference: "116500LN" });
    await priceResearchHandler(req, res);
    assert.equal(res.getStatusCode(), 200);
    const body = res.getBody();
    assert.equal(body.success, true);
    assert.equal(body.stats, null);
    assert.equal(body.summary, null);
    assert.ok(typeof body.stats_explanation === "string" && body.stats_explanation.length > 0);
    assert.equal(body.analytics_ready, false);
  });

  await t.test("6. Bundle parent suppression + PR WTS-only hard filter exist in the forward migration", () => {
    const migrationPath = path.resolve(__dirname, "../supabase/migrations/20260906120000_phase6_surface_separation_forward.sql");
    assert.ok(fs.existsSync(migrationPath), "phase 6 forward migration must exist");
    const sql = fs.readFileSync(migrationPath, "utf8");

    // TF view: bundle parent suppressed when accepted (published) children exist
    assert.match(sql, /CREATE OR REPLACE VIEW public\.trading_floor_ready_view_v2/);
    assert.match(sql, /v\.is_bundle IS TRUE/);
    assert.match(sql, /v\.parent_listing_id IS NULL/);
    assert.match(sql, /EXISTS[\s\S]*c\.parent_listing_id = v\.listing_id/);

    // PR view: qualified WTS only — intent hard filter, not just the eligibility flag
    assert.match(sql, /CREATE OR REPLACE VIEW public\.price_research_ready_view_v2/);
    assert.match(sql, /v\.intent = 'WTS'/);
    assert.match(sql, /v\.price_research_eligible IS TRUE/);
    assert.match(sql, /v\.price_usd > 0/);

    // Source-backed USD or verified dated FX only
    assert.match(sql, /upper\(v\.original_price_currency\) = 'USD'/);
    assert.match(sql, /v\.fx_rate > 0/);
    assert.match(sql, /v\.fx_date IS NOT NULL/);
  });

  await t.test("7. No invented fallback strings in the V2 API path", async () => {
    const root = path.resolve(__dirname, "..");
    const sources = [
      "api/canary/trading-floor.js",
      "api/canary/price-research.js",
      "shared/listing-display-contract.cjs",
    ].map((rel) => fs.readFileSync(path.join(root, rel), "utf8")).join("\n");
    assert.doesNotMatch(sources, /Watch Listing/);
    assert.doesNotMatch(sources, /Anonymous Seller/);
    assert.doesNotMatch(sources, /Unknown Seller/);

    // Payload-level: null seller/title stay null through the TF API (no fabrication)
    mockTradingFloorRpc([{ ...UNKNOWN_INTENT_ROW }]);
    const { req, res } = createMockReqRes({ pageSize: "50" });
    await tradingFloorHandler(req, res);
    const rec = res.getBody().records[0];
    assert.equal(rec.seller_display_name, null);
    assert.equal(rec.seller_profile_url, null);
    assert.equal(rec.title, null);
    assert.equal(rec.brand, "Omega");
    assert.equal(rec.reference, null);
    assert.equal(rec.contact_available, false);
  });

  await t.test("8. Eligibility independence: TF admission never implies PR eligibility and vice versa", async () => {
    // A record visible on TF with eligible=false proves TF admission is not gated
    // on the PR flag; the same row through PR's contract path stays ineligible.
    mockTradingFloorRpc([{ ...NO_IMAGE_PRICED_WTS }, { ...WTB_ROW }]);
    const { req, res } = createMockReqRes({ pageSize: "50" });
    await tradingFloorHandler(req, res);
    const records = res.getBody().records;
    assert.equal(records.length, 2, "TF admits both WTB and priced WTS");
    const wtb = records.find((r) => r.intent === "WTB");
    assert.equal(wtb.price_research_eligible, false, "TF surface must not leak PR eligibility onto WTB");

    // Conversely the PR keyset and TF keyset are distinct admission paths
    // (separate RPCs, separate ready views).
    const tfSrc = fs.readFileSync(path.resolve(__dirname, "../api/canary/trading-floor.js"), "utf8");
    const prSrc = fs.readFileSync(path.resolve(__dirname, "../api/canary/price-research.js"), "utf8");
    assert.match(tfSrc, /get_trading_floor_canary_keyset/);
    assert.doesNotMatch(tfSrc, /price_research_ready_view_v2|get_price_research_canary_keyset/);
    assert.match(prSrc, /get_price_research_canary_keyset_v4/);
    assert.doesNotMatch(prSrc, /get_trading_floor_canary_keyset\(/);
  });
});

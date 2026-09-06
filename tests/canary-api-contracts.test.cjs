"use strict";

const test = require("node:test");
const { emptyBreakdown } = require("./helpers/snapshot-breakdown-fixture.cjs");
const assert = require("node:assert/strict");
const path = require("node:path");

// Mock Supabase module before requiring handlers
const supabasePath = path.resolve(__dirname, "../api/_lib/supabase.js");
let mockRpcHandler = () => Promise.resolve({ data: [], error: null });
let mockCountHandler = () => Promise.resolve({ data: 0, error: null });
let mockSelectHandler = () => Promise.resolve({ count: 0, error: null });

require.cache[supabasePath] = {
  id: supabasePath,
  filename: supabasePath,
  loaded: true,
  exports: {
    getClient: () => ({
      rpc: (name, params) => {
        if (name === "get_price_research_demand_snapshot") return Promise.resolve({ data: "00000000-0000-4000-8000-000000000000", error: null });
        if (name === "get_price_research_snapshot_breakdown") return Promise.resolve({ data: [emptyBreakdown()], error: null });
        if (name === "get_trading_floor_snapshot_count" || name === "get_price_research_snapshot_count") {
          return mockCountHandler(name, params);
        }
        // Phase 5: snapshot constructors return a snapshot id (uuid string)
        if (name === "open_trading_floor_keyset_snapshot" || name === "open_price_research_keyset_snapshot") {
          return Promise.resolve({ data: "00000000-0000-4000-8000-000000000000", error: null });
        }
        return mockRpcHandler(name, params);
      },
      from: (view) => ({
        select: (cols, opts) => ({
          eq: function() { return this; },
          is: function() { return this; },
          then: (resolve) => resolve(mockSelectHandler(view, cols, opts))
        })
      })
    })
  }
};

const tradingFloorHandler = require("../api/canary/trading-floor");
const priceResearchHandler = require("../api/canary/price-research");
const { enforceListingDisplayContract } = require("../shared/listing-display-contract.cjs");
const { encodeKeysetCursor } = require("../api/_lib/canary-keyset.cjs");

function createMockReqRes(query = {}) {
  const req = {
    method: "GET",
    query: query,
  };
  let statusCode = 200;
  let jsonBody = null;

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      jsonBody = data;
      return this;
    },
    getStatusCode: () => statusCode,
    getBody: () => jsonBody
  };

  return { req, res };
}

test("Phase 1 & 2: API Contract and Parameter Validation Test Suite", async (t) => {

  await t.test("1. Trading Floor accepts exact default and filtered URLs constructed by TradingFloor.tsx", async () => {
    mockCountHandler = async () => ({ data: 42, error: null });
    mockRpcHandler = async () => ({ data: [], error: null });

    // Exact URL 1: TradingFloor.tsx line 316-324 (loadRandomAllInventory per-brand query)
    const { req: req1, res: res1 } = createMockReqRes({
      brand: "Rolex",
      pageSize: "12",
      pagination: "cursor",
      type: "WTS",
      images: "true",
      priced: "true",
      region: "US,UK"
    });
    await tradingFloorHandler(req1, res1);
    assert.equal(res1.getStatusCode(), 200);
    assert.equal(res1.getBody().status, "ok");

    // Exact URL 2: TradingFloor.tsx line 769-777 (main load query with filters)
    const { req: req2, res: res2 } = createMockReqRes({
      pageSize: "50",
      pagination: "cursor",
      brand: "Rolex",
      model: "Submariner",
      type: "WTS",
      q: "126610LN",
      images: "true",
      priced: "true",
      region: "US"
    });
    await tradingFloorHandler(req2, res2);
    assert.equal(res2.getStatusCode(), 200);
    assert.equal(res2.getBody().status, "ok");

    // Exact URL 3: TradingFloor.tsx line 781-782 (category filter for non-watch items)
    const { req: req3, res: res3 } = createMockReqRes({
      pageSize: "50",
      pagination: "cursor",
      quality: "market",
      item: "handbags"
    });
    await tradingFloorHandler(req3, res3);
    assert.equal(res3.getStatusCode(), 200);
    assert.equal(res3.getBody().status, "ok");
  });

  await t.test("2. Trading Floor rejects unknown parameters with HTTP 400", async () => {
    const { req, res } = createMockReqRes({
      pageSize: "50",
      pagination: "cursor",
      unknown_filter: "bad_value"
    });
    await tradingFloorHandler(req, res);
    assert.equal(res.getStatusCode(), 400);
    assert.match(res.getBody().error, /Unsupported filter parameter: "unknown_filter"/);
  });

  await t.test("3. Trading Floor rejects malformed booleans with HTTP 400", async () => {
    const malformed = ["10junk", "maybe", "yes_please", "2", "true-ish"];
    for (const val of malformed) {
      const { req: reqImg, res: resImg } = createMockReqRes({ pageSize: "50", images: val });
      await tradingFloorHandler(reqImg, resImg);
      assert.equal(resImg.getStatusCode(), 400, `Expected 400 for images=${val}`);
      assert.match(resImg.getBody().error, /Invalid boolean/);

      const { req: reqPriced, res: resPriced } = createMockReqRes({ pageSize: "50", priced: val });
      await tradingFloorHandler(reqPriced, resPriced);
      assert.equal(resPriced.getStatusCode(), 400, `Expected 400 for priced=${val}`);
      assert.match(resPriced.getBody().error, /Invalid boolean/);
    }
  });

  await t.test("4. Trading Floor rejects partially numeric and invalid limits with HTTP 400", async () => {
    const invalidLimits = ["10junk", "50abc", "-5", "0", "101", "12.34", "NaN"];
    for (const val of invalidLimits) {
      const { req, res } = createMockReqRes({ pageSize: val });
      await tradingFloorHandler(req, res);
      assert.equal(res.getStatusCode(), 400, `Expected 400 for pageSize=${val}`);
      assert.match(res.getBody().error, /Invalid integer|outside allowed range/);
    }
  });

  await t.test("5. Trading Floor rejects invalid intent values with HTTP 400", async () => {
    const { req, res } = createMockReqRes({ type: "RENT" });
    await tradingFloorHandler(req, res);
    assert.equal(res.getStatusCode(), 400);
    assert.match(res.getBody().error, /Invalid intent/);
  });

  await t.test("5b. Trading Floor rejects pagination=offset with HTTP 400", async () => {
    const { req, res } = createMockReqRes({ pagination: "offset" });
    await tradingFloorHandler(req, res);
    assert.equal(res.getStatusCode(), 400);
    assert.match(res.getBody().error, /Unsupported pagination mode: "offset"/);
  });

  await t.test("6. Price Research accepts exact URLs constructed by PriceResearch.tsx", async () => {
    mockSelectHandler = async () => ({ count: 15, error: null });
    mockRpcHandler = async (name) => {
      if (name === "get_price_research_snapshot_stats") {
        return {
          data: [{
            qualified_count: 5,
            avg_price: 15000,
            min_price: 14000,
            max_price: 16000,
            median_price: 15000,
            q1_price: 14500,
            q3_price: 15500,
            iqr: 1000,
            lower_fence: 11500,
            upper_fence: 18500,
            iqr_multiplier: 3.0
          }],
          error: null
        };
      }
      return { data: [], error: null };
    };

    // Exact URL from PriceResearch.tsx using keyset cursor and demand pagination.
    // Phase 5.2: the demand lane is snapshot-keyset paginated via demandCursor;
    // the legacy OFFSET param demandPage is a hard 400 (covered by test 8).
    const { req, res } = createMockReqRes({
      reference: "116500LN",
      brand: "Rolex",
      dial: "Black",
      pageSize: "100",
      demandPageSize: "20"
    });
    await priceResearchHandler(req, res);
    assert.equal(res.getStatusCode(), 200);
    assert.equal(res.getBody().success, true);
    assert.equal(res.getBody().reference, "116500LN");
    assert.equal(res.getBody().evidence.comparable_page_size, 100);
    assert.equal(res.getBody().demand_evidence.page_size, 20);
    assert.ok(res.getBody().demand_evidence.snapshot, "demand lane must run on its own trading_floor snapshot");
    assert.ok(Object.prototype.hasOwnProperty.call(res.getBody().demand_evidence, "next_cursor"));
    assert.equal(typeof res.getBody().demand_evidence.has_more, "boolean");
  });

  await t.test("6b. Price Research rejects offset pagination (evidencePage, page) with HTTP 400", async () => {
    const { req: req1, res: res1 } = createMockReqRes({
      reference: "116500LN",
      evidencePage: "1"
    });
    await priceResearchHandler(req1, res1);
    assert.equal(res1.getStatusCode(), 400);
    assert.match(res1.getBody().error, /Offset pagination \(evidencePage\/page\) is not supported/);

    const { req: req2, res: res2 } = createMockReqRes({
      reference: "116500LN",
      page: "2"
    });
    await priceResearchHandler(req2, res2);
    assert.equal(res2.getStatusCode(), 400);
    assert.match(res2.getBody().error, /Offset pagination \(evidencePage\/page\) is not supported/);
  });

  await t.test("7. Price Research rejects unknown parameters with HTTP 400", async () => {
    const { req, res } = createMockReqRes({
      reference: "116500LN",
      unsupported_filter: "value"
    });
    await priceResearchHandler(req, res);
    assert.equal(res.getStatusCode(), 400);
    assert.match(res.getBody().error, /Unsupported filter parameter: "unsupported_filter"/);
  });

  await t.test("8. Price Research rejects partially numeric limit and page parameters with HTTP 400", async () => {
    const invalidValues = ["10junk", "1abc", "-1", "0", "1.5"];
    for (const val of invalidValues) {
      const { req: reqSize, res: resSize } = createMockReqRes({ reference: "116500LN", pageSize: val });
      await priceResearchHandler(reqSize, resSize);
      assert.equal(resSize.getStatusCode(), 400, `Expected 400 for pageSize=${val}`);

      const { req: reqDemandPage, res: resDemandPage } = createMockReqRes({ reference: "116500LN", demandPage: val });
      await priceResearchHandler(reqDemandPage, resDemandPage);
      assert.equal(resDemandPage.getStatusCode(), 400, `Expected 400 for demandPage=${val}`);
    }
  });

  await t.test("9. Non-empty response formatting: no TypeError on assignment and all required UI fields exist", async () => {
    const fixtureRow = {
      contract_version: "v2.0",
      listing_id: "canary_test_001",
      source_id: "src_001",
      source_hash: "a".repeat(64),
      raw_message_id: "msg_src_001",
      raw_message_text: "FS: Rolex Daytona 116500LN $32000",
      source_context_text: null,
      source_created_at: new Date().toISOString(),
      observed_at: new Date().toISOString(),
      category: null, // intentionally null
      brand: "Rolex",
      model: "Daytona",
      reference: "116500LN",
      dial_color: "Black",
      year: null,
      condition: "Unworn",
      intent: "WTS",
      intent_status: "INTENT_EXPLICIT_WTS",
      title: null,
      description: null,
      original_price_text: "$32,000",
      original_price_amount: 32000,
      original_price_currency: "USD",
      price_usd: 32000,
      fx_rate: null,
      fx_source: null,
      fx_date: null,
      price_status: "VERIFIED_USD",
      price_research_eligible: true,
      included_in_statistics: true,
      statistics_exclusion_reason: null,
      image_url: "https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full/daytona.jpg",
      thumbnail_url: "https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full/daytona.jpg",
      image_key: "daytona.jpg",
      image_evidence_type: "SOURCE_LINKED_IMAGE",
      image_status: "SOURCE_IMAGE_PRESENT",
      seller_id: null,
      seller_display_name: "RolexDealer",
      seller_profile_url: null,
      seller_review_count: null, // unknown count
      seller_listing_count: null,
      seller_wts_count: null,
      seller_wtb_count: null,
      contact_available: false,
      location_country: "US",
      location_region: "NY",
      is_bundle: false,
      bundle_child_count: null,
      review_status: "REVIEW_NOT_REQUIRED",
      review_reasons: []
    };

    // Phase 5.1: v4 keyset RPCs return frozen membership columns + live payload
    mockRpcHandler = async () => ({
      data: [{
        k_priced_rank: fixtureRow.priced_rank ?? 1,
        k_image_rank: fixtureRow.image_rank ?? 2,
        k_price_usd: fixtureRow.price_usd ?? null,
        k_source_created_at: fixtureRow.source_created_at,
        k_listing_id: fixtureRow.listing_id,
        payload: fixtureRow
      }],
      error: null
    });
    mockCountHandler = async () => ({ data: 1, error: null });

    const { req, res } = createMockReqRes({ pageSize: "10" });
    // This must execute cleanly with NO TypeError on field assignment
    await tradingFloorHandler(req, res);
    assert.equal(res.getStatusCode(), 200);

    const body = res.getBody();
    assert.equal(body.records.length, 1);
    const rec = body.records[0];

    // Check JSON serialization of compatibility properties
    assert.equal(rec.id, "canary_test_001");
    assert.equal(rec.price, 32000);
    assert.equal(rec.sellerName, "RolexDealer");
    assert.equal(rec.seller_name, "RolexDealer");
    assert.equal(rec.imageUrl, "https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full/daytona.jpg");
    assert.equal(rec.listing_type, "WTS");
    assert.equal(rec.bundle_status, "SINGLE_LISTING");
    assert.equal(rec.raw_message_available, true);
    assert.equal(rec.price_display_verified, true);
    assert.equal(rec.price_evidence_status, "SOURCE_EXPLICIT_USD_MATCH");
    assert.equal(rec.contract_version, "v2.0");
    assert.equal(rec.listing_display_contract_version, "v2.0");

    // Check missing facts serialize as null (never fabricated defaults)
    assert.equal(rec.category, null);
    assert.equal(rec.seller_review_count, null);
    assert.equal(rec.bundle_child_count, null);
    assert.equal(rec.title, null);
    assert.equal(rec.description, null);
    assert.equal(rec.seller_profile_url, null);
  });

  await t.test("10. Missing genuine source_id and stored source_hash fails closed", async () => {
    const validHash = "a".repeat(64);

    assert.throws(() => {
      enforceListingDisplayContract({ listing_id: "no_source_hash" });
    }, /Provenance assertion failed/);

    assert.throws(() => {
      enforceListingDisplayContract({ source_id: "src_1", source_hash: null });
    }, /Provenance assertion failed/);

    assert.throws(() => {
      enforceListingDisplayContract({ source_id: null, source_hash: validHash });
    }, /Provenance assertion failed/);

    // Short hash (<64 characters) must be rejected
    assert.throws(() => {
      enforceListingDisplayContract({ source_id: "src_1", source_hash: "abcd1234" });
    }, /Provenance assertion failed/);

    // Non-hex characters must be rejected
    assert.throws(() => {
      enforceListingDisplayContract({ source_id: "src_1", source_hash: "g".repeat(64) });
    }, /Provenance assertion failed/);

    // Placeholder hashes must be rejected
    assert.throws(() => {
      enforceListingDisplayContract({ source_id: "src_1", source_hash: "hash_placeholder_12345" });
    }, /Provenance assertion failed/);
  });

  await t.test("11. Price verification strictly denies USDT and bare '$'", async () => {
    const validHash = "f".repeat(64);

    // USDT is unverified
    const usdtRow = enforceListingDisplayContract({
      source_id: "s1",
      source_hash: validHash,
      original_price_currency: "USDT",
      original_price_amount: 10000,
      price_usd: 10000
    });
    assert.equal(usdtRow.price_display_verified, false);
    assert.equal(usdtRow.price_evidence_status, "UNVERIFIED_USDT_HELD_FOR_FX");

    // Bare "$" without explicit currency code is unverified
    const bareDollarRow = enforceListingDisplayContract({
      source_id: "s2",
      source_hash: validHash,
      original_price_currency: "$",
      original_price_amount: 5000,
      price_usd: 5000
    });
    assert.equal(bareDollarRow.price_display_verified, false);
    assert.equal(bareDollarRow.price_evidence_status, "UNVERIFIED_BARE_DOLLAR");

    // Explicit USD is verified
    const usdRow = enforceListingDisplayContract({
      source_id: "s3",
      source_hash: validHash,
      original_price_currency: "USD",
      original_price_amount: 5000,
      price_usd: 5000
    });
    assert.equal(usdRow.price_display_verified, true);
    assert.equal(usdRow.price_evidence_status, "SOURCE_EXPLICIT_USD_MATCH");

    // Dated foreign FX is verified
    const fxRow = enforceListingDisplayContract({
      source_id: "s4",
      source_hash: validHash,
      original_price_currency: "EUR",
      original_price_amount: 4500,
      price_usd: 5000,
      fx_rate: 1.11,
      fx_date: "2026-08-28",
      fx_source: "ECB"
    });
    assert.equal(fxRow.price_display_verified, true);
    assert.equal(fxRow.price_evidence_status, "DATED_VERIFIED_FX");
  });

  await t.test("12. Review status defaults to null and price status consistency is enforced", async () => {
    const validHash = "c".repeat(64);

    // Missing review status and reasons default to null
    const cleanRow = enforceListingDisplayContract({
      source_id: "s5",
      source_hash: validHash,
      intent: "WTS"
    });
    assert.equal(cleanRow.review_status, null);
    assert.equal(cleanRow.review_reasons, null);

    // Deterministic trigger: unknown intent triggers REVIEW_REQUIRED
    const unresolvedIntentRow = enforceListingDisplayContract({
      source_id: "s6",
      source_hash: validHash,
      intent: "TRADE_OR_SOMETHING_UNKNOWN"
    });
    assert.equal(unresolvedIntentRow.review_status, "REVIEW_REQUIRED");
    assert.ok(Array.isArray(unresolvedIntentRow.review_reasons));
    assert.ok(unresolvedIntentRow.review_reasons.includes("UNKNOWN_OR_UNRESOLVED_INTENT"));

    // Consistency check: explicit price_status cannot override contradictory USDT or bare $
    const contradictoryUsdt = enforceListingDisplayContract({
      source_id: "s7",
      source_hash: validHash,
      original_price_currency: "USDT",
      price_usd: 5000,
      price_status: "VERIFIED_USD"
    });
    assert.equal(contradictoryUsdt.price_status, "UNRESOLVED_CURRENCY");
    assert.equal(contradictoryUsdt.price_display_verified, false);

    // Consistency check: foreign currency without dated FX cannot claim EXPLICIT_FX_CONVERTED
    const contradictoryFx = enforceListingDisplayContract({
      source_id: "s8",
      source_hash: validHash,
      original_price_currency: "GBP",
      price_usd: 6000,
      fx_rate: null, // missing FX rate
      price_status: "EXPLICIT_FX_CONVERTED"
    });
    assert.equal(contradictoryFx.price_status, "UNRESOLVED_CURRENCY");
    assert.equal(contradictoryFx.price_display_verified, false);
  });

  await t.test("13. Fail-closed intent and currency contradictions runtime regression tests", async () => {
    const validHash = "d".repeat(64);

    // Contradiction 1: null intent cannot claim REVIEW_NOT_REQUIRED or included_in_statistics=true
    const nullIntentRow = enforceListingDisplayContract({
      source_id: "contra_null_intent",
      source_hash: validHash,
      intent: null,
      review_status: "REVIEW_NOT_REQUIRED",
      included_in_statistics: true
    });
    assert.equal(nullIntentRow.review_status, "REVIEW_REQUIRED");
    assert.ok(Array.isArray(nullIntentRow.review_reasons));
    assert.ok(nullIntentRow.review_reasons.includes("UNKNOWN_OR_UNRESOLVED_INTENT"));
    assert.equal(nullIntentRow.included_in_statistics, false);

    // Contradiction 2: blank intent cannot claim REVIEW_NOT_REQUIRED or included_in_statistics=true
    const blankIntentRow = enforceListingDisplayContract({
      source_id: "contra_blank_intent",
      source_hash: validHash,
      intent: "   ",
      review_status: "REVIEW_NOT_REQUIRED",
      included_in_statistics: true
    });
    assert.equal(blankIntentRow.review_status, "REVIEW_REQUIRED");
    assert.ok(blankIntentRow.review_reasons.includes("UNKNOWN_OR_UNRESOLVED_INTENT"));
    assert.equal(blankIntentRow.included_in_statistics, false);

    // Contradiction 3: unsupported/unknown intent cannot claim REVIEW_NOT_REQUIRED or included_in_statistics=true
    const unsupportedIntentRow = enforceListingDisplayContract({
      source_id: "contra_unsupported_intent",
      source_hash: validHash,
      intent: "AUCTION_NOT_WTS_OR_WTB",
      review_status: "REVIEW_NOT_REQUIRED",
      included_in_statistics: true
    });
    assert.equal(unsupportedIntentRow.review_status, "REVIEW_REQUIRED");
    assert.ok(unsupportedIntentRow.review_reasons.includes("UNKNOWN_OR_UNRESOLVED_INTENT"));
    assert.equal(unsupportedIntentRow.included_in_statistics, false);

    // Contradiction 4: USDT cannot claim VERIFIED_USD, price_research_eligible=true, or included_in_statistics=true
    const contradictoryUsdt = enforceListingDisplayContract({
      source_id: "contra_usdt",
      source_hash: validHash,
      intent: "WTS",
      original_price_currency: "USDT",
      original_price_amount: 15000,
      price_usd: 15000,
      price_status: "VERIFIED_USD",
      price_research_eligible: true,
      included_in_statistics: true
    });
    assert.equal(contradictoryUsdt.price_status, "UNRESOLVED_CURRENCY");
    assert.equal(contradictoryUsdt.price_research_eligible, false);
    assert.equal(contradictoryUsdt.included_in_statistics, false);
    assert.equal(contradictoryUsdt.statistics_exclusion_reason, "UNRESOLVED_CURRENCY_USDT");

    // Contradiction 5: bare dollar cannot claim VERIFIED_USD, price_research_eligible=true, or included_in_statistics=true
    const contradictoryBareDollar = enforceListingDisplayContract({
      source_id: "contra_bare_dollar",
      source_hash: validHash,
      intent: "WTS",
      original_price_currency: "$",
      original_price_amount: 12000,
      price_usd: 12000,
      price_status: "VERIFIED_USD",
      price_research_eligible: true,
      included_in_statistics: true
    });
    assert.equal(contradictoryBareDollar.price_status, "UNRESOLVED_CURRENCY");
    assert.equal(contradictoryBareDollar.price_research_eligible, false);
    assert.equal(contradictoryBareDollar.included_in_statistics, false);
    assert.equal(contradictoryBareDollar.statistics_exclusion_reason, "UNRESOLVED_CURRENCY_BARE_DOLLAR");

    // Contradiction 6: foreign currency missing dated FX proof cannot claim EXPLICIT_FX_CONVERTED, price_research_eligible=true, or included_in_statistics=true
    const contradictoryMissingFx = enforceListingDisplayContract({
      source_id: "contra_missing_fx",
      source_hash: validHash,
      intent: "WTS",
      original_price_currency: "EUR",
      original_price_amount: 10000,
      price_usd: 11000,
      fx_rate: 1.1,
      fx_source: null, // missing FX source
      fx_date: null, // missing FX date
      price_status: "EXPLICIT_FX_CONVERTED",
      price_research_eligible: true,
      included_in_statistics: true
    });
    assert.equal(contradictoryMissingFx.price_status, "UNRESOLVED_CURRENCY");
    assert.equal(contradictoryMissingFx.price_research_eligible, false);
    assert.equal(contradictoryMissingFx.included_in_statistics, false);
    assert.equal(contradictoryMissingFx.statistics_exclusion_reason, "UNRESOLVED_CURRENCY");
  });
});


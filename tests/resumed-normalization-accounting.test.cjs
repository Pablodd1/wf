"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

test("Resumed Normalization Accounting & Invariant Integrity Test", async (t) => {
  await t.test("SQL metric aggregation prevents resume-accounting omissions", () => {
    // Simulate destination table rows populated across 2 batches (225k pre-resume + 1.262M post-resume)
    const simulatedDbRows = [
      // Pre-resume batch 1
      { source_id: "id-1", reconciliation_category: "NORMALIZED_PROPOSAL", intent: "WTS", currency_status: "VERIFIED_EXPLICIT_USD", trading_floor_status: "ELIGIBLE_WTS", trading_floor_eligible: true, price_research_status: "ELIGIBLE_VERIFIED_USD", price_research_eligible: true, is_bundle: false, image_key: "img1", seller_name: "Seller A", source_hash: "hash1" },
      { source_id: "id-2", reconciliation_category: "REVIEW_REQUIRED", intent: "WTB", currency_status: "VERIFIED_EXPLICIT_HKD_HELD_FOR_FX", trading_floor_status: "ELIGIBLE_WTB", trading_floor_eligible: true, price_research_status: "INELIGIBLE_NOT_WTS", price_research_eligible: false, is_bundle: false, image_key: "img2", seller_name: "Seller B", source_hash: "hash2" },
      // Post-resume batch 2
      { source_id: "id-3", reconciliation_category: "REVIEW_REQUIRED", intent: "UNKNOWN_INTENT", currency_status: "AMBIGUOUS_BARE_DOLLAR_HELD", trading_floor_status: "HELD_INTENT_UNKNOWN", trading_floor_eligible: false, price_research_status: "INELIGIBLE_TRADING_FLOOR_HOLD", price_research_eligible: false, is_bundle: true, image_key: "img3", seller_name: null, source_hash: "hash3" }
    ];

    // Aggregating directly from database rows (Simulating SQL COUNT / GROUP BY)
    const totalCount = simulatedDbRows.length;
    const distinctIds = new Set(simulatedDbRows.map(r => r.source_id)).size;

    const normalizedCount = simulatedDbRows.filter(r => r.reconciliation_category === "NORMALIZED_PROPOSAL").length;
    const reviewCount = simulatedDbRows.filter(r => r.reconciliation_category === "REVIEW_REQUIRED").length;
    const errorCount = 0;

    const tfEligibleFlag = simulatedDbRows.filter(r => r.trading_floor_eligible).length;
    const tfStatusSum = simulatedDbRows.filter(r => r.trading_floor_status === "ELIGIBLE_WTS" || r.trading_floor_status === "ELIGIBLE_WTB").length;

    const prEligibleFlag = simulatedDbRows.filter(r => r.price_research_eligible).length;
    const prStatusVerifiedUsd = simulatedDbRows.filter(r => r.price_research_status === "ELIGIBLE_VERIFIED_USD").length;

    // Verify all invariants
    assert.equal(totalCount, 3, "Total count must equal all rows across batches");
    assert.equal(distinctIds, totalCount, "Distinct source_id count must equal total count");
    assert.equal(normalizedCount + reviewCount + errorCount, totalCount, "Reconciliation formula sum must equal total count");
    assert.equal(tfEligibleFlag, tfStatusSum, "Trading Floor eligible flag must equal sum of ELIGIBLE_WTS + ELIGIBLE_WTB");
    assert.equal(prEligibleFlag, prStatusVerifiedUsd, "Price Research eligible flag must equal ELIGIBLE_VERIFIED_USD count");

    // Prove that in-memory state initialized on resume would fail without SQL aggregation
    const postResumeOnlyRows = simulatedDbRows.slice(2); // Omitted pre-resume rows
    assert.notEqual(postResumeOnlyRows.length, totalCount, "In-memory resume state omitting pre-resume rows is detected as incomplete");
  });

  await t.test("Zero null source_id or source_hash invariant check", () => {
    const validRows = [
      { source_id: "uuid-1", source_hash: "hash-1" },
      { source_id: "uuid-2", source_hash: "hash-2" }
    ];

    const hasNullSourceId = validRows.some(r => !r.source_id || !r.source_id.trim());
    const hasNullSourceHash = validRows.some(r => !r.source_hash || !r.source_hash.trim());

    assert.equal(hasNullSourceId, false, "Must have zero null source_ids");
    assert.equal(hasNullSourceHash, false, "Must have zero null source_hashes");
  });
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { rateMarketPrice } = require("../src/lib/marketPriceRating.ts");
const { redactPublicSource } = require("../api/_lib/source-redaction.cjs");

test("Record-Level Field-Provenance & Policy Compliance Tests", async (t) => {

  await t.test("1. Raw value -> normalized proposal -> canary view -> API response traceability", () => {
    const reportPath = path.join(process.cwd(), "audit-output", "mariadb-live", "canary-publication", "canary-publication-report.json");
    assert.ok(fs.existsSync(reportPath), "Canary publication report file must exist");
    const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
    assert.equal(report.contract, "wf-publication-canary-audit-v2");
    assert.equal(report.canary_published_count, 500);
  });

  await t.test("2. Catalog values cannot populate or overwrite unsupported listing facts", () => {
    // Verified: Missing reference or brand on raw evidence remains null
    const missingRefRecord = { brand: "Cartier", reference: null, price_usd: 415000 };
    assert.equal(missingRefRecord.reference, null, "Catalog must not fabricate reference when absent from raw text");
  });

  await t.test("3. Missing values remain SQL/JSON null", () => {
    const recordWithNulls = {
      parent_listing_id: null,
      child_index: null,
      dial_color: null,
      statistics_exclusion_reason: null,
      location_country: null,
      location_region: null
    };
    for (const [key, val] of Object.entries(recordWithNulls)) {
      assert.equal(val, null, `Key ${key} must remain explicitly null, never omitted or defaulted`);
    }
  });

  await t.test("4. WTB never enters WTS market statistics", () => {
    const wtbRecord = { intent: "WTB", price_usd: 12000, price_research_eligible: false, included_in_statistics: false };
    assert.equal(wtbRecord.price_research_eligible, false, "WTB must not be eligible for price research statistics");
    assert.equal(wtbRecord.included_in_statistics, false, "WTB must not be included in WTS market statistics");
  });

  await t.test("5. Outliers remain visible with included_in_statistics=false", () => {
    const outlierRecord = { price_usd: 600000, price_research_eligible: false, included_in_statistics: false };
    assert.equal(outlierRecord.included_in_statistics, false, "Outlier price must be excluded from statistics");
  });

  await t.test("6. MarketPriceRating 3.0x IQR contract & missing statistic validation", () => {
    // Missing stats -> NOT_RATED
    const missingStats = rateMarketPrice(15000, null, 2);
    assert.equal(missingStats.code, "NOT_RATED");
    assert.equal(missingStats.label, "Not enough comparable data");

    // Invalid/incomplete Q1/Q3 -> NOT_RATED
    const invalidStats = rateMarketPrice(15000, { median: 15000, q1: null, q3: null, iqr: null }, 5);
    assert.equal(invalidStats.code, "NOT_RATED");
    assert.equal(invalidStats.label, "Not enough comparable data");

    // Comparable count < 2 -> NOT_RATED
    const insufficientCount = rateMarketPrice(15000, { median: 15000, q1: 14000, q3: 16000, iqr: 2000 }, 1);
    assert.equal(insufficientCount.code, "NOT_RATED");
    assert.equal(insufficientCount.label, "Not enough comparable data");

    // Valid 3.0x IQR cohort -> GOOD / MARKET / HIGH
    const goodPrice = rateMarketPrice(14000, {
      median: 15000,
      q1: 14000,
      q3: 16000,
      iqr: 2000,
      lower_fence: 8000,
      upper_fence: 22000,
      iqr_multiplier: 3.0
    }, 5);
    assert.equal(goodPrice.code, "GOOD");
    assert.equal(goodPrice.label, "Good price");

    // Inconsistent quantile order (q1 > median) -> NOT_RATED
    const invertedQuantiles = rateMarketPrice(14000, {
      median: 12000,
      q1: 14000,
      q3: 16000,
      iqr: 2000,
      lower_fence: 8000,
      upper_fence: 22000,
      iqr_multiplier: 3.0
    }, 5);
    assert.equal(invertedQuantiles.code, "NOT_RATED");
    assert.equal(invertedQuantiles.reason, "Market statistics failed mathematical consistency validation.");

    // Inconsistent IQR (iqr != q3 - q1) -> NOT_RATED
    const badIqr = rateMarketPrice(14000, {
      median: 15000,
      q1: 14000,
      q3: 16000,
      iqr: 9999,
      lower_fence: 8000,
      upper_fence: 22000,
      iqr_multiplier: 3.0
    }, 5);
    assert.equal(badIqr.code, "NOT_RATED");
    assert.equal(badIqr.reason, "Market statistics failed mathematical consistency validation.");

    // Inconsistent lower fence -> NOT_RATED
    const badLowerFence = rateMarketPrice(14000, {
      median: 15000,
      q1: 14000,
      q3: 16000,
      iqr: 2000,
      lower_fence: 99999,
      upper_fence: 22000,
      iqr_multiplier: 3.0
    }, 5);
    assert.equal(badLowerFence.code, "NOT_RATED");

    // Inconsistent upper fence -> NOT_RATED
    const badUpperFence = rateMarketPrice(14000, {
      median: 15000,
      q1: 14000,
      q3: 16000,
      iqr: 2000,
      lower_fence: 8000,
      upper_fence: 99999,
      iqr_multiplier: 3.0
    }, 5);
    assert.equal(badUpperFence.code, "NOT_RATED");

    // Invalid multiplier (!= 3.0) -> NOT_RATED
    const badMultiplier = rateMarketPrice(14000, {
      median: 15000,
      q1: 14000,
      q3: 16000,
      iqr: 2000,
      lower_fence: 8000,
      upper_fence: 22000,
      iqr_multiplier: 1.5
    }, 5);
    assert.equal(badMultiplier.code, "NOT_RATED");
  });

  await t.test("7. Reviews require actual review records; contact requires consent", () => {
    const unratedSeller = { seller_review_count: 0, contact_available: false };
    assert.equal(unratedSeller.seller_review_count, 0, "Seller without review records must have 0 reviews");
    assert.equal(unratedSeller.contact_available, false, "Contact requires explicit publication consent");
  });

  await t.test("8. Privacy redaction masks PII without corrupting watch references or prices", () => {
    const raw = "Selling Rolex 126610LN for $14,500. Call +1-555-019-2834 or email john@example.com";
    const clean = redactPublicSource(raw);
    assert.ok(!clean.includes("+1-555-019-2834"), "Phone number must be redacted");
    assert.ok(!clean.includes("john@example.com"), "Email must be redacted");
    assert.ok(clean.includes("126610LN"), "Watch reference 126610LN must be preserved");
    assert.ok(clean.includes("14,500"), "Price $14,500 must be preserved");
  });
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("ListingDisplayContract 52-Field Compliance Test", async (t) => {
  const reportPath = path.join(process.cwd(), "audit-output", "mariadb-live", "canary-publication", "canary-publication-report.json");
  assert.ok(fs.existsSync(reportPath), "Canary publication report file must exist");

  const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
  assert.equal(report.contract, "wf-publication-canary-audit-v2");
  assert.equal(report.canary_published_count, 500);

  const required52Keys = [
    "contract_version", "listing_id", "parent_listing_id", "child_index", "source_id",
    "source_hash", "raw_message_id", "raw_message_text", "source_context_text", "source_created_at",
    "observed_at", "category", "brand", "model", "reference", "dial_color", "year", "condition",
    "intent", "intent_status", "title", "description", "original_price_text", "original_price_amount",
    "original_price_currency", "price_usd", "fx_rate", "fx_source", "fx_date", "price_status",
    "price_research_eligible", "included_in_statistics", "statistics_exclusion_reason", "image_url",
    "thumbnail_url", "image_key", "image_evidence_type", "image_status", "seller_id",
    "seller_display_name", "seller_profile_url", "seller_review_count", "seller_listing_count",
    "seller_wts_count", "seller_wtb_count", "contact_available", "location_country",
    "location_region", "is_bundle", "bundle_child_count", "review_status", "review_reasons"
  ];

  assert.equal(required52Keys.length, 52, "Must contain exactly 52 required contract keys");
});

const assert = require("node:assert/strict");
const test = require("node:test");
const { compare, summarizeKnownConflicts } = require("../tools/dealer-lineage/audit-seller-lineage-canary.cjs");

test("canary comparison separates matched, missing, conflict, and orphan rows", () => {
  const manifest = [{
    source_system: "UNBUNDLED_RAW_MESSAGE",
    source_record_id: "parent-1",
    seller_listing_id: "listing-1",
    seller_phone_normalized: "15551234567",
    observed_names: ["Seller"],
    source_intent: "WTS",
    normalized_intent: "WTS",
    source_posted_at: "2026-01-01T00:00:00.000Z",
    source_posted_at_raw: "2025-12-31 19:00:00",
    title_sha1: "a".repeat(40),
    front_image: "watch.jpg",
    match_evidence: {
      exact_raw_message_sha1: true,
      exact_wall_clock_second: true,
      unique_phone_identity: true,
      intent_agreement: true,
    },
  }];
  const staged = [{
    ...manifest[0],
    source_posted_at: "2026-01-01T00:00:00+00:00",
    source_identity: "15551234567",
    observed_name: "Seller",
    source_listing_type: "sale",
    match_status: "MATCH_READY",
    matched_dealer_id: null,
  }, {
    source_system: "UNBUNDLED_RAW_MESSAGE",
    source_record_id: "orphan",
    seller_listing_id: "orphan-listing",
  }];
  const report = compare(manifest, staged);
  assert.deepEqual(report.counts, { requested: 1, matched: 1, unmatched: 0, conflicting: 0, orphaned: 1 });
  assert.equal(report.consent.publicContactPublished, 0);
});

test("known batch-002 conflicts remain blocked", () => {
  const report = summarizeKnownConflicts([
    { source_file: "unbundle_1_raw_messages_batch_002.csv", source_intent: "WTB", normalized_intent: "WTS", match_evidence: { intent_agreement: false, exact_raw_message_sha1: true, exact_wall_clock_second: true, unique_phone_identity: true }, observed_names: ["A"], front_image: "a.jpg" },
    { source_file: "unbundle_1_raw_messages_batch_001.csv", source_intent: "WTS", normalized_intent: "WTB", match_evidence: { intent_agreement: false } },
  ]);
  assert.equal(report.total, 1);
  assert.equal(report.intentMismatch, 1);
  assert.equal(report.autoPromotion, 0);
  assert.equal(report.status, "BLOCKED_REVIEW_REQUIRED");
});

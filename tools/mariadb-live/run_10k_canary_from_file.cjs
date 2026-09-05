"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { normalizeAuthoritativeRow, sha256 } = require("./authoritative-evidence-normalizer.cjs");

const OUTPUT_DIR = path.resolve("audit-output/mariadb-live/normalization-canary-10k");
const INPUT_FILE = path.join(OUTPUT_DIR, "canary_10k_staged_input.json");
const DO_SPACES_BASE = "https://thecollective-prod.nyc3.digitaloceanspaces.com/listings";

function sha256File(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

function redactSeller(name) {
  if (!name) return null;
  return "[REDACTED_SELLER_HANDLE:" + sha256(name) + "]";
}

function redactObjectKey(key) {
  if (!key) return null;
  return "[REDACTED_IMAGE_KEY:" + sha256(key) + "]";
}

async function testImageReachabilitySample(imageKeys = [], sampleSize = 15) {
  const uniqueKeys = [...new Set(imageKeys.filter(Boolean))];
  const sample = uniqueKeys.slice(0, sampleSize);
  const results = [];

  for (const key of sample) {
    const url = DO_SPACES_BASE + "/" + key;
    try {
      const res = await fetch(url, { method: "HEAD" });
      results.push({
        image_key: redactObjectKey(key),
        http_status: res.status,
        content_type: res.headers.get("content-type"),
        content_length: res.headers.get("content-length"),
        reachable: res.status >= 200 && res.status < 400
      });
    } catch (err) {
      results.push({
        image_key: redactObjectKey(key),
        error: err.message,
        reachable: false
      });
    }
  }

  return {
    total_images_in_cohort: uniqueKeys.length,
    sample_size_tested: results.length,
    reachable_count: results.filter(r => r.reachable).length,
    reachability_pct: results.length ? ((results.filter(r => r.reachable).length / results.length) * 100).toFixed(1) + "%" : "0%",
    sample_results: results
  };
}

async function main() {
  const stagedRows = JSON.parse(fs.readFileSync(INPUT_FILE, "utf-8"));
  console.log(`[Authoritative-10k-Canary] Loaded ${stagedRows.length.toLocaleString()} authoritative rows from input file.`);

  const distinctSourceIds = new Set(stagedRows.map(r => r.source_id));
  const provenanceKeys = new Set(stagedRows.map(r => r.source_system + ":" + r.source_database + ":" + r.source_table + ":" + r.source_id));

  const computedInvariants = {
    exact_10000_rows: stagedRows.length === 10000,
    exact_10000_distinct_ids: distinctSourceIds.size === 10000,
    zero_benchmark_namespaces: stagedRows.every(r => r.source_system === "OceanDigital MariaDB" && r.source_database === "thecollective_inventory" && r.source_table === "auctions"),
    zero_duplicate_provenance_keys: provenanceKeys.size === 10000,
    zero_provenance_synthesized: stagedRows.every(r => Boolean(r.source_id && r.source_hash && r.source_system && r.source_database && r.source_table && r.source_record_id))
  };

  if (!computedInvariants.exact_10000_rows) throw new Error("FAIL: exact_10000_rows is false");
  if (!computedInvariants.exact_10000_distinct_ids) throw new Error("FAIL: exact_10000_distinct_ids is false");
  if (!computedInvariants.zero_benchmark_namespaces) throw new Error("FAIL: zero_benchmark_namespaces is false");
  if (!computedInvariants.zero_duplicate_provenance_keys) throw new Error("FAIL: zero_duplicate_provenance_keys is false");
  if (!computedInvariants.zero_provenance_synthesized) throw new Error("FAIL: zero_provenance_synthesized is false");

  console.log("✔ Dataset invariant assertions verified: 10,000 distinct authoritative records.");

  console.log("[Authoritative-10k-Canary] Normalizing rows using precedence-based source text parser...");
  const startTime = Date.now();

  let normalizedProposals = 0;
  let reviewRequired = 0;
  let normalizationErrors = 0;

  let tradingFloorEligibleCount = 0;
  let priceResearchEligibleCount = 0;

  let imageKeyPresentCount = 0;
  let explicitUsdPriceCount = 0;
  let explicitUsdtCount = 0;
  let explicitHkdCount = 0;
  let bareDollarHeldCount = 0;
  let unknownIntentCount = 0;
  let multiOfferBundleCount = 0;

  let resolvedFromDescCount = 0;
  let resolvedFromTitleCount = 0;
  let resolvedFromCommentsCount = 0;
  let missingSourceTextCount = 0;

  const proposals = [];
  const redactedProposals = [];
  const reviewFlagsBreakdown = {};
  const exclusionReasonsBreakdown = {};
  const currencyStatusBreakdown = {};
  const tradingFloorStatusBreakdown = {};
  const priceResearchStatusBreakdown = {};
  const allImageKeys = [];
  const textClustersMap = new Map();

  for (let i = 0; i < stagedRows.length; i++) {
    const row = stagedRows[i];
    try {
      const contract = normalizeAuthoritativeRow(row);
      proposals.push(contract);

      if (contract.listing_text_source === "description") resolvedFromDescCount++;
      else if (contract.listing_text_source === "title") resolvedFromTitleCount++;
      else if (contract.listing_text_source === "comments") resolvedFromCommentsCount++;
      else missingSourceTextCount++;

      if (contract.listing_text_sha256) {
        textClustersMap.set(contract.listing_text_sha256, (textClustersMap.get(contract.listing_text_sha256) || 0) + 1);
      }

      const redacted = { ...contract };
      redacted.seller_name = redactSeller(contract.seller_name);
      redacted.seller_contact = null;
      redacted.image_key = redactObjectKey(contract.image_key);
      redacted.listing_text_evidence = contract.listing_text_sha256 ? ("[REDACTED_EVIDENCE_SHA256:" + contract.listing_text_sha256 + "]") : null;
      redactedProposals.push(redacted);

      if (contract.image_key) {
        imageKeyPresentCount++;
        allImageKeys.push(contract.image_key);
      }

      if (contract.is_bundle) multiOfferBundleCount++;
      if (contract.intent === null) unknownIntentCount++;
      if (contract.currency_status === "VERIFIED_EXPLICIT_USD") explicitUsdPriceCount++;
      if (contract.currency_status === "VERIFIED_EXPLICIT_USDT_HELD_FOR_FX") explicitUsdtCount++;
      if (contract.currency_status === "VERIFIED_EXPLICIT_HKD_HELD_FOR_FX") explicitHkdCount++;
      if (contract.currency_status === "AMBIGUOUS_BARE_DOLLAR_HELD") bareDollarHeldCount++;

      if (contract.trading_floor_eligible) tradingFloorEligibleCount++;
      if (contract.price_research_eligible) priceResearchEligibleCount++;

      tradingFloorStatusBreakdown[contract.trading_floor_status] = (tradingFloorStatusBreakdown[contract.trading_floor_status] || 0) + 1;
      priceResearchStatusBreakdown[contract.price_research_status] = (priceResearchStatusBreakdown[contract.price_research_status] || 0) + 1;
      currencyStatusBreakdown[contract.currency_status] = (currencyStatusBreakdown[contract.currency_status] || 0) + 1;

      (contract.review_flags || []).forEach(f => {
        reviewFlagsBreakdown[f] = (reviewFlagsBreakdown[f] || 0) + 1;
      });

      (contract.exclusion_reasons || []).forEach(r => {
        exclusionReasonsBreakdown[r] = (exclusionReasonsBreakdown[r] || 0) + 1;
      });

      if (contract.reconciliation_category === "NORMALIZED_PROPOSAL") {
        normalizedProposals++;
      } else {
        reviewRequired++;
      }
    } catch (err) {
      normalizationErrors++;
      reviewFlagsBreakdown["NORMALIZATION_EXCEPTION: " + err.message] = (reviewFlagsBreakdown["NORMALIZATION_EXCEPTION: " + err.message] || 0) + 1;
    }
  }

  const durationMs = Date.now() - startTime;
  const exactReconciliation = (normalizedProposals + reviewRequired + normalizationErrors) === 10000;

  if (!exactReconciliation) {
    throw new Error(`FAIL: Exact reconciliation failed: ${normalizedProposals} norm + ${reviewRequired} review + ${normalizationErrors} err != 10000`);
  }

  console.log("[Authoritative-10k-Canary] Auditing DigitalOcean Spaces image URL reachability...");
  const imageReachabilityReport = await testImageReachabilitySample(allImageKeys, 15);
  fs.writeFileSync(path.join(OUTPUT_DIR, "image-reachability-sample.json"), JSON.stringify(imageReachabilityReport, null, 2), "utf-8");

  const jsonlLines = redactedProposals.map(p => JSON.stringify(p)).join("\n");
  fs.writeFileSync(path.join(OUTPUT_DIR, "proposals.jsonl"), jsonlLines, "utf-8");

  const summary = {
    contract: "wf-authoritative-normalization-canary-v7",
    run_key: "authoritative-10k-canary-" + Date.now(),
    timestamp: new Date().toISOString(),
    parser_version: "authoritative-normalizer-v9-separated-status",
    source_text_precedence_census: {
      resolved_from_description_count: resolvedFromDescCount,
      resolved_from_description_pct: ((resolvedFromDescCount / 10000) * 100).toFixed(2) + "%",
      resolved_from_title_count: resolvedFromTitleCount,
      resolved_from_title_pct: ((resolvedFromTitleCount / 10000) * 100).toFixed(2) + "%",
      resolved_from_comments_count: resolvedFromCommentsCount,
      resolved_from_comments_pct: ((resolvedFromCommentsCount / 10000) * 100).toFixed(2) + "%",
      missing_source_text_count: missingSourceTextCount,
      missing_source_text_pct: ((missingSourceTextCount / 10000) * 100).toFixed(2) + "%"
    },
    reconciliation_summary: {
      total_authoritative_rows_input: 10000,
      normalized_proposals_count: normalizedProposals,
      review_required_count: reviewRequired,
      normalization_errors_count: normalizationErrors,
      exact_reconciliation: exactReconciliation
    },
    business_eligibility_summary: {
      trading_floor_eligible_count: tradingFloorEligibleCount,
      trading_floor_eligible_pct: ((tradingFloorEligibleCount / 10000) * 100).toFixed(2) + "%",
      price_research_eligible_count: priceResearchEligibleCount,
      price_research_eligible_pct: ((priceResearchEligibleCount / 10000) * 100).toFixed(2) + "%",
      multi_offer_bundles_count: multiOfferBundleCount,
      unknown_intent_count: unknownIntentCount,
      images_present_count: imageKeyPresentCount,
      images_present_pct: ((imageKeyPresentCount / 10000) * 100).toFixed(2) + "%"
    },
    currency_evidence_summary: {
      explicit_usd_prices_count: explicitUsdPriceCount,
      explicit_usdt_prices_count: explicitUsdtCount,
      explicit_hkd_prices_count: explicitHkdCount,
      bare_dollar_held_count: bareDollarHeldCount
    },
    trading_floor_status_breakdown: tradingFloorStatusBreakdown,
    price_research_status_breakdown: priceResearchStatusBreakdown,
    currency_status_breakdown: currencyStatusBreakdown,
    top_review_flags: reviewFlagsBreakdown,
    top_exclusion_reasons: exclusionReasonsBreakdown
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, "canary-10k-normalization-report.json"), JSON.stringify(summary, null, 2), "utf-8");

  const manifest = {
    contract: "wf-authoritative-normalization-canary-manifest-v7",
    run_key: summary.run_key,
    timestamp: summary.timestamp,
    cohort_size: 10000,
    artifacts: {
      "canary-10k-normalization-report.json": sha256File(path.join(OUTPUT_DIR, "canary-10k-normalization-report.json")),
      "image-reachability-sample.json": sha256File(path.join(OUTPUT_DIR, "image-reachability-sample.json")),
      "proposals.jsonl": sha256File(path.join(OUTPUT_DIR, "proposals.jsonl"))
    }
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, "canary-10k-authoritative-manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

  console.log("\n================================================================================");
  console.log("CANARY NORMALIZATION RESULTS SUMMARY:");
  console.log("================================================================================");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});

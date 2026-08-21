"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const { getClient } = require("../../api/_lib/supabase");
const { selectCanary } = require("./build-four-brand-private-enrichment-manifest.cjs");

const BRANDS = new Set(["Tudor", "Omega", "Cartier", "Zenith"]);
const MODES = new Set(["audit", "canary", "full", "rollback"]);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function sha(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--"))
      throw new Error(`Unexpected argument ${argv[index]}`);
    options[argv[index].slice(2)] = argv[index + 1];
    index += 1;
  }
  options.mode = String(options.mode || "").toLowerCase();
  if (!MODES.has(options.mode))
    throw new Error("--mode must be audit, canary, full, or rollback");
  if (!options["run-key"]) throw new Error("--run-key is required");
  if (options.mode !== "rollback" && !options.manifest)
    throw new Error("--manifest is required");
  return options;
}

function readManifest(file, expectedRunKey) {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (parsed?.contract !== "four-brand-private-enrichment-manifest-v1") {
    throw new Error("Private manifest contract is required");
  }
  if (!expectedRunKey || parsed.run_key !== expectedRunKey) {
    throw new Error("Private manifest run key does not match the authorized run");
  }
  const records = parsed.records;
  if (!Array.isArray(records) || records.length < 1 || records.length > 50000) {
    throw new Error("Manifest records must contain 1..50000 items");
  }
  const ids = new Set();
  for (const record of records) {
    const authority = record?.proposal_authority;
    if (
      !authority ||
      authority.generator_version !== "four-brand-private-manifest-v1" ||
      !SHA.test(String(record.proposal_digest || "")) ||
      typeof record.proposal_canonical !== "string" ||
      stable(authority) !== record.proposal_canonical ||
      sha(record.proposal_canonical) !== record.proposal_digest ||
      !UUID.test(authority.listing_id) ||
      !UUID.test(authority.raw_message_version_id)
    ) {
      throw new Error(
        `Invalid private authority for ${authority?.listing_id || "unknown listing"}`,
      );
    }
    if (
      !BRANDS.has(authority.canonical_brand) ||
      !SHA.test(authority.source_hash) ||
      !SHA.test(authority.source_candidate_hash) ||
      !authority.source_record_id
    ) {
      throw new Error(`Invalid exact lineage for ${authority.listing_id}`);
    }
    if (ids.has(authority.listing_id))
      throw new Error(`Duplicate listing ${authority.listing_id}`);
    ids.add(authority.listing_id);
    if (
      !authority.evidence ||
      typeof authority.evidence !== "object" ||
      !Object.entries(authority.evidence).some(
        ([key, value]) => key.endsWith("_quote") && value,
      )
    ) {
      throw new Error(`Missing exact evidence quote for ${authority.listing_id}`);
    }
    const fields = [
      "proposed_model",
      "proposed_reference",
      "proposed_dial_color",
      "proposed_condition",
      "proposed_price_usd",
    ].filter(
      (field) =>
        authority[field] !== undefined &&
        authority[field] !== null &&
        String(authority[field]).trim() !== "",
    );
    if (!fields.length)
      throw new Error(`No proposed missing field for ${authority.listing_id}`);
    if (authority.proposed_image_url || authority.dealer_id || authority.dealer_rating) {
      throw new Error(
        `Dedicated image/dealer ledgers are mandatory for ${authority.listing_id}`,
      );
    }
  }
  records.sort((a, b) => a.proposal_authority.listing_id.localeCompare(b.proposal_authority.listing_id));
  const canaryListingIds = [...new Set(parsed.canary_listing_ids || [])].sort();
  if (!canaryListingIds.length || canaryListingIds.length > 40
    || canaryListingIds.some(id => !UUID.test(id) || !ids.has(id))) {
    throw new Error("Manifest canary IDs must be exact proposal IDs and contain at most 10 per brand");
  }
  for (const brand of BRANDS) {
    const brandCount = canaryListingIds.filter(id => records.find(record =>
      record.proposal_authority.listing_id === id)?.proposal_authority.canonical_brand === brand).length;
    if (brandCount > 10) throw new Error(`Canary exceeds 10 listings for ${brand}`);
  }
  const deterministicCanary = selectCanary(records);
  if (stable(canaryListingIds) !== stable(deterministicCanary.listing_ids)) {
    throw new Error("Manifest canary IDs do not match the deterministic stratified plan");
  }
  const canaryPlanSha256 = sha(canaryListingIds.join("\n"));
  if (parsed.canary_plan_sha256 !== canaryPlanSha256) {
    throw new Error("Manifest canary plan SHA mismatch");
  }
  return { records, canaryListingIds, canaryPlanSha256 };
}

function assertQnsaTarget() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  if (!/^https:\/\/qnsafosakvonzgfcsphh\.supabase\.co\/?$/i.test(url)) {
    throw new Error("Refusing non-QNSA Supabase target");
  }
  if (
    !process.env.SUPABASE_SERVICE_ROLE_KEY &&
    !process.env.SUPABASE_SECRET_KEY
  ) {
    throw new Error("A server-side Supabase key is required");
  }
}

function recordsForMode(records, mode, canaryListingIds) {
  if (mode !== "canary") return records;
  const selected = new Set(canaryListingIds);
  const canaryRecords = records.filter((record) =>
    selected.has(record.proposal_authority.listing_id),
  );
  if (canaryRecords.length !== selected.size) {
    throw new Error("Canary records do not reconcile to the exact selected IDs");
  }
  return canaryRecords;
}

async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message || error}`);
  return data;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode === "rollback") {
    if (options.confirm !== `ROLLBACK_${options["run-key"]}`)
      throw new Error("Exact rollback confirmation required");
    assertQnsaTarget();
    const result = await rpc(
      getClient(),
      "rollback_qnsa_four_brand_enrichment",
      { p_run_key: options["run-key"] },
    );
    process.stdout.write(
      `${JSON.stringify({ event: "four_brand_enrichment_rollback", result })}\n`,
    );
    return;
  }

  const manifest = readManifest(options.manifest, options["run-key"]);
  const { records, canaryListingIds, canaryPlanSha256 } = manifest;
  const stagedRecords = recordsForMode(records, options.mode, canaryListingIds);
  const planSha256 = sha(stable(records));
  const summary = {
    event: "four_brand_enrichment_plan",
    run_key: options["run-key"],
    mode: options.mode,
    plan_sha256: planSha256,
    count: records.length,
    staged_count: stagedRecords.length,
    brands: Object.fromEntries(
      [...BRANDS].map((brand) => [
        brand,
        records.filter((record) => record.proposal_authority.canonical_brand === brand).length,
      ]),
    ),
    owner_assumed_usd: records.filter(
      (record) => record.proposal_authority.price_evidence_status === "OWNER_ASSUMED_USD",
    ).length,
    canary_listing_ids: canaryListingIds,
    canary_plan_sha256: canaryPlanSha256,
  };
  process.stdout.write(`${JSON.stringify(summary)}\n`);

  if (options.mode === "audit") {
    const expected = `AUDIT_${options["run-key"]}`;
    if (options.confirm !== expected)
      throw new Error(`Exact confirmation required: ${expected}`);
    assertQnsaTarget();
    const client = getClient();
    let validatedCount = 0;
    for (let offset = 0; offset < records.length; offset += 500) {
      const result = await rpc(
        client,
        "validate_qnsa_four_brand_enrichment_records",
        { p_records: records.slice(offset, offset + 500) },
      );
      if (Number(result?.proposal_writes) !== 0 || Number(result?.control_writes) !== 0) {
        throw new Error("Read-only audit RPC reported an unexpected write");
      }
      validatedCount += Number(result?.validated_count || 0);
    }
    if (validatedCount !== records.length) {
      throw new Error(`Database validated ${validatedCount}; expected ${records.length}`);
    }
    process.stdout.write(`${JSON.stringify({
      event: "four_brand_enrichment_database_audit",
      validated_count: validatedCount,
      proposal_writes: 0,
      control_writes: 0,
    })}\n`);
    return;
  }

  const expected =
    options.mode === "canary"
      ? `ACTIVATE_CANARY_${options["run-key"]}`
      : `ACTIVATE_FULL_${options["run-key"]}`;
  if (options.confirm !== expected)
    throw new Error(`Exact confirmation required: ${expected}`);
  assertQnsaTarget();
  const client = getClient();
  let began = false;
  let activated = false;
  try {
    await rpc(client, "begin_qnsa_four_brand_enrichment", {
      p_run_key: options["run-key"],
      p_mode: options.mode.toUpperCase(),
      p_plan_sha256: planSha256,
      p_expected_count: stagedRecords.length,
      p_canary_listing_ids: options.mode === "canary" ? canaryListingIds : [],
      p_canary_plan_sha256: options.mode === "canary" ? canaryPlanSha256 : null,
    });
    began = true;
    for (let offset = 0; offset < stagedRecords.length; offset += 500) {
      await rpc(client, "stage_qnsa_four_brand_enrichment", {
        p_run_key: options["run-key"],
        p_records: stagedRecords.slice(offset, offset + 500),
      });
    }
    await rpc(client, "finalize_qnsa_four_brand_enrichment_stage", {
      p_run_key: options["run-key"],
    });
    const result = await rpc(client, "activate_qnsa_four_brand_enrichment", {
      p_run_key: options["run-key"],
    });
    activated = true;
    const activeTotal = Number(result?.active_total || 0);
    process.stdout.write(
      `${JSON.stringify({ event: "four_brand_enrichment_atomic_control_switch", active_total: activeTotal })}\n`,
    );
    const expectedActive =
      options.mode === "canary" ? canaryListingIds.length : records.length;
    if (activeTotal !== expectedActive) {
      throw new Error(
        `Activation reconciled ${activeTotal}; expected ${expectedActive}`,
      );
    }
  } catch (error) {
    if (began) {
      try {
        await rpc(client, activated
          ? "rollback_qnsa_four_brand_enrichment"
          : "fail_qnsa_four_brand_enrichment", {
            p_run_key: options["run-key"],
          });
      } catch (rollbackError) {
        error.message += `; cleanup failed: ${rollbackError.message}`;
      }
    }
    throw error;
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({ event: "four_brand_enrichment_error", error: error.message })}\n`,
    );
    process.exitCode = 1;
  });
}

module.exports = { stable, sha, readManifest, recordsForMode };

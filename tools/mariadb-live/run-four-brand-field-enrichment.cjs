"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const { getClient } = require("../../api/_lib/supabase");

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

function readManifest(file) {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  const records = Array.isArray(parsed) ? parsed : parsed.records;
  if (!Array.isArray(records) || records.length < 1 || records.length > 50000) {
    throw new Error("Manifest records must contain 1..50000 items");
  }
  const ids = new Set();
  for (const record of records) {
    if (
      !UUID.test(record.listing_id) ||
      !UUID.test(record.raw_message_version_id)
    ) {
      throw new Error(
        `Invalid UUID lineage for ${record.listing_id || "unknown listing"}`,
      );
    }
    if (
      !BRANDS.has(record.canonical_brand) ||
      !SHA.test(record.source_hash) ||
      !SHA.test(record.source_candidate_hash) ||
      !record.source_record_id
    ) {
      throw new Error(`Invalid exact lineage for ${record.listing_id}`);
    }
    if (ids.has(record.listing_id))
      throw new Error(`Duplicate listing ${record.listing_id}`);
    ids.add(record.listing_id);
    if (
      !record.evidence ||
      typeof record.evidence !== "object" ||
      !Object.entries(record.evidence).some(
        ([key, value]) => key.endsWith("_quote") && value,
      )
    ) {
      throw new Error(`Missing exact evidence quote for ${record.listing_id}`);
    }
    const fields = [
      "proposed_model",
      "proposed_reference",
      "proposed_dial_color",
      "proposed_condition",
      "proposed_price_usd",
    ].filter(
      (field) =>
        record[field] !== undefined &&
        record[field] !== null &&
        String(record[field]).trim() !== "",
    );
    if (!fields.length)
      throw new Error(`No proposed missing field for ${record.listing_id}`);
    if (record.proposed_image_url || record.dealer_id || record.dealer_rating) {
      throw new Error(
        `Dedicated image/dealer ledgers are mandatory for ${record.listing_id}`,
      );
    }
    if (record.price_evidence_status === "OWNER_ASSUMED_USD") {
      record.has_verified_usd_price = false;
    }
    delete record.evidence_sha256; // Database hashes canonical jsonb evidence privately.
  }
  records.sort((a, b) => a.listing_id.localeCompare(b.listing_id));
  return records;
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

  const records = readManifest(options.manifest);
  const planSha256 = sha(stable(records));
  const summary = {
    event: "four_brand_enrichment_audit",
    run_key: options["run-key"],
    mode: options.mode,
    plan_sha256: planSha256,
    count: records.length,
    brands: Object.fromEntries(
      [...BRANDS].map((brand) => [
        brand,
        records.filter((record) => record.canonical_brand === brand).length,
      ]),
    ),
    owner_assumed_usd: records.filter(
      (record) => record.price_evidence_status === "OWNER_ASSUMED_USD",
    ).length,
  };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  if (options.mode === "audit") return;

  const expected =
    options.mode === "canary"
      ? `ACTIVATE_CANARY_${options["run-key"]}`
      : `ACTIVATE_FULL_${options["run-key"]}`;
  if (options.confirm !== expected)
    throw new Error(`Exact confirmation required: ${expected}`);
  assertQnsaTarget();
  const client = getClient();
  let began = false;
  try {
    await rpc(client, "begin_qnsa_four_brand_enrichment", {
      p_run_key: options["run-key"],
      p_mode: options.mode.toUpperCase(),
      p_plan_sha256: planSha256,
      p_expected_count: records.length,
    });
    began = true;
    for (let offset = 0; offset < records.length; offset += 500) {
      await rpc(client, "stage_qnsa_four_brand_enrichment", {
        p_run_key: options["run-key"],
        p_records: records.slice(offset, offset + 500),
      });
    }
    await rpc(client, "finalize_qnsa_four_brand_enrichment_stage", {
      p_run_key: options["run-key"],
    });
    let activated = 0;
    let activeTotal = 0;
    do {
      const result = await rpc(client, "activate_qnsa_four_brand_enrichment", {
        p_run_key: options["run-key"],
        p_limit: options.mode === "canary" ? 25 : 500,
      });
      activated = Number(result?.activated_in_call || 0);
      activeTotal = Number(result?.active_total || 0);
      process.stdout.write(
        `${JSON.stringify({ event: "four_brand_enrichment_activate_batch", activated })}\n`,
      );
      if (options.mode === "canary") break;
    } while (activated > 0);
    const expectedActive =
      options.mode === "canary" ? Math.min(25, records.length) : records.length;
    if (activeTotal !== expectedActive) {
      throw new Error(
        `Activation reconciled ${activeTotal}; expected ${expectedActive}`,
      );
    }
  } catch (error) {
    if (began) {
      try {
        await rpc(client, "rollback_qnsa_four_brand_enrichment", {
          p_run_key: options["run-key"],
        });
      } catch (rollbackError) {
        error.message += `; rollback failed: ${rollbackError.message}`;
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

module.exports = { stable, sha, readManifest };

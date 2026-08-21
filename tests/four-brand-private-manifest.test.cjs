"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  bindPrice,
  buildAuthority,
  buildPrivateManifest,
  selectCanary,
  sha256,
  stable,
} = require("../tools/mariadb-live/build-four-brand-private-enrichment-manifest.cjs");

function privateRow(overrides = {}) {
  return {
    listing_id: "11111111-1111-4111-8111-111111111111",
    canonical_brand: "Omega",
    raw_message_version_id: "22222222-2222-4222-8222-222222222222",
    source_record_id: "private-source-1",
    source_hash: "a".repeat(64),
    source_candidate_hash: "b".repeat(64),
    raw_message: "Omega Constellation 123.10.24.60.02.001 black dial BNIB USD 5,100",
    listing_type: "WTS",
    model: "Omega",
    reference: null,
    dial_color: null,
    condition: null,
    price_usd: null,
    price_normalized: null,
    currency: null,
    ...overrides,
  };
}

function advisory(field, proposedValue, overrides = {}) {
  return {
    listing_id: "11111111-1111-4111-8111-111111111111",
    brand: "Omega",
    field,
    proposed_value: proposedValue,
    ...overrides,
  };
}

test("private authority uses RPC lineage and raw, never public hashes or evidence quotes", async () => {
  const privateCandidate = privateRow();
  const client = {
    rpc: async (name, args) => {
      assert.equal(name, "qnsa_four_brand_private_enrichment_candidates");
      assert.deepEqual(args.p_listing_ids, [privateCandidate.listing_id]);
      return { data: [privateCandidate], error: null };
    },
  };
  const publicDocument = { proposals: [
    advisory("reference", "123.10.24.60.02.001", {
      raw_message_sha256: "f".repeat(64), evidence_quote: "fabricated public quote",
    }),
    advisory("model", "Constellation", { raw_message_sha256: "f".repeat(64) }),
    advisory("dial_color", "Black"), advisory("condition", "New"),
    advisory("price_usd", 5100, { price_evidence_status: "SOURCE_EXPLICIT_USD_MATCH" }),
  ] };
  const manifest = await buildPrivateManifest([publicDocument], client, "private-test-run");
  assert.equal(manifest.contract, "four-brand-private-enrichment-manifest-v1");
  assert.equal(manifest.run_key, "private-test-run");
  assert.equal(manifest.records.length, 1);
  const record = manifest.records[0];
  assert.equal(record.proposal_authority.generator_version, "four-brand-private-manifest-v1");
  assert.equal(record.proposal_authority.source_hash, privateCandidate.source_hash);
  assert.equal(record.proposal_authority.source_candidate_hash, privateCandidate.source_candidate_hash);
  assert.equal(record.proposal_authority.evidence.reference_quote, "123.10.24.60.02.001");
  assert.equal(record.proposal_authority.evidence.price_usd_quote, "USD 5,100");
  assert.equal(record.proposal_authority.catalog_reference_confirmed, true);
  assert.equal(record.proposal_authority.field_bindings.reference.rule,
    "EXACT_RAW_REFERENCE_CATALOG_CONFIRMED");
  assert.equal(record.proposal_authority.field_bindings.model.rule, "EXACT_RAW_MODEL");
  assert.equal(record.proposal_authority.price_evidence_status, "SOURCE_EXPLICIT_USD_USDT");
  assert.equal(record.proposal_digest, sha256(record.proposal_canonical));
  assert.equal(record.proposal_canonical, stable(record.proposal_authority));
  assert.equal(JSON.stringify(manifest).includes("fabricated public quote"), false);
  assert.deepEqual(manifest.canary_listing_ids, [privateCandidate.listing_id]);
});

test("reference binding fails closed when exact raw value is absent or catalog-unconfirmed", () => {
  const proposed = [advisory("reference", "NOT-A-CATALOG-REF")];
  assert.equal(buildAuthority(privateRow(), proposed), null);
  assert.equal(buildAuthority(privateRow({ raw_message: "Omega Constellation black dial" }),
    [advisory("reference", "123.10.24.60.02.001")]), null);
});

test("price binding requires exact amount/currency and private dated FX arithmetic", () => {
  const row = privateRow({ raw_message: "Omega Constellation HKD 40,000", reference: "123.10.24.60.02.001",
    source_price_amount: 40000, source_currency: "HKD", fx_rate: 0.128,
    fx_source: "PRIVATE-FX-ARCHIVE", fx_date: "2026-08-19" });
  const fx = bindPrice(row.raw_message, advisory("price_usd", 5120, {
    price_evidence_status: "DATED_VERIFIED_FX", source_price_amount: 1,
    source_currency: "EUR", fx_rate: 999, fx_source: "PUBLIC-MUST-BE-IGNORED", fx_date: "1999-01-01",
  }), row);
  assert.equal(fx.status, "DATED_VERIFIED_FX");
  assert.equal(fx.value, 5120);
  assert.equal(fx.rule, "NAMED_CURRENCY_DATED_FX");
  assert.equal(bindPrice(row.raw_message, advisory("price_usd", 5200, {
    price_evidence_status: "DATED_VERIFIED_FX", source_price_amount: 40000,
    source_currency: "HKD", fx_rate: 0.128, fx_source: "PUBLIC-FX", fx_date: "2026-08-19",
  }), row), null);
  assert.equal(bindPrice("Omega USD 5,100 and USD 5,200", advisory("price_usd", 5100, {
    price_evidence_status: "SOURCE_EXPLICIT_USD_USDT",
  }), row), null);
});

test("owner-assumed USD is one bare dollar amount and never a named/retail amount", () => {
  const row = privateRow({ raw_message: "Omega Constellation $5,100" });
  assert.equal(bindPrice(row.raw_message, advisory("price_usd", 5100, {
    price_evidence_status: "OWNER_ASSUMED_USD",
  }), row).rule, "OWNER_SINGLE_BARE_DOLLAR");
  assert.equal(bindPrice("Omega Constellation 85k", advisory("price_usd", 85000, {
    price_evidence_status: "OWNER_ASSUMED_USD",
  }), row).rule, "OWNER_SINGLE_BARE_PRICE_SHAPED_AMOUNT");
  assert.equal(bindPrice("Omega Constellation asking 85000", advisory("price_usd", 85000, {
    price_evidence_status: "OWNER_ASSUMED_USD",
  }), row).value, 85000);
  const explicit = bindPrice("Omega USD 5,100", advisory("price_usd", 5100, {
    price_evidence_status: "OWNER_ASSUMED_USD",
  }), row);
  assert.equal(explicit.status, "SOURCE_EXPLICIT_USD_USDT");
  for (const raw of ["Omega MSRP $7,000 now $5,100", "Omega $5,100 HKD 40,000"]) {
    assert.equal(bindPrice(raw, advisory("price_usd", 5100, {
      price_evidence_status: "OWNER_ASSUMED_USD",
    }), row), null);
  }
});

test("deterministic greedy canary covers every available field and price lane within ten per brand", () => {
  const make = (id, brand, fields, priceStatus = null) => ({
    proposal_authority: {
      listing_id: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
      canonical_brand: brand,
      ...Object.fromEntries(fields.map(field => [`proposed_${field}`, field === "price_usd" ? 5000 : "x"])),
      ...(priceStatus ? { price_evidence_status: priceStatus } : {}),
    },
  });
  const records = [
    make(1, "Omega", ["model", "reference"]), make(2, "Omega", ["dial_color", "condition"]),
    make(3, "Omega", ["price_usd"], "SOURCE_EXPLICIT_USD_USDT"),
    make(4, "Omega", ["price_usd"], "OWNER_ASSUMED_USD"),
    make(5, "Omega", ["price_usd"], "DATED_VERIFIED_FX"),
    ...Array.from({ length: 15 }, (_, index) => make(index + 20, "Cartier", ["model"])),
  ];
  const first = selectCanary(records);
  const second = selectCanary([...records].reverse());
  assert.deepEqual(first, second);
  assert.ok(first.plan.Omega.listing_ids.length <= 10);
  assert.ok(first.plan.Cartier.listing_ids.length <= 10);
  assert.deepEqual(first.plan.Omega.uncovered_strata, []);
  assert.deepEqual(first.plan.Cartier.uncovered_strata, []);
  assert.equal(first.sha256, sha256([...first.listing_ids].sort().join("\n")));
});

test("dedicated workflow is QNSA-pinned, checksum-gated, read-only, and short-lived", () => {
  const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows",
    "qnsa-four-brand-private-manifest.yml"), "utf8");
  const producer = fs.readFileSync(path.join(__dirname, "..", "tools", "mariadb-live",
    "build-four-brand-private-enrichment-manifest.cjs"), "utf8");
  assert.match(workflow, /qnsafosakvonzgfcsphh/);
  assert.match(producer, /qnsa_four_brand_private_enrichment_candidates/);
  assert.match(workflow, /advisory_sha256_json/);
  assert.match(workflow, /--run-key/);
  assert.match(workflow, /m\.run_key!==process\.env\.INPUT_RUN_KEY/);
  assert.match(workflow, /projects\/\$env:PROJECT_REF\/api-keys/);
  assert.match(workflow, /::add-mask::\$\(\$service\.api_key\)/);
  assert.match(workflow, /QNSA_RUNTIME_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(workflow, /SUPABASE_SERVICE_ROLE_KEY: \$\{\{ secrets\.SUPABASE_SERVICE_ROLE_KEY \}\}/);
  assert.match(
    workflow,
    /Build service-only private manifest without writes[\s\S]*INPUT_RUN_KEY: \$\{\{ inputs\.run_key \}\}[\s\S]*--run-key',\$env:INPUT_RUN_KEY/,
  );
  assert.match(producer, /run_key: runKey/);
  assert.match(workflow, /Database writes: 0/);
  assert.match(workflow, /retention-days: 3/);
  assert.doesNotMatch(workflow, /stage_qnsa_four_brand_enrichment|activate_qnsa_four_brand_enrichment/);
});

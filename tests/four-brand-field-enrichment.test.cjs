"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const migration = fs.readFileSync(
  path.join(
    root,
    "supabase/migrations/20260820210000_qnsa_four_brand_field_enrichment.sql",
  ),
  "utf8",
);
const forwardReadMigration = fs.readFileSync(
  path.join(
    root,
    "supabase/migrations/20260821010000_qnsa_four_brand_effective_count_detail.sql",
  ),
  "utf8",
);
const inventorySource = fs.readFileSync(
  path.join(root, "api/reviewed-market-inventory.js"),
  "utf8",
);
const researchSource = fs.readFileSync(
  path.join(root, "api/price-research.js"),
  "utf8",
);
const researchDetailSource = fs.readFileSync(
  path.join(root, "api/price-research-listing.js"),
  "utf8",
);
const workflow = fs.readFileSync(
  path.join(root, ".github/workflows/qnsa-four-brand-field-enrichment.yml"),
  "utf8",
);
const runnerSource = fs.readFileSync(
  path.join(root, "tools/mariadb-live/run-four-brand-field-enrichment.cjs"),
  "utf8",
);
const {
  applyEffectiveEnrichment,
  isFourBrand,
  loadEffectiveEnrichments,
  loadEffectivePage,
  loadEffectiveCount,
  loadEffectiveDetail,
} = require("../api/_lib/four-brand-field-enrichment.cjs");
const {
  readManifest,
  recordsForMode,
  stable,
  sha,
} = require("../tools/mariadb-live/run-four-brand-field-enrichment.cjs");
const priceResearchListing = require("../api/price-research-listing.js");

test("sidecar is limited to four brands and never mutates immutable listing sources", () => {
  assert.match(
    migration,
    /canonical_brand IN \('Tudor','Omega','Cartier','Zenith'\)/,
  );
  assert.doesNotMatch(migration, /UPDATE\s+(?:public\.)?raw_message_versions/i);
  assert.doesNotMatch(migration, /UPDATE\s+staging\.listings/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+staging\.listings/i);
  assert.match(migration, /l\.source_hash=p\.source_hash/);
  assert.match(migration, /l\.source_candidate_hash=p\.source_candidate_hash/);
  assert.match(
    migration,
    /l\.raw_message_version_id=p\.raw_message_version_id/,
  );
  assert.match(
    migration,
    /raw_message_versions rv[\s\S]*rv\.source_hash=l\.source_hash/,
  );
});

test("apply gate is missing-only and requires exact raw quote evidence", () => {
  assert.match(migration, /Model is not missing/);
  assert.match(migration, /Reference is not missing/);
  assert.match(migration, /Dial is not missing/);
  assert.match(migration, /Condition is not missing/);
  assert.match(migration, /Price is not missing/);
  assert.match(
    migration,
    /strpos\(COALESCE\(l\.raw_message_text,''\),v_quote\)=0/,
  );
  assert.match(migration, /Field binding mismatch/);
  assert.match(migration, /catalog_reference_confirmed/);
  assert.match(migration, /Explicit USD amount\/currency binding mismatch/);
  assert.match(migration, /Dated FX arithmetic\/provenance mismatch/);
  assert.match(
    migration,
    /Images and dealers require their exact dedicated ledgers/,
  );
});

test("database audit RPC is read-only and is also the staging validation gate", () => {
  const start = migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.validate_qnsa_four_brand_enrichment_records",
  );
  const end = migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.begin_qnsa_four_brand_enrichment",
    start,
  );
  assert.ok(start >= 0 && end > start);
  const validator = migration.slice(start, end);
  assert.match(validator, /LANGUAGE plpgsql STABLE SECURITY DEFINER/);
  assert.doesNotMatch(validator, /\b(?:INSERT|UPDATE|DELETE)\b/i);
  assert.match(validator, /Private exact lineage mismatch/);
  assert.match(validator, /Model is not missing/);
  assert.match(validator, /Trusted proposal digest mismatch/);
  assert.match(validator, /Field binding mismatch/);
  assert.match(validator, /proposal_writes',0,'control_writes',0/);
  assert.match(
    migration,
    /PERFORM public\.validate_qnsa_four_brand_enrichment_records\(p_records\)/,
  );
  assert.match(
    runnerSource,
    /"validate_qnsa_four_brand_enrichment_records"/,
  );
  assert.match(runnerSource, /four_brand_enrichment_database_audit/);
});

test("effective SQL filters before paging and uses exact listing media and dealer evidence", () => {
  const effective = migration.indexOf("qnsa_four_brand_effective_page_rows");
  const selected = migration.indexOf("selected AS (", effective);
  assert.ok(effective >= 0 && selected > effective);
  assert.ok(
    migration.indexOf("p_model IS NULL", selected) <
      migration.indexOf("LIMIT LEAST", selected),
  );
  assert.ok(
    migration.indexOf("p_reference IS NULL", selected) <
      migration.indexOf("LIMIT LEAST", selected),
  );
  assert.match(migration, /NULLIF\(btrim\(l\.image_url\),''\) ~\* '\^https\?:\/\/\[\^\[:space:\]\]\+\$'/);
  assert.match(migration, /COALESCE\(NULLIF\(btrim\(l\.image_url\),''\) ~\*[\s\S]*false\) DESC/);
  assert.match(migration, /THEN btrim\(l\.image_url\) END verified_image_url/);
  assert.doesNotMatch(migration, /NULLIF\(btrim\(l\.image_url\),''\) IS NOT NULL/);
  assert.doesNotMatch(migration, /listing_image_reviews|media_manifest/);
  assert.match(
    migration,
    /dealer_listing_links dl[\s\S]*dl\.link_status='APPLIED'/,
  );
  for (const filter of ["p_images_only", "p_priced_only", "p_posted_after", "p_region", "p_rating"]) {
    assert.ok(migration.indexOf(filter, selected) < migration.indexOf("LIMIT LEAST", selected));
  }
  assert.doesNotMatch(migration.slice(effective), /MATERIALIZED/);
  assert.match(migration, /LEFT JOIN public\.qnsa_four_brand_effective_enrichment ep/);
  assert.match(migration.slice(effective), /jsonb_build_object\([\s\S]*\) \|\| jsonb_build_object\(/);
});

test("activation is one atomic control switch with exact canary IDs", () => {
  assert.match(migration, /qnsa_four_brand_enrichment_control/);
  assert.match(migration, /enabled_listing_ids/);
  assert.match(migration, /atomic_control_switch/);
  assert.match(migration, /GROUP BY p\.canonical_brand HAVING count\(\*\)>10/);
  assert.doesNotMatch(migration, /qnsa_four_brand_enrichment_active/);
  assert.doesNotMatch(migration, /activated_in_call/);
  assert.doesNotMatch(runnerSource, /activate_batch|p_limit:[\s\S]*activate_qnsa_four_brand_enrichment/);
  assert.match(runnerSource, /four_brand_enrichment_atomic_control_switch/);
});

test("owner-assumed USD displays but remains independently unverified", () => {
  const base = {
    id: "11111111-1111-4111-8111-111111111111",
    canonical_brand: "Cartier",
    model: "Cartier",
    normalized_reference: "WSSA0009",
    listing_type: "WTS",
    workbook_price_usd: null,
    source_price_amount: null,
    verified_price_usd: null,
    has_verified_usd_price: false,
  };
  const effective = applyEffectiveEnrichment(base, {
    listing_id: base.id,
    canonical_brand: "Cartier",
    model: "Santos de Cartier",
    price_usd: 6500,
    source_price_amount: 6500,
    source_currency: "USD",
    price_evidence_status: "OWNER_ASSUMED_USD",
    run_key: "test-run",
  });
  assert.equal(effective.model, "Santos de Cartier");
  assert.equal(effective.workbook_price_usd, 6500);
  assert.equal(effective.price_evidence_status, "OWNER_ASSUMED_USD");
  assert.equal(effective.verified_price_usd, null);
  assert.equal(effective.has_verified_usd_price, false);
});

test("defensive API merge never overwrites populated fields", () => {
  const base = {
    id: "11111111-1111-4111-8111-111111111111",
    canonical_brand: "Omega",
    model: "Speedmaster",
    normalized_reference: "310.30.42.50.01.001",
    dial_color: "Black",
    condition: "New",
    verified_price_usd: 8000,
  };
  const effective = applyEffectiveEnrichment(base, {
    listing_id: base.id,
    canonical_brand: "Omega",
    model: "Seamaster",
    reference: "WRONG",
    dial_color: "Blue",
    condition: "Used",
    price_usd: 10,
    price_evidence_status: "SOURCE_EXPLICIT_USD_USDT",
  });
  assert.equal(effective.model, base.model);
  assert.equal(effective.normalized_reference, base.normalized_reference);
  assert.equal(effective.dial_color, base.dial_color);
  assert.equal(effective.condition, base.condition);
  assert.equal(effective.verified_price_usd, base.verified_price_usd);
  assert.equal(isFourBrand("Vacheron Constantin"), false);
});

test("Trading Floor and Price Research both use the same effective RPC", () => {
  assert.match(inventorySource, /qnsa_four_brand_effective_page_rows/);
  assert.match(inventorySource, /p_model: requestedModel/);
  assert.match(inventorySource, /p_reference: requestedReference/);
  assert.match(inventorySource, /p_dial: requestedDial/);
  assert.match(inventorySource, /p_condition: condition/);
  assert.match(inventorySource, /p_search: search/);
  assert.match(inventorySource, /p_images_only: imagesOnly/);
  assert.match(inventorySource, /p_priced_only: pricedOnly/);
  assert.match(inventorySource, /!preloadedQnsaResponse[\s\S]*brand && reference/);
  assert.match(inventorySource, /loadEffectiveEnrichments\(client, eligibleRows\)/);
  assert.match(researchSource, /loadEffectivePage\(client/);
  assert.match(researchSource, /references: referenceVariants\.slice/);
  assert.doesNotMatch(researchSource, /Promise\.all\(referenceVariants\.slice/);
  assert.match(researchSource, /listingType: 'WTS'/);
  assert.match(researchSource, /listingType: 'WTB'/);
});

test("four-brand effective pages use one offset stream and never inherit six-brand media cursors", () => {
  assert.match(
    inventorySource,
    /const sixBrandCompositeScope = sixBrandBroadScope[\s\S]*!fourBrandEffectiveScope/,
  );
  assert.match(
    inventorySource,
    /const qnsaUnpartitionedMedia =[\s\S]*fourBrandEffectiveScope/,
  );
  assert.match(inventorySource, /if \(fourBrandEffectiveScope && firstEffectiveCountPage\) \{[\s\S]*loadEffectiveCount\(client/);
  assert.doesNotMatch(
    inventorySource,
    /const fourBrandEffectiveScope[^;]+;[\s\S]*const fourBrandEffectiveScope/,
  );
});

test("forward count shares every effective-page eligibility and customer filter", () => {
  assert.match(forwardReadMigration, /qnsa_four_brand_effective_row_count/);
  for (const predicate of [
    "l.parent_id IS NULL AND COALESCE(l.is_bundle,false)=false",
    "COALESCE(l.provenance_metadata->>'bundle_status','SINGLE_CANDIDATE')='SINGLE_CANDIDATE'",
    "suppressed_exact_duplicate",
    "l.source_candidate_hash=r.source_candidate_hash",
    "upper(COALESCE(l.listing_type,l.intent,'')) IN ('WTS','WTB')",
    "p_listing_type IS NULL",
    "p_images_only",
    "p_priced_only",
    "p_posted_after",
    "p_region",
    "p_rating",
    "p_model IS NULL",
    "p_reference IS NULL",
    "p_references IS NULL",
    "p_dial IS NULL",
    "p_condition IS NULL",
    "p_search IS NULL",
  ]) {
    assert.ok(migration.includes(predicate), `page predicate missing: ${predicate}`);
    assert.ok(forwardReadMigration.includes(predicate), `count predicate missing: ${predicate}`);
  }
  assert.doesNotMatch(forwardReadMigration, /\b(?:INSERT|UPDATE|DELETE)\b/i);
  assert.doesNotMatch(forwardReadMigration, /LIMIT\s+2500|OFFSET\s+/i);
});

test("exact four-brand detail is indexed by UUID and bypasses the legacy research scan", () => {
  assert.match(forwardReadMigration, /qnsa_four_brand_effective_detail\(p_listing_id uuid\)/);
  assert.match(forwardReadMigration, /WHERE l\.id=p_listing_id/);
  for (const manifest of ["omega", "cartier", "tudor"]) {
    assert.match(forwardReadMigration, new RegExp(`qnsa_${manifest}_release_manifest m ON m\\.listing_id=s\\.id`));
  }
  const effectiveCall = researchDetailSource.indexOf("await loadEffectiveDetail(client, id)");
  const legacyScan = researchDetailSource.indexOf("await loadQnsaReleaseListing(client, id)");
  assert.ok(effectiveCall >= 0 && legacyScan > effectiveCall);
  assert.match(
    researchDetailSource.slice(effectiveCall, legacyScan),
    /if \(effectiveDetail\?\.fourBrandScope\)[\s\S]*return res\.status\(200\)/,
  );
  const publicDetail = priceResearchListing.effectiveDetailListing({
    id: "11111111-1111-4111-8111-111111111111",
    canonical_brand: "Zenith",
    raw_message: "Zenith 03.2522.400 USD 8,500 WhatsApp +1 305 555 1212",
    has_exact_source_image: false,
  });
  assert.match(publicDetail.raw_message, /Zenith 03\.2522\.400 USD 8,500/);
  assert.doesNotMatch(publicDetail.raw_message, /305|555|1212/);
});

test("exact count runs on the first cursor page only and is never a row gate", () => {
  assert.match(inventorySource, /const firstEffectiveCountPage = pagination === 'cursor'/);
  assert.match(inventorySource, /!cursorProvided && page === 1 && \(inventoryCursor\?\.offset \|\| 0\) === 0/);
  assert.match(inventorySource, /if \(fourBrandEffectiveScope && firstEffectiveCountPage\)/);
  assert.match(inventorySource, /else if \(fourBrandEffectiveScope\)[\s\S]*publicInventoryTotal = null/);
  assert.match(inventorySource, /four-brand exact count unavailable; total withheld/);
});

test("runner validates private exact lineage and produces a deterministic plan", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "four-brand-enrichment-"),
  );
  const file = path.join(directory, "manifest.json");
  const authority = {
    generator_version: "four-brand-private-manifest-v1",
    listing_id: "11111111-1111-4111-8111-111111111111",
    raw_message_version_id: "22222222-2222-4222-8222-222222222222",
    canonical_brand: "Tudor",
    source_record_id: "private-source-1",
    source_hash: "a".repeat(64),
    source_candidate_hash: "b".repeat(64),
    proposed_condition: "New",
    evidence: { condition_quote: "brand new" },
    field_bindings: { condition: { rule: "EXPLICIT_CONDITION_PHRASE" } },
  };
  const canaryIds = [authority.listing_id];
  const proposalCanonical = stable(authority);
  fs.writeFileSync(file, JSON.stringify({
    contract: "four-brand-private-enrichment-manifest-v1",
    run_key: "test-run-key",
    records: [{ proposal_authority: authority, proposal_canonical: proposalCanonical,
      proposal_digest: sha(proposalCanonical) }],
    canary_listing_ids: canaryIds,
    canary_plan_sha256: sha(canaryIds.join("\n")),
  }));
  const manifest = readManifest(file, "test-run-key");
  assert.equal(manifest.records.length, 1);
  assert.deepEqual(manifest.canaryListingIds, canaryIds);
  assert.deepEqual(
    recordsForMode(manifest.records, "canary", canaryIds),
    manifest.records,
  );
  assert.throws(
    () => readManifest(file, "different-run-key"),
    /run key does not match/,
  );
  assert.match(sha(stable(manifest.records)), /^[0-9a-f]{64}$/);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("missing additive RPC preserves base paths without claiming enrichment", async () => {
  const row = { id: "11111111-1111-4111-8111-111111111111", canonical_brand: "Omega" };
  const client = { rpc: async () => ({ data: null, error: { code: "PGRST202", message: "schema cache" } }) };
  assert.deepEqual(await loadEffectiveEnrichments(client, [row]), [row]);
  assert.equal(await loadEffectivePage(client, { brand: "Omega" }), null);
  assert.equal(await loadEffectiveCount(client, { brand: "Omega" }), null);
  assert.equal(await loadEffectiveDetail(client, row.id), null);
});

test("count and exact detail RPCs are bounded and preserve their response contracts", async () => {
  const calls = [];
  const client = { rpc: async (name, args) => {
    calls.push({ name, args });
    if (name === "qnsa_four_brand_effective_row_count") return { data: 42, error: null };
    return { data: { four_brand_scope: true, row_data: { id: args.p_listing_id } }, error: null };
  } };
  assert.equal(await loadEffectiveCount(client, {
    brand: "Zenith", listingType: "WTS", reference: "03.2522.400",
    imagesOnly: true, pricedOnly: true,
  }), 42);
  const id = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(await loadEffectiveDetail(client, id), {
    installed: true, fourBrandScope: true, row: { id },
  });
  assert.deepEqual(calls.map(call => call.name), [
    "qnsa_four_brand_effective_row_count",
    "qnsa_four_brand_effective_detail",
  ]);
  assert.equal(calls[0].args.p_reference, "03.2522.400");
  assert.equal(calls[0].args.p_images_only, true);
  assert.deepEqual(calls[1].args, { p_listing_id: id });
});

test("OWNER_ASSUMED_USD is customer-visible excluded evidence only", () => {
  const {
    isCustomerPricedSaleEvidence,
    normalizeAnalyticsPriceRow,
  } = require("../api/price-research.js");
  const normalized = normalizeAnalyticsPriceRow({
    canonical_qnsa_price_evidence_checked: true,
    listing_type: "WTS",
    price_usd: 6500,
    price_evidence_status: "OWNER_ASSUMED_USD",
  }, { usingQnsaReviewedSource: true });
  assert.equal(normalized.analytics_price_usd, 6500);
  assert.equal(normalized.analytics_currency_status, "OWNER_ASSUMED_USD");
  assert.equal(normalized.price_normalization, "OWNER_ASSUMED_USD_TRACKED_ONLY");
  assert.equal(isCustomerPricedSaleEvidence({ ...normalized, price_usd: 6500 }), true);
  assert.match(researchSource, /OWNER_ASSUMED_USD_TRACKED_ONLY_EXCLUDED_FROM_INDEPENDENT_AGGREGATES/);
});

test("effective detail never promotes an unresolved owner-assumed candidate amount", () => {
  assert.doesNotMatch(
    forwardReadMigration,
    /WHEN e\.price_lane='OWNER_ASSUMED_USD_CANDIDATE' THEN e\.price_normalized/,
  );
  assert.match(
    forwardReadMigration,
    /CASE WHEN e\.price_lane IN \('SOURCE_EXPLICIT_USD_USDT','DATED_VERIFIED_FX'\) THEN e\.price_normalized END/,
  );
});

test("workflow is QNSA-pinned, private-artifact based, bounded, and rollback capable", () => {
  assert.match(workflow, /qnsafosakvonzgfcsphh/);
  assert.match(workflow, /actions\/download-artifact@v4/);
  assert.match(workflow, /manifest_sha256/);
  assert.match(workflow, /ACTIVATE_CANARY_/);
  assert.match(workflow, /ACTIVATE_FULL_/);
  assert.match(workflow, /ROLLBACK_/);
  assert.match(workflow, /qnsa-four-brand-field-enrichment/);
  assert.match(workflow, /qnsa_four_brand_enrichment_schema_contract/);
  assert.match(workflow, /SCHEMA_CONTRACT_VERSION/);
  assert.match(workflow, /FORWARD_READ_MIGRATION_SHA256/);
  assert.match(workflow, /20260821010000_qnsa_four_brand_effective_count_detail\.sql/);
  assert.match(workflow, /Pinned forward read migration SHA mismatch/);
  assert.match(workflow, /MIGRATION_VERSION: '20260820210000'/);
  assert.match(workflow, /supabase_migrations\.schema_migrations/);
  assert.match(
    workflow,
    /to_regclass\('supabase_migrations\.schema_migrations'\) IS NOT NULL AS migration_table_exists;[\s\S]*if \(\[bool\]\$preflight\[0\]\.migration_table_exists\) \{[\s\S]*SELECT EXISTS \(SELECT 1 FROM supabase_migrations\.schema_migrations/,
  );
  assert.match(workflow, /Migration version exists without the exact schema contract marker/);
  assert.match(workflow, /Unversioned sidecar schema exists; refusing install/);
  assert.match(workflow, /Existing sidecar schema contract is incompatible/);
  assert.doesNotMatch(workflow, /INPUT_MODE -ceq 'audit'\) \{ 'ROLLBACK;'/);
  assert.match(workflow, /Verify trusted private-manifest run and artifact provenance/);
  assert.match(workflow, /actions\/workflows\/qnsa-four-brand-private-manifest\.yml/);
  assert.match(workflow, /sourceRun\.workflow_id/);
  assert.match(workflow, /sourceRun\.conclusion -cne 'success'/);
  assert.match(workflow, /sourceRun\.head_sha -cne \$env:GITHUB_SHA/);
  assert.match(workflow, /qnsa-four-brand-private-manifest-\$\(\$env:INPUT_RUN_KEY\)/);
  assert.match(workflow, /manifest\.run_key -cne \$env:INPUT_RUN_KEY/);
  assert.match(workflow, /Install sidecar schema only under explicit schema authorization[\s\S]*if: inputs\.mode == 'schema'/);
  assert.match(workflow, /Verify exact installed schema contract without DDL[\s\S]*if: inputs\.mode != 'schema'/);
  assert.match(workflow, /projects\/\$env:PROJECT_REF\/api-keys/);
  assert.match(workflow, /QNSA_RUNTIME_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(workflow, /SUPABASE_SERVICE_ROLE_KEY: \$\{\{ secrets\.SUPABASE_SERVICE_ROLE_KEY \}\}/);
  const installStart = workflow.indexOf("- name: Install sidecar schema only");
  const installedCheck = workflow.indexOf("- name: Verify exact installed schema contract", installStart);
  assert.ok(installStart >= 0 && installedCheck > installStart);
  assert.doesNotMatch(workflow.slice(installedCheck), /\$migration = Get-Content/);
});

test("canary stages only the preselected exact IDs while retaining the full plan", () => {
  const makeRecord = (id, brand) => ({
    proposal_authority: { listing_id: id, canonical_brand: brand },
  });
  const records = [
    makeRecord("11111111-1111-4111-8111-111111111111", "Omega"),
    makeRecord("22222222-2222-4222-8222-222222222222", "Omega"),
  ];
  const selected = recordsForMode(records, "canary", [
    "22222222-2222-4222-8222-222222222222",
  ]);
  assert.deepEqual(selected, [records[1]]);
  assert.equal(recordsForMode(records, "full", []).length, 2);
  assert.match(runnerSource, /p_plan_sha256: planSha256/);
  assert.match(runnerSource, /p_expected_count: stagedRecords\.length/);
  assert.match(runnerSource, /p_records: stagedRecords\.slice/);
});

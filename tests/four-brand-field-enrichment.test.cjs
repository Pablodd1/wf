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
const inventorySource = fs.readFileSync(
  path.join(root, "api/reviewed-market-inventory.js"),
  "utf8",
);
const researchSource = fs.readFileSync(
  path.join(root, "api/price-research.js"),
  "utf8",
);
const workflow = fs.readFileSync(
  path.join(root, ".github/workflows/qnsa-four-brand-field-enrichment.yml"),
  "utf8",
);
const {
  applyEffectiveEnrichment,
  isFourBrand,
} = require("../api/_lib/four-brand-field-enrichment.cjs");
const {
  readManifest,
  stable,
  sha,
} = require("../tools/mariadb-live/run-four-brand-field-enrichment.cjs");

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
    /strpos\(COALESCE\(l\.raw_message_text,''\),e\.value\)=0/,
  );
  assert.match(
    migration,
    /Images and dealers require their exact dedicated ledgers/,
  );
});

test("effective SQL filters before paging and uses only exact image/dealer ledgers", () => {
  const effective = migration.indexOf("qnsa_four_brand_effective_page_rows");
  const selected = migration.indexOf("selected AS MATERIALIZED", effective);
  assert.ok(effective >= 0 && selected > effective);
  assert.ok(
    migration.indexOf("p_model IS NULL", selected) <
      migration.indexOf("LIMIT LEAST", selected),
  );
  assert.ok(
    migration.indexOf("p_reference IS NULL", selected) <
      migration.indexOf("LIMIT LEAST", selected),
  );
  assert.match(
    migration,
    /listing_image_reviews ir[\s\S]*ir\.status='VISUALLY_VERIFIED'/,
  );
  assert.match(
    migration,
    /media_manifest mm[\s\S]*mm\.verification_status='url_reachable'/,
  );
  assert.match(
    migration,
    /dealer_listing_links dl[\s\S]*dl\.link_status='APPLIED'/,
  );
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
  assert.match(inventorySource, /loadEffectiveEnrichments\(client, eligibleRows\)/);
  assert.match(researchSource, /loadEffectivePage\(client/);
  assert.match(researchSource, /listingType: 'WTS'/);
  assert.match(researchSource, /listingType: 'WTB'/);
});

test("runner validates private exact lineage and produces a deterministic plan", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "four-brand-enrichment-"),
  );
  const file = path.join(directory, "manifest.json");
  const record = {
    listing_id: "11111111-1111-4111-8111-111111111111",
    raw_message_version_id: "22222222-2222-4222-8222-222222222222",
    canonical_brand: "Tudor",
    source_record_id: "private-source-1",
    source_hash: "a".repeat(64),
    source_candidate_hash: "b".repeat(64),
    proposed_condition: "New",
    evidence: { condition_quote: "brand new" },
  };
  fs.writeFileSync(file, JSON.stringify({ records: [record] }));
  const records = readManifest(file);
  assert.equal(records.length, 1);
  assert.match(sha(stable(records)), /^[0-9a-f]{64}$/);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("workflow is QNSA-pinned, private-artifact based, bounded, and rollback capable", () => {
  assert.match(workflow, /qnsafosakvonzgfcsphh/);
  assert.match(workflow, /actions\/download-artifact@v4/);
  assert.match(workflow, /manifest_sha256/);
  assert.match(workflow, /ACTIVATE_CANARY_/);
  assert.match(workflow, /ACTIVATE_FULL_/);
  assert.match(workflow, /ROLLBACK_/);
  assert.match(workflow, /qnsa-four-brand-field-enrichment/);
});

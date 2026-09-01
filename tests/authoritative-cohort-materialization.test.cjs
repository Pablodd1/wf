const fs = require("node:fs");
const test = require("node:test");
const assert = require("node:assert");

function selectAuthoritativeVersion(rows) {
  const sorted = [...rows].sort((a, b) => {
    // 1. Canonical source_record_id (mysql_auctions_<id>)
    const aCanon = a.source_record_id === `mysql_auctions_${a.source_id}` ? 1 : 2;
    const bCanon = b.source_record_id === `mysql_auctions_${b.source_id}` ? 1 : 2;
    if (aCanon !== bCanon) return aCanon - bCanon;

    // 2. Strict ISO 8601 timestamp (%T%Z)
    const aIso = (a.source_created_on || "").includes("T") && (a.source_created_on || "").endsWith("Z") ? 1 : 2;
    const bIso = (b.source_created_on || "").includes("T") && (b.source_created_on || "").endsWith("Z") ? 1 : 2;
    if (aIso !== bIso) return aIso - bIso;

    // 3. Canonicalization version (v1-json-keys-sorted-compact)
    const aVer = a.canonicalization_version === "v1-json-keys-sorted-compact" ? 1 : 2;
    const bVer = b.canonicalization_version === "v1-json-keys-sorted-compact" ? 1 : 2;
    if (aVer !== bVer) return aVer - bVer;

    // 4. Deterministic source_hash tie-breaker
    const hashCmp = (a.source_hash || "").localeCompare(b.source_hash || "");
    if (hashCmp !== 0) return hashCmp;

    // 5. Raw staging UUID tie-breaker
    return (a.id || "").localeCompare(b.id || "");
  });

  return sorted[0];
}

test("Authoritative Precedence: Cross-page duplicate source IDs select globally authoritative record", () => {
  const testSourceId = "test-uuid-cross-page-1234";

  // Simulate multiple versions across chunks / time boundaries
  const legacyChunkVersion = {
    id: "00000000-0000-0000-0000-000000000001",
    source_id: testSourceId,
    source_record_id: "legacy_auctions_1234",
    source_created_on: "2025-05-10 12:00:00",
    canonicalization_version: "legacy-uncompacted",
    source_hash: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
  };

  const intermediateVersion = {
    id: "00000000-0000-0000-0000-000000000002",
    source_id: testSourceId,
    source_record_id: `mysql_auctions_${testSourceId}`,
    source_created_on: "2025-05-10 12:00:00", // Non-ISO
    canonicalization_version: "v1-json-keys-sorted-compact",
    source_hash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  };

  const globallyAuthoritativeVersion = {
    id: "00000000-0000-0000-0000-000000000003",
    source_id: testSourceId,
    source_record_id: `mysql_auctions_${testSourceId}`,
    source_created_on: "2025-05-10T12:00:00.000Z", // Strict ISO
    canonicalization_version: "v1-json-keys-sorted-compact",
    source_hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  };

  // Test across arbitrary chunk orderings
  const permutations = [
    [legacyChunkVersion, intermediateVersion, globallyAuthoritativeVersion],
    [globallyAuthoritativeVersion, legacyChunkVersion, intermediateVersion],
    [intermediateVersion, globallyAuthoritativeVersion, legacyChunkVersion],
    [legacyChunkVersion, globallyAuthoritativeVersion, intermediateVersion]
  ];

  for (const perm of permutations) {
    const selected = selectAuthoritativeVersion(perm);
    assert.strictEqual(selected.id, globallyAuthoritativeVersion.id, "Must always select globally authoritative version regardless of chunk ingestion order");
    assert.strictEqual(selected.source_record_id, `mysql_auctions_${testSourceId}`);
    assert.strictEqual(selected.source_created_on, "2025-05-10T12:00:00.000Z");
  }
});

test("Materialization Swap Contract: Prohibits DROP CASCADE and preserves attached consumer views", () => {
  const materializerSource = fs.readFileSync("tools/mariadb-live/materialize_full_authoritative_cohort.py", "utf-8");

  assert.strictEqual(
    materializerSource.includes("DROP TABLE IF EXISTS wf_canonical_staging.mariadb_authoritative_raw_source_rows CASCADE"),
    false,
    "Must NOT use DROP TABLE ... CASCADE on consumer view target"
  );

  assert.strictEqual(
    materializerSource.includes("CREATE OR REPLACE VIEW wf_canonical_staging.mariadb_authoritative_raw_source_rows AS"),
    true,
    "Must use CREATE OR REPLACE VIEW stable consumer view pattern"
  );

  assert.strictEqual(
    materializerSource.includes("DROP TABLE IF EXISTS wf_canonical_staging.mariadb_authoritative_raw_source_rows_old;"),
    true,
    "Must drop old physical table strictly without CASCADE"
  );
});

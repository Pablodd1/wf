import os
import sys
import json
import psycopg2

db_url = os.environ.get("DATABASE_URL")
if not db_url:
  print("FATAL: DATABASE_URL required.", file=sys.stderr)
  sys.exit(1)

conn = psycopg2.connect(db_url)
cur = conn.cursor()
cur.execute("SET statement_timeout = '600s';")

FROZEN_CURSOR_DATE = "2026-04-28T15:50:43.000Z"
FROZEN_CURSOR_ID = "3cddaf9f-9f36-4633-a08e-59a6dfdca057"

print("==================================================================")
print("STAGE 1: Global Read-Only Reconciliation of Authoritative Table")
print("==================================================================")

print("Executing unpaginated global ROW_NUMBER() reconciliation query across complete frozen cohort...")

cur.execute("""
  WITH ranked AS (
    SELECT 
      source_id,
      source_hash,
      source_created_on,
      source_record_id,
      ROW_NUMBER() OVER (
        PARTITION BY source_id
        ORDER BY
          CASE WHEN source_record_id = 'mysql_auctions_' || source_id THEN 1 ELSE 2 END ASC,
          CASE WHEN source_created_on LIKE '%%T%%Z' THEN 1 ELSE 2 END ASC,
          CASE WHEN canonicalization_version = 'v1-json-keys-sorted-compact' THEN 1 ELSE 2 END ASC,
          source_hash ASC,
          id ASC
      ) as rn
    FROM wf_canonical_staging.mariadb_raw_source_rows
    WHERE source_system = 'OceanDigital MariaDB'
      AND source_database = 'thecollective_inventory'
      AND source_table = 'auctions'
      AND (source_created_on, source_id) <= (%s, %s)
  ),
  expected_authoritative AS (
    SELECT source_id, source_hash, source_created_on, source_record_id
    FROM ranked
    WHERE rn = 1
  )
  SELECT 
    COUNT(*) as total_evaluated,
    COUNT(CASE WHEN a.source_hash = e.source_hash THEN 1 END) as matching_hashes,
    COUNT(CASE WHEN a.source_hash != e.source_hash THEN 1 END) as mismatched_hashes,
    COUNT(CASE WHEN a.source_id IS NULL THEN 1 END) as missing_in_active,
    COUNT(CASE WHEN e.source_id IS NULL THEN 1 END) as extra_in_active
  FROM expected_authoritative e
  FULL OUTER JOIN wf_canonical_staging.mariadb_authoritative_raw_source_rows a
    ON e.source_id = a.source_id;
""", (FROZEN_CURSOR_DATE, FROZEN_CURSOR_ID))

tot, match, mismatch, missing, extra = cur.fetchone()
print(f"Reconciliation Summary across {tot:,} unique source IDs:")
print(f"  - Matching Winning Hashes: {match:,}")
print(f"  - Mismatched Hashes:       {mismatch:,}")
print(f"  - Missing in Active Table: {missing:,}")
print(f"  - Extra in Active Table:   {extra:,}")

mismatches = []
if mismatch > 0 or missing > 0 or extra > 0:
  print("\nFetching sample mismatches...")
  cur.execute("""
    WITH ranked AS (
      SELECT 
        source_id, source_hash, source_created_on, source_record_id,
        ROW_NUMBER() OVER (
          PARTITION BY source_id
          ORDER BY
            CASE WHEN source_record_id = 'mysql_auctions_' || source_id THEN 1 ELSE 2 END ASC,
            CASE WHEN source_created_on LIKE '%%T%%Z' THEN 1 ELSE 2 END ASC,
            CASE WHEN canonicalization_version = 'v1-json-keys-sorted-compact' THEN 1 ELSE 2 END ASC,
            source_hash ASC,
            id ASC
        ) as rn
      FROM wf_canonical_staging.mariadb_raw_source_rows
      WHERE source_system = 'OceanDigital MariaDB'
        AND source_database = 'thecollective_inventory'
        AND source_table = 'auctions'
        AND (source_created_on, source_id) <= (%s, %s)
    ),
    expected_authoritative AS (
      SELECT source_id, source_hash, source_created_on, source_record_id
      FROM ranked
      WHERE rn = 1
    )
    SELECT e.source_id, e.source_hash, a.source_hash, e.source_created_on, a.source_created_on
    FROM expected_authoritative e
    FULL OUTER JOIN wf_canonical_staging.mariadb_authoritative_raw_source_rows a
      ON e.source_id = a.source_id
    WHERE a.source_hash IS DISTINCT FROM e.source_hash
    LIMIT 20;
  """, (FROZEN_CURSOR_DATE, FROZEN_CURSOR_ID))
  mismatches = [{
    "source_id": r[0], "expected_hash": r[1], "actual_hash": r[2],
    "expected_created": r[3], "actual_created": r[4]
  } for r in cur.fetchall()]

report = {
  "contract": "wf-global-authoritative-reconciliation-v1",
  "frozen_scope": {
    "upper_cursor_created_on": FROZEN_CURSOR_DATE,
    "upper_cursor_source_id": FROZEN_CURSOR_ID,
    "expected_unique_source_ids": 951743
  },
  "reconciliation_result": {
    "total_unique_source_ids": tot,
    "matching_winning_hashes": match,
    "mismatched_hashes": mismatch,
    "missing_in_active": missing,
    "extra_in_active": extra,
    "pass_rate_percentage": 100.0 if tot == match and mismatch == 0 else (match / tot * 100.0)
  },
  "sample_mismatches": mismatches
}

os.makedirs("audit-output/mariadb-live/canonical-scope-contamination", exist_ok=True)
out_path = "audit-output/mariadb-live/canonical-scope-contamination/global_authoritative_reconciliation_report.json"
with open(out_path, "w", encoding="utf-8") as f:
  json.dump(report, f, indent=2)

print(f"\nSaved global reconciliation report to {out_path}")
assert mismatch == 0, f"Found {mismatch} hash mismatches!"
assert missing == 0, f"Found {missing} missing rows in active table!"
assert extra == 0, f"Found {extra} extra rows in active table!"
assert tot == 951743, f"Expected 951,743 rows, found {tot}!"
print("\nGLOBAL RECONCILIATION PASSED: 100% of 951,743 active rows match unpaginated ROW_NUMBER() ranking!")

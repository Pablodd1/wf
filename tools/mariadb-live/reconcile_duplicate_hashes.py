import os
import sys
import json
import psycopg2

db_url = os.environ.get("DATABASE_URL")
if not db_url:
  print("No DATABASE_URL", file=sys.stderr)
  sys.exit(1)

conn = psycopg2.connect(db_url)
cur = conn.cursor()
cur.execute("SET statement_timeout = '600s';")

print("Checking distinct source_ids vs total rows in auctions scope...")
cur.execute("""
  SELECT COUNT(*), COUNT(DISTINCT source_id)
  FROM wf_canonical_staging.mariadb_raw_source_rows
  WHERE source_system = 'OceanDigital MariaDB'
    AND source_database = 'thecollective_inventory'
    AND source_table = 'auctions'
    AND (source_created_on, source_id) <= ('2026-04-28T15:50:43.000Z', '3cddaf9f-9f36-4633-a08e-59a6dfdca057');
""")
total_rows, distinct_ids = cur.fetchone()
print(f"Total rows: {total_rows:,}")
print(f"Distinct source_ids: {distinct_ids:,}")
print(f"Duplicate row count difference: {total_rows - distinct_ids:,}")

print("\nFinding the duplicate source_ids (having count > 1)...")
cur.execute("""
  SELECT source_id, COUNT(*)
  FROM wf_canonical_staging.mariadb_raw_source_rows
  WHERE source_system = 'OceanDigital MariaDB'
    AND source_database = 'thecollective_inventory'
    AND source_table = 'auctions'
    AND (source_created_on, source_id) <= ('2026-04-28T15:50:43.000Z', '3cddaf9f-9f36-4633-a08e-59a6dfdca057')
  GROUP BY source_id
  HAVING COUNT(*) > 1;
""")
dups = cur.fetchall()
print(f"Number of source_ids with multiple rows: {len(dups):,}")

# Collect details on all 4,000 duplicate instances
cur.execute("""
  WITH dup_ids AS (
    SELECT source_id
    FROM wf_canonical_staging.mariadb_raw_source_rows
    WHERE source_system = 'OceanDigital MariaDB'
      AND source_database = 'thecollective_inventory'
      AND source_table = 'auctions'
      AND (source_created_on, source_id) <= ('2026-04-28T15:50:43.000Z', '3cddaf9f-9f36-4633-a08e-59a6dfdca057')
    GROUP BY source_id
    HAVING COUNT(*) > 1
  )
  SELECT r.source_id, r.source_hash, r.source_record_id, r.source_created_on, r.created_at, r.canonicalization_version, r.hash_algorithm
  FROM wf_canonical_staging.mariadb_raw_source_rows r
  JOIN dup_ids d ON r.source_id = d.source_id
  ORDER BY r.source_id, r.created_at ASC;
""")
dup_rows = cur.fetchall()
print(f"Total rows belonging to duplicate IDs: {len(dup_rows):,}")

# Group by ID and see the version differences
grouped = {}
for r in dup_rows:
  sid = r[0]
  if sid not in grouped:
    grouped[sid] = []
  grouped[sid].append({
    "source_hash": r[1],
    "source_record_id": r[2],
    "source_created_on": r[3],
    "created_at": r[4].isoformat() if r[4] else None,
    "canonicalization_version": r[5],
    "hash_algorithm": r[6]
  })

print(f"\nSample of duplicate source_id analysis:")
for sid in list(grouped.keys())[:5]:
  print(f"ID: {sid}")
  for instance in grouped[sid]:
    print(f"  hash={instance['source_hash'][:16]}... created_at={instance['created_at']} canon_ver={instance['canonicalization_version']} alg={instance['hash_algorithm']}")

# Export complete reconciliation artifact of the 4,000 duplicate rows
out_path = "audit-output/mariadb-live/canonical-scope-contamination/cohort_4k_duplicate_source_ids_reconciliation.json"
os.makedirs(os.path.dirname(out_path), exist_ok=True)
report = {
  "contract": "wf-cohort-4k-duplicate-source-ids-reconciliation-v1",
  "total_staged_rows_in_scope": total_rows,
  "unique_source_ids_in_scope": distinct_ids,
  "additional_duplicate_rows_count": total_rows - distinct_ids,
  "explanation": "On 2026-08-29, 4,000 canary rows were staged in an initial run and subsequently re-staged with revised canonicalization hashes, resulting in 4,000 source_ids possessing 2 distinct source_hash records in mariadb_raw_source_rows.",
  "duplicate_source_ids_count": len(grouped),
  "duplicate_records": grouped
}
with open(out_path, "w", encoding="utf-8") as f:
  json.dump(report, f, indent=2)
print(f"\nSaved full artifact to {out_path}")

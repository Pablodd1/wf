# tools/mariadb-live/rebuild_duplicate_reconciliation_artifact.py
import os
import sys
import json
import hashlib
from datetime import datetime, timezone
import psycopg2

if hasattr(sys.stdout, "reconfigure"):
  sys.stdout.reconfigure(encoding="utf-8", errors="replace")

def rebuild():
  db_url = os.environ.get("DATABASE_URL")
  if not db_url:
    print("FATAL: DATABASE_URL required.", file=sys.stderr)
    sys.exit(1)

  conn = psycopg2.connect(db_url)
  cur = conn.cursor()
  cur.execute("SET statement_timeout = '600s';")

  source_system = 'OceanDigital MariaDB'
  source_database = 'thecollective_inventory'
  source_table = 'auctions'
  cursor_date = '2026-04-28T15:50:43.000Z'
  cursor_id = '3cddaf9f-9f36-4633-a08e-59a6dfdca057'

  print("==================================================================")
  print("1. QUERYING EXACT SCOPED COUNTS UNDER FROZEN UPPER BOUNDARY")
  print("==================================================================")
  cur.execute("""
    SELECT 
      COUNT(*) AS total_scoped_rows,
      COUNT(DISTINCT source_id) AS unique_source_ids
    FROM wf_canonical_staging.mariadb_raw_source_rows
    WHERE source_system = %s
      AND source_database = %s
      AND source_table = %s
      AND (source_created_on, source_id) <= (%s, %s);
  """, (source_system, source_database, source_table, cursor_date, cursor_id))
  total_scoped_rows, unique_source_ids = cur.fetchone()
  print(f"Total Scoped Rows:  {total_scoped_rows:,}")
  print(f"Unique Source IDs:  {unique_source_ids:,}")
  print(f"Additional Rows:    {total_scoped_rows - unique_source_ids:,}")

  print("\n==================================================================")
  print("2. FINDING ALL DUPLICATED SOURCE IDS & VERSION COUNTS")
  print("==================================================================")
  cur.execute("""
    SELECT source_id, COUNT(*) AS version_count
    FROM wf_canonical_staging.mariadb_raw_source_rows
    WHERE source_system = %s
      AND source_database = %s
      AND source_table = %s
      AND (source_created_on, source_id) <= (%s, %s)
    GROUP BY source_id
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC, source_id ASC;
  """, (source_system, source_database, source_table, cursor_date, cursor_id))
  dup_summary = cur.fetchall()
  print(f"Duplicated Source IDs Count: {len(dup_summary):,}")

  version_distribution = {}
  for sid, count in dup_summary:
    version_distribution[count] = version_distribution.get(count, 0) + 1

  print("Version count distribution across duplicated IDs:")
  for v_count, num_ids in sorted(version_distribution.items()):
    extra_rows = num_ids * (v_count - 1)
    print(f"  {num_ids:,} source IDs have {v_count} versions (contributing {extra_rows:,} additional rows)")

  print("\n==================================================================")
  print("3. FETCHING ALL VERSIONS AND PROVING PAYLOAD EQUIVALENCE")
  print("==================================================================")
  cur.execute("""
    WITH dups AS (
      SELECT source_id
      FROM wf_canonical_staging.mariadb_raw_source_rows
      WHERE source_system = %s
        AND source_database = %s
        AND source_table = %s
        AND (source_created_on, source_id) <= (%s, %s)
      GROUP BY source_id
      HAVING COUNT(*) > 1
    )
    SELECT 
      r.source_id,
      r.id AS row_id,
      r.source_hash,
      r.source_record_id,
      r.source_created_on,
      r.created_at,
      r.canonicalization_version,
      r.hash_algorithm,
      r.raw_sha256,
      r.raw_message,
      r.raw_payload::text AS raw_payload_str
    FROM wf_canonical_staging.mariadb_raw_source_rows r
    JOIN dups d ON r.source_id = d.source_id
    WHERE r.source_system = %s
      AND r.source_database = %s
      AND r.source_table = %s
      AND (r.source_created_on, r.source_id) <= (%s, %s)
    ORDER BY r.source_id ASC, r.created_at ASC, r.id ASC;
  """, (source_system, source_database, source_table, cursor_date, cursor_id,
        source_system, source_database, source_table, cursor_date, cursor_id))
  all_dup_rows = cur.fetchall()
  print(f"Total Rows Retrieved for Duplicated IDs: {len(all_dup_rows):,}")

  by_id = {}
  for r in all_dup_rows:
    sid = r[0]
    if sid not in by_id:
      by_id[sid] = []
    by_id[sid].append({
      "row_id": str(r[1]),
      "source_hash": r[2],
      "source_record_id": r[3],
      "source_created_on": r[4],
      "created_at": r[5].isoformat() if r[5] else None,
      "canonicalization_version": r[6],
      "hash_algorithm": r[7],
      "raw_sha256": r[8],
      "raw_message": r[9],
      "raw_payload_str": r[10]
    })

  # Analyze payload equivalence and hash differences
  payload_identical_count = 0
  payload_differing_count = 0
  hash_variance_reasons = {}

  audited_records = []

  for sid, versions in by_id.items():
    # Compare raw_message, raw_payload_str, source_record_id across all versions of this source_id
    base_msg = versions[0]["raw_message"]
    base_payload = versions[0]["raw_payload_str"]
    base_rec_id = versions[0]["source_record_id"]

    all_msgs_equal = all(v["raw_message"] == base_msg for v in versions)
    all_payloads_equal = all(v["raw_payload_str"] == base_payload for v in versions)
    all_rec_ids_equal = all(v["source_record_id"] == base_rec_id for v in versions)

    is_identical = all_msgs_equal and all_payloads_equal and all_rec_ids_equal
    if is_identical:
      payload_identical_count += 1
    else:
      payload_differing_count += 1

    # Check why hashes differ
    distinct_hashes = set(v["source_hash"] for v in versions)
    distinct_canon_vers = set(v["canonicalization_version"] for v in versions)
    distinct_algs = set(v["hash_algorithm"] for v in versions)

    reason = []
    if len(distinct_canon_vers) > 1:
      reason.append(f"canonicalization_version_changed: {list(distinct_canon_vers)}")
    if len(distinct_algs) > 1:
      reason.append(f"hash_algorithm_changed: {list(distinct_algs)}")
    if not is_identical:
      reason.append("payload_content_differed")
    if not reason:
      reason.append("duplicate_hash_reinsert")

    reason_key = "; ".join(reason)
    hash_variance_reasons[reason_key] = hash_variance_reasons.get(reason_key, 0) + 1

    audited_records.append({
      "source_id": sid,
      "version_count": len(versions),
      "payload_identical": is_identical,
      "distinct_hashes_count": len(distinct_hashes),
      "reasons": reason,
      "versions": [
        {
          "row_id": v["row_id"],
          "source_hash": v["source_hash"],
          "created_at": v["created_at"],
          "canonicalization_version": v["canonicalization_version"],
          "hash_algorithm": v["hash_algorithm"],
          "raw_sha256": v["raw_sha256"]
        }
        for v in versions
      ]
    })

  print(f"\nPayload Equivalence Analysis:")
  print(f"  Source IDs with 100% Identical Raw Payload & Message: {payload_identical_count:,} ({payload_identical_count/len(by_id)*100:.1f}%)")
  print(f"  Source IDs with Differing Raw Payload:               {payload_differing_count:,}")

  print("\nHash Variance Reasons:")
  for rk, count in hash_variance_reasons.items():
    print(f"  {count:,} IDs: {rk}")

  artifact = {
    "contract": "wf-reconciled-scoped-duplicates-v2",
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "scope_constraints": {
      "source_system": source_system,
      "source_database": source_database,
      "source_table": source_table,
      "frozen_upper_cursor": {
        "source_created_on": cursor_date,
        "source_id": cursor_id
      }
    },
    "terminology_reconciliation": {
      "unique_source_ids": unique_source_ids,
      "total_scoped_rows": total_scoped_rows,
      "duplicated_source_ids": len(dup_summary),
      "additional_versions": total_scoped_rows - unique_source_ids,
      "mathematical_proof": f"{unique_source_ids:,} unique source IDs + {total_scoped_rows - unique_source_ids:,} additional row versions = {total_scoped_rows:,} total scoped rows."
    },
    "version_distribution": version_distribution,
    "payload_equivalence": {
      "identical_payload_source_ids": payload_identical_count,
      "differing_payload_source_ids": payload_differing_count,
      "equivalence_rate_percent": round(payload_identical_count / len(by_id) * 100, 2)
    },
    "hash_variance_reasons": hash_variance_reasons,
    "audited_duplicate_records": audited_records
  }

  out_path = "audit-output/mariadb-live/canonical-scope-contamination/reconciled_scoped_duplicates_v2.json"
  os.makedirs(os.path.dirname(out_path), exist_ok=True)
  with open(out_path, "w", encoding="utf-8") as f:
    json.dump(artifact, f, indent=2)

  print(f"\nSaved reconciled duplicate artifact to {out_path}")

if __name__ == "__main__":
  rebuild()

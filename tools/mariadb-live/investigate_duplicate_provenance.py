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

print("Fetching sample duplicate records...")
cur.execute("""
  SELECT source_id, COUNT(*) as cnt
  FROM wf_canonical_staging.mariadb_raw_source_rows
  WHERE source_system = 'OceanDigital MariaDB'
    AND source_database = 'thecollective_inventory'
    AND source_table = 'auctions'
    AND (source_created_on, source_id) <= ('2026-04-28T15:50:43.000Z', '3cddaf9f-9f36-4633-a08e-59a6dfdca057')
  GROUP BY source_id
  HAVING COUNT(*) > 1
  LIMIT 5;
""")
sample_dups = cur.fetchall()

for sid, cnt in sample_dups:
  print(f"\nSource ID: {sid} (total {cnt} versions):")
  cur.execute("""
    SELECT id, source_record_id, source_created_on, source_hash, canonicalization_version, hash_algorithm,
           captured_at, created_at, raw_message IS NOT NULL as has_msg,
           raw_payload->>'id' as payload_id, raw_payload->>'created_on' as payload_created_on
    FROM wf_canonical_staging.mariadb_raw_source_rows
    WHERE source_id = %s
    ORDER BY created_at ASC;
  """, (sid,))
  for r in cur.fetchall():
    print(f"  - id={r[0]}, record_id={r[1]}, created_on={r[2]}, hash={r[3][:16]}..., ver={r[4]}, captured_at={r[6]}, staged_at={r[7]}, has_msg={r[8]}, payload_created={r[10]}")

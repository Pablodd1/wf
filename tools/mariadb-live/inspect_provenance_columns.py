import os
import sys
import json
import psycopg2

db_url = os.environ.get("DATABASE_URL")
conn = psycopg2.connect(db_url)
cur = conn.cursor()

cur.execute("""
  SELECT source_id
  FROM wf_canonical_staging.mariadb_raw_source_rows
  WHERE source_system = 'OceanDigital MariaDB'
    AND source_database = 'thecollective_inventory'
    AND source_table = 'auctions'
    AND (source_created_on, source_id) <= ('2026-04-28T15:50:43.000Z', '3cddaf9f-9f36-4633-a08e-59a6dfdca057')
  GROUP BY source_id
  HAVING COUNT(*) > 1
  LIMIT 1;
""")
sample_id = cur.fetchone()[0]
print(f"Sample multi-version source_id: {sample_id}")

cur.execute("""
  SELECT id, source_id, source_hash, source_created_on, canonicalization_version, raw_payload, created_at
  FROM wf_canonical_staging.mariadb_raw_source_rows
  WHERE source_id = %s
  ORDER BY id ASC;
""", (sample_id,))
rows = cur.fetchall()
for r in rows:
  print(f"Row ID: {r[0]}")
  print(f"  source_hash: {r[2]}")
  print(f"  source_created_on: {r[3]}")
  print(f"  canonicalization_version: {r[4]}")
  print(f"  created_at (staging time): {r[6]}")
  print(f"  raw_payload keys: {list(r[5].keys()) if isinstance(r[5], dict) else type(r[5])}")
  print(f"  raw_payload sample: {json.dumps(r[5])[:120]}")
  print("-" * 50)

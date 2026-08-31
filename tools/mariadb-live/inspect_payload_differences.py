import os
import sys
import json
import psycopg2

db_url = os.environ.get("DATABASE_URL")
conn = psycopg2.connect(db_url)
cur = conn.cursor()

cur.execute("""
  WITH dups AS (
    SELECT source_id
    FROM wf_canonical_staging.mariadb_raw_source_rows
    WHERE source_system = 'OceanDigital MariaDB'
      AND source_database = 'thecollective_inventory'
      AND source_table = 'auctions'
      AND (source_created_on, source_id) <= ('2026-04-28T15:50:43.000Z', '3cddaf9f-9f36-4633-a08e-59a6dfdca057')
    GROUP BY source_id
    HAVING COUNT(*) > 1
    LIMIT 3
  )
  SELECT r.source_id, r.created_at, r.canonicalization_version, r.source_hash, r.raw_payload, r.raw_message
  FROM wf_canonical_staging.mariadb_raw_source_rows r
  JOIN dups d ON r.source_id = d.source_id
  ORDER BY r.source_id, r.created_at ASC;
""")
rows = cur.fetchall()
for sid in set(r[0] for r in rows):
  print(f"\n=======================================================")
  print(f"SOURCE_ID: {sid}")
  print(f"=======================================================")
  instances = [r for r in rows if r[0] == sid]
  for idx, inst in enumerate(instances):
    print(f" Version {idx+1}: staged_at={inst[1]} canon_ver={inst[2]} hash={inst[3][:16]}...")
    p = inst[4]
    print(f"   Payload keys: {list(p.keys()) if isinstance(p, dict) else type(p)}")
    if isinstance(p, dict):
      print(f"   updated_on in payload: {p.get('updated_on') or p.get('updated_at')}")
      print(f"   status in payload: {p.get('status')}")
      print(f"   price in payload: {p.get('price') or p.get('reserve_price')}")

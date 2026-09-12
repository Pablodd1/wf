import os
import psycopg2

db_url = os.environ.get("DATABASE_URL")
conn = psycopg2.connect(db_url)
cur = conn.cursor()

cur.execute("""
  SELECT raw_payload->>'title'
  FROM wf_canonical_staging.mariadb_authoritative_raw_source_rows
  WHERE source_id = '811bbde4-ae03-4367-8a5d-7b250274ed7d';
""")
title = cur.fetchone()[0]
for idx, line in enumerate(title.split("\n")):
  print(f"{idx}: {line.encode('ascii', 'replace').decode('ascii')}")

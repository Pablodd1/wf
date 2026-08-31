import os
import psycopg2
import json

db_url = os.environ.get("DATABASE_URL")
conn = psycopg2.connect(db_url)
cur = conn.cursor()

cur.execute("""
  SELECT raw_message, raw_payload
  FROM wf_canonical_staging.mariadb_authoritative_raw_source_rows
  WHERE source_id = 'dc40cca7-fa1e-46a9-87a9-690572b48e8b';
""")
r = cur.fetchone()
payload = r[1]
text = r[0] or payload.get("title") or payload.get("description") or ""
print("Full text:")
for idx, l in enumerate(text.split("\n")):
  print(f" {idx}: {l.encode('ascii', 'replace').decode('ascii')}")

import os
import psycopg2
import json

conn = psycopg2.connect(os.environ["DATABASE_URL"])
cur = conn.cursor()
cur.execute("""
  SELECT source_id, raw_message, raw_payload
  FROM wf_canonical_staging.mariadb_authoritative_raw_source_rows
  WHERE source_id = '202b7a90-11a8-41f1-a312-d7201ed12670';
""")
r = cur.fetchone()
print("raw_message:", repr(r[1]))
payload = r[2] if isinstance(r[2], dict) else json.loads(r[2])
for k, v in payload.items():
  safe_v = str(v).encode('ascii', 'replace').decode('ascii')
  print(f"payload.{k}: {safe_v}")
